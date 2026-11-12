import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path, { posix } from "node:path";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import {
  parseWslUncPath,
  linuxPathToWslUnc,
} from "../utils/wslPath";

const execFileAsync = promisify(execFile);
const WSL_TIMEOUT_MS = 120_000;
const CONFIG_READ_TIMEOUT_MS = 8_000;

function wslExePath(): string {
  return path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "wsl.exe",
  );
}

/** Wrap a Linux path in single quotes, escaping any embedded single quotes. */
function bashSingleQuote(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

/**
 * Run a bash script inside a WSL distro by piping it to stdin.
 * This avoids all Windows command-line quoting issues: the script may contain
 * newlines, semicolons, ampersands, quotes — anything bash accepts — because it
 * never passes through Windows argument parsing.
 */
function runWslBashScript(
  distro: string | null,
  script: string,
  opts?: { maxBuffer?: number; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const wsl = wslExePath();
    const args = distro
      ? ["-d", distro, "--", "bash"]
      : ["--", "bash"];

    const proc = spawn(wsl, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const maxBuffer = opts?.maxBuffer ?? 50 * 1024 * 1024;

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > maxBuffer) {
        proc.kill();
        reject(new Error("stdout buffer exceeded"));
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const timeout = opts?.timeout ?? WSL_TIMEOUT_MS;
    const timer = setTimeout(() => {
      proc.kill();
      const err = Object.assign(new Error("WSL timeout"), { code: "TIMEOUT" });
      reject(err);
    }, timeout);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          Object.assign(new Error(`WSL bash exited with code ${code}`), {
            code,
            stderr,
            stdout,
          }),
        );
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.stdin.write(script, "utf8", (writeErr) => {
      if (writeErr) {
        clearTimeout(timer);
        reject(writeErr);
      } else {
        proc.stdin.end();
      }
    });
  });
}

/**
 * `wsl -l` marks the default distro with `*`. Used when UNC used `\\…\\Ubuntu\\`
 * but the real install is e.g. `Ubuntu-22.04`.
 * wsl.exe outputs UTF-16 LE; read as buffer and decode manually.
 */
export async function getDefaultWslDistroName(): Promise<string | null> {
  if (process.platform !== "win32") return null;
  const wsl = wslExePath();

  const decodeUtf16 = (buf: Buffer): string =>
    buf.toString("utf16le").replace(/^﻿/, "");

  try {
    const { stdout } = await execFileAsync(wsl, ["-l"], {
      windowsHide: true,
      maxBuffer: 32 * 1024,
      encoding: "buffer",
    });
    const text = decodeUtf16(stdout as unknown as Buffer);
    for (const line of text.split(/\r?\n/u)) {
      const m = /^\s*\*\s*(\S+)/.exec(line);
      if (m) return m[1] ?? null;
    }
  } catch {
    /* fall through */
  }
  /* Quiet list: on many builds the default distro is listed first. */
  try {
    const { stdout } = await execFileAsync(wsl, ["-l", "-q"], {
      windowsHide: true,
      maxBuffer: 8 * 1024,
      encoding: "buffer",
    });
    const text = decodeUtf16(stdout as unknown as Buffer);
    const first = text
      .split(/\r?\n/u)
      .map((s) => s.replace(/\0/g, "").trim())
      .find((s) => s.length > 0);
    return first ?? null;
  } catch {
    return null;
  }
}

function splitFindOutput(stdout: string): string[] {
  return stdout
    .split(/\r?\n/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type WslFindModelDirsResult =
  | { ok: true; paths: string[]; uncDistro: string }
  | { ok: false; error: string; dirNotFound?: boolean };

/**
 * On Windows, Hub cache `\\wsl$\\…` is often 9P/symlink-unsafe for `fs` + Node.
 * Run `find(1)` inside the distro to resolve real `*.safetensors` and `config.json`.
 *
 * Script is piped via stdin (not passed as a -c argument) to avoid Windows
 * command-line argument issues with newlines and special characters.
 *
 * HF hub cache stores weights as blobs and creates symlinks in snapshots/<hash>/,
 * so we match both regular files and symlinks with `( -type f -o -type l )`.
 */
export async function findModelDirsLinuxTreeViaWsl(
  distro: string,
  linuxRoot: string,
): Promise<WslFindModelDirsResult> {
  if (process.platform !== "win32") {
    return { ok: false, error: "WSL find runs only on Windows" };
  }

  const quotedRoot = bashSingleQuote(linuxRoot);
  const findScript = [
    `ROOT=${quotedRoot}`,
    'if [ ! -d "$ROOT" ]; then',
    '  echo "vllm_wsl: not a directory: $ROOT" >&2',
    "  exit 2",
    "fi",
    // Find *.safetensors files only (config.json-only dirs are excluded → GGUF-only repos skipped).
    // HF hub cache places weights as symlinks (→ blobs/) inside snapshots/<hash>/, so match both
    // regular files and symlinks. .no_exist/ is the HF hub negative-cache dir; skip it.
    // For each found file: exclude MLX dirs (contain mlx_config.json alongside the safetensors),
    // then normalize the path by stripping /snapshots/<hash> so all snapshots of one repo collapse.
    'while IFS= read -r fp; do',
    '  d=$(dirname "$fp")',
    '  if [ -f "${d}/mlx_config.json" ] || [ -L "${d}/mlx_config.json" ]; then continue; fi',
    "  echo \"$d\" | sed 's|\\(/models--[^/]*\\)/snapshots/.*|\\1|'",
    "done < <(find \"$ROOT\" \\( -type f -o -type l \\) -name \"*.safetensors\" ! -path \"*/blobs/*\" ! -path \"*/.no_exist/*\" ! -path \"*/datasets--*/*\" 2>/dev/null) | sort -u",
  ].join("\n");

  const missingDirMessage = (which: string) =>
    [
      `WSL: path is not a directory in distro "${which}": ${linuxRoot}. The \\\\wsl.localhost\\<name> segment must match \`wsl -l\`.`,
      `In a WSL shell: \`test -d ${linuxRoot} && echo ok\``,
    ].join(" ");

  try {
    const { stdout } = await runWslBashScript(distro, findScript);
    return {
      ok: true,
      paths: splitFindOutput(stdout),
      uncDistro: distro,
    };
  } catch (e) {
    const err = e as {
      message?: string;
      stderr?: string;
      stdout?: string;
      code?: number | string;
    };
    // Any error (dir not found code 2, distro not found code 4294967295, etc.)
    // → retry with the default WSL distro before giving up.
    try {
      const { stdout } = await runWslBashScript(null, findScript);
      const paths = splitFindOutput(stdout);
      const defName = (await getDefaultWslDistroName()) || distro;
      return { ok: true, paths, uncDistro: defName };
    } catch (e2) {
      const err2 = e2 as { message?: string; stderr?: string; code?: number };
      // Report the original error plus the fallback failure for diagnostics.
      const orig = [err.message, err.stderr, err.stdout].filter(Boolean).join(" — ");
      const fallback = [err2.message, err2.stderr].filter(Boolean).join(" — ");
      const isDistroMismatch = err.code === 2 || (typeof err.code === "number" && err.code >>> 0 === 0xffffffff);
      // code 2 from the retry means the directory doesn't exist in the default distro either.
      const dirNotFound = err2.code === 2;
      return {
        ok: false,
        error: isDistroMismatch
          ? `${missingDirMessage(distro)} — default-distro retry also failed: [${err2.code ?? "?"}] ${fallback}`
          : `WSL find failed: ${orig}${fallback ? ` — default-distro retry: ${fallback}` : ""}`,
        dirNotFound,
      };
    }
  }
}

/**
 * `cat(1)` inside WSL to read a file by Linux path (follows symlinks in ext4).
 */
export async function readLinuxFileViaWsl(
  distro: string,
  linuxFilePath: string,
): Promise<string | null> {
  if (process.platform !== "win32") return null;
  const quotedFile = bashSingleQuote(linuxFilePath);
  const catScript = [
    `FILE=${quotedFile}`,
    'if [ -f "$FILE" ] || [ -L "$FILE" ]; then',
    '  cat "$FILE"',
    "else",
    "  exit 1",
    "fi",
  ].join("\n");
  try {
    const { stdout } = await runWslBashScript(distro, catScript, {
      maxBuffer: 2 * 1024 * 1024,
      timeout: CONFIG_READ_TIMEOUT_MS,
    });
    return stdout;
  } catch {
    return null;
  }
}

export interface ConfigJsonMeta {
  title: string | null;
  dtype: string | null;
  maxPositionEmbeddings: number | null;
  isMultimodal: boolean;
}

/**
 * For a model directory, read `config.json` for display name and dtype.
 * HF hub cache stores weights at repo-dir level but config.json is inside
 * `snapshots/<hash>/`, so we try that as a fallback.
 * On Windows, files visible via the 9P layer may be 0-byte shims — fall through to WSL.
 */
export async function readConfigJsonMetaForModelDir(
  modelPathStored: string,
): Promise<ConfigJsonMeta> {
  const p = modelPathStored.trim();

  // 1. Direct config.json (works for non-HF flat model dirs)
  const onDisk = path.join(p, "config.json");
  if (existsSync(onDisk) && statSync(onDisk).size > 0) {
    try {
      return parseConfigMetaFromJsonString(readFileSync(onDisk, "utf8"));
    } catch { /* fall through */ }
  }

  // 2. HF hub layout: snapshots/<hash>/config.json (native fs — works when not WSL-symlinked)
  const snapshotsDir = path.join(p, "snapshots");
  if (existsSync(snapshotsDir)) {
    try {
      for (const hash of readdirSync(snapshotsDir)) {
        const cfgPath = path.join(snapshotsDir, hash, "config.json");
        if (existsSync(cfgPath) && statSync(cfgPath).size > 0) {
          try {
            const meta = parseConfigMetaFromJsonString(readFileSync(cfgPath, "utf8"));
            if (meta.dtype || meta.title || meta.maxPositionEmbeddings) return meta;
          } catch { /* try next hash */ }
        }
      }
    } catch { /* fall through to WSL */ }
  }

  if (process.platform !== "win32") return { title: null, dtype: null, maxPositionEmbeddings: null, isMultimodal: false };
  const wsl = parseWslUncPath(p);
  if (!wsl) return { title: null, dtype: null, maxPositionEmbeddings: null, isMultimodal: false };

  // 3. Direct config.json via WSL (resolves ext4 symlinks)
  const cfgLinux = posix.join(wsl.linuxPath, "config.json");
  const rawDirect = await readLinuxFileViaWsl(wsl.distro, cfgLinux);
  if (rawDirect) return parseConfigMetaFromJsonString(rawDirect);

  // 4. HF hub snapshots via WSL
  const snapshotsLinux = posix.join(wsl.linuxPath, "snapshots");
  const rawSnapshot = await readFirstSnapshotConfigViaWsl(wsl.distro, snapshotsLinux);
  if (rawSnapshot) return parseConfigMetaFromJsonString(rawSnapshot);

  return { title: null, dtype: null, maxPositionEmbeddings: null, isMultimodal: false };
}

async function readFirstSnapshotFileViaWsl(
  distro: string,
  snapshotsDirLinux: string,
  filename: string,
): Promise<string | null> {
  const quotedDir = bashSingleQuote(snapshotsDirLinux);
  const quotedFilename = bashSingleQuote(filename);
  const script = [
    `DIR=${quotedDir}`,
    `FNAME=${quotedFilename}`,
    '[ -d "$DIR" ] || exit 1',
    'for d in "$DIR"/*/; do',
    '  f="${d}${FNAME}"',
    '  if [ -f "$f" ] || [ -L "$f" ]; then cat "$f"; exit 0; fi',
    "done",
    "exit 1",
  ].join("\n");
  try {
    const { stdout } = await runWslBashScript(distro, script, {
      maxBuffer: 2 * 1024 * 1024,
      timeout: CONFIG_READ_TIMEOUT_MS,
    });
    return stdout || null;
  } catch {
    return null;
  }
}

async function readFirstSnapshotConfigViaWsl(
  distro: string,
  snapshotsDirLinux: string,
): Promise<string | null> {
  return readFirstSnapshotFileViaWsl(distro, snapshotsDirLinux, "config.json");
}

function parseConfigMetaFromJsonString(raw: string): ConfigJsonMeta {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;

    let title: string | null = null;
    const arch = j["_name_or_path"];
    if (typeof arch === "string" && arch.trim()) title = arch.trim();
    else {
      const t = j["model_type"];
      if (typeof t === "string" && t.trim()) title = t.trim();
    }

    let dtype: string | null = null;

    // 1. Top-level torch_dtype
    const td = j["torch_dtype"];
    if (typeof td === "string" && td.trim()) dtype = td.trim();

    // 2. Top-level dtype (some models omit torch_dtype and use dtype instead)
    if (!dtype) {
      const d = j["dtype"];
      if (typeof d === "string" && d.trim() && d.trim() !== "auto") dtype = d.trim();
    }

    // 3. quantization_config.quant_type / quant_method
    if (!dtype) {
      const qcfg = j["quantization_config"];
      if (qcfg && typeof qcfg === "object" && !Array.isArray(qcfg)) {
        const qc = qcfg as Record<string, unknown>;
        const qt = qc["quant_type"] ?? qc["quant_method"];
        if (typeof qt === "string" && qt.trim()) dtype = qt.trim();
      }
    }

    // 4. Nested sub-configs (text_config, audio_config, tts_config, vision_config, etc.)
    //    TTS / multimodal models store torch_dtype inside a component config.
    if (!dtype) {
      for (const key of Object.keys(j)) {
        const v = j[key];
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const sub = v as Record<string, unknown>;
          const std = sub["torch_dtype"];
          if (typeof std === "string" && std.trim()) { dtype = std.trim(); break; }
        }
      }
    }

    let maxPositionEmbeddings: number | null = null;
    const mpeTop = j["max_position_embeddings"];
    if (typeof mpeTop === "number" && Number.isFinite(mpeTop) && mpeTop > 0) {
      maxPositionEmbeddings = mpeTop;
    }
    if (!maxPositionEmbeddings) {
      for (const key of Object.keys(j)) {
        const v = j[key];
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const sub = v as Record<string, unknown>;
          const mpe = sub["max_position_embeddings"];
          if (typeof mpe === "number" && Number.isFinite(mpe) && mpe > 0) {
            maxPositionEmbeddings = mpe;
            break;
          }
        }
      }
    }

    // Presence of vision_config or image_token_id reliably indicates a multimodal model.
    // This is future-proof: all new vision architectures must define their vision encoder config.
    const isMultimodal = "vision_config" in j || "image_token_id" in j;

    return { title, dtype, maxPositionEmbeddings, isMultimodal };
  } catch {
    return { title: null, dtype: null, maxPositionEmbeddings: null, isMultimodal: false };
  }
}

export function storedPathFromWslFindResult(
  distro: string,
  linuxPath: string,
): string {
  return linuxPathToWslUnc(distro, linuxPath);
}

export interface GenerationConfigFields {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
}

function parseGenerationConfigFields(raw: string): GenerationConfigFields {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const num = (k: string): number | undefined => {
      const v = j[k];
      return typeof v === "number" && Number.isFinite(v) ? v : undefined;
    };
    return {
      temperature: num("temperature"),
      top_p: num("top_p"),
      top_k: num("top_k"),
      min_p: num("min_p"),
      repetition_penalty: num("repetition_penalty"),
      presence_penalty: num("presence_penalty"),
      frequency_penalty: num("frequency_penalty"),
    };
  } catch {
    return {};
  }
}

/**
 * Read generation_config.json for a model directory using the same 4-way fallback
 * as readConfigJsonMetaForModelDir: direct → snapshots/<hash> → WSL direct → WSL snapshots.
 */
export async function readGenerationConfigForModelDir(
  modelPathStored: string,
): Promise<GenerationConfigFields> {
  const p = modelPathStored.trim();
  const FILE = "generation_config.json";

  // 1. Direct (non-HF flat model dirs)
  const onDisk = path.join(p, FILE);
  if (existsSync(onDisk) && statSync(onDisk).size > 0) {
    try {
      return parseGenerationConfigFields(readFileSync(onDisk, "utf8"));
    } catch { /* fall through */ }
  }

  // 2. HF hub layout: snapshots/<hash>/generation_config.json
  const snapshotsDir = path.join(p, "snapshots");
  if (existsSync(snapshotsDir)) {
    try {
      for (const hash of readdirSync(snapshotsDir)) {
        const cfgPath = path.join(snapshotsDir, hash, FILE);
        if (existsSync(cfgPath) && statSync(cfgPath).size > 0) {
          try {
            return parseGenerationConfigFields(readFileSync(cfgPath, "utf8"));
          } catch { /* try next hash */ }
        }
      }
    } catch { /* fall through to WSL */ }
  }

  if (process.platform !== "win32") return {};
  const wsl = parseWslUncPath(p);
  if (!wsl) return {};

  // 3. Direct via WSL (resolves ext4 symlinks)
  const cfgLinux = posix.join(wsl.linuxPath, FILE);
  const rawDirect = await readLinuxFileViaWsl(wsl.distro, cfgLinux);
  if (rawDirect) return parseGenerationConfigFields(rawDirect);

  // 4. HF hub snapshots via WSL
  const snapshotsLinux = posix.join(wsl.linuxPath, "snapshots");
  const rawSnapshot = await readFirstSnapshotFileViaWsl(wsl.distro, snapshotsLinux, FILE);
  if (rawSnapshot) return parseGenerationConfigFields(rawSnapshot);

  return {};
}
