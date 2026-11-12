import { join, dirname, basename } from "node:path";
import { existsSync } from "node:fs";
import type {
  AppSettings,
  VllmModel,
  VllmModelConfig,
  VllmRuntimeConfig,
} from "@shared/types";
import { normalizeVllmRuntime } from "@shared/vllmRuntime";
import { applyListenPortToArgs } from "./commandBuilder";
import { parseCommandLine } from "./commandLineParse";
import { toVllmModelPathForLaunch } from "../utils/wslPath";

function useCustomLaunch(cfg: VllmModelConfig): boolean {
  if (!cfg.customCommandLine?.trim()) return false;
  if (cfg.launchMode === "builder") return false;
  return true;
}

const WSL_EXE = "wsl.exe";

function pickWslDistroArgs(distro: string | undefined): string[] {
  const d = distro?.trim();
  if (d) return ["-d", d];
  return [];
}

function escapeBashSingleQuoted(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Extract `namespace/modelname` from an HF hub cache path containing a
 * `models--namespace--repo` segment. Returns null for non-HF paths.
 */
function extractHfRepoId(modelPath: string): string | null {
  const norm = modelPath.replace(/\\/g, "/");
  for (const seg of norm.split("/")) {
    if (!seg.startsWith("models--")) continue;
    const rest = seg.slice("models--".length);
    const idx = rest.indexOf("--");
    if (idx === -1) continue;
    const ns = rest.slice(0, idx);
    const name = rest.slice(idx + 2);
    if (ns && name) return `${ns}/${name}`;
  }
  return null;
}

/** Extra `vllm serve …` argv after `--port` (spawn / docker). */
export function vllmConfigToArgs(cfg: VllmModelConfig): string[] {
  const a: string[] = [];
  if (
    cfg.maxModelLen != null &&
    Number.isFinite(cfg.maxModelLen) &&
    cfg.maxModelLen > 0
  ) {
    a.push("--max-model-len", String(Math.round(cfg.maxModelLen)));
  }
  const rp = cfg.reasoningParser?.trim();
  if (rp) {
    a.push("--reasoning-parser", rp);
  }
  if (cfg.enableAutoToolChoice === true) {
    a.push("--enable-auto-tool-choice");
  }
  const tcp = cfg.toolCallParser?.trim();
  if (tcp) {
    a.push("--tool-call-parser", tcp);
  }
  const smn = cfg.servedModelName?.trim();
  if (smn) {
    a.push("--served-model-name", smn);
  }
  if (
    cfg.maxNumSeqs != null &&
    Number.isFinite(cfg.maxNumSeqs) &&
    cfg.maxNumSeqs > 0
  ) {
    a.push("--max-num-seqs", String(Math.round(cfg.maxNumSeqs)));
  }
  if (
    cfg.gpuMemoryUtilization != null &&
    Number.isFinite(cfg.gpuMemoryUtilization) &&
    cfg.gpuMemoryUtilization > 0
  ) {
    a.push("--gpu-memory-utilization", String(cfg.gpuMemoryUtilization));
  }
  const kvd = cfg.kvCacheDtype?.trim();
  if (kvd) {
    a.push("--kv-cache-dtype", kvd);
  }
  const sc = cfg.speculativeConfig?.trim();
  if (sc) {
    a.push("--speculative-config", sc);
  }
  const samplingJson = buildSamplingOverrideJson(cfg);
  if (samplingJson) {
    a.push("--override-generation-config", samplingJson);
  }
  return a;
}

function buildSamplingOverrideJson(cfg: VllmModelConfig): string | null {
  const obj: Record<string, number> = {};
  const add = (key: string, v: number | undefined): void => {
    if (v != null && Number.isFinite(v)) obj[key] = v;
  };
  add("temperature", cfg.temperature);
  add("top_p", cfg.topP);
  add("top_k", cfg.topK != null ? Math.round(cfg.topK) : cfg.topK);
  add("min_p", cfg.minP);
  add("repetition_penalty", cfg.repetitionPenalty);
  add("presence_penalty", cfg.presencePenalty);
  add("frequency_penalty", cfg.frequencyPenalty);
  return Object.keys(obj).length > 0 ? JSON.stringify(obj) : null;
}

function quoteDisplayToken(t: string): string {
  if (t.startsWith("--")) return t;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return t;
  // Use single-quotes — JSON never contains single quotes, so no escaping needed.
  return `'${t}'`;
}

function quoteBashToken(t: string): string {
  if (t.startsWith("--")) return t;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return t;
  return escapeBashSingleQuoted(t);
}

/**
 * Build `vllm serve <model> --host … --port …` for use inside bash / conda / WSL.
 * An optional vllmExe lets venv callers pass the full path to the venv's vllm binary.
 */
function buildVllmServeInvocation(
  modelArg: string,
  host: string,
  port: number,
  cfg: VllmModelConfig,
  vllmExe = "vllm",
): string {
  const tail = [
    escapeBashSingleQuoted(modelArg),
    "--host",
    escapeBashSingleQuoted(host),
    "--port",
    String(port),
    ...vllmConfigToArgs(cfg).map(quoteBashToken),
  ].join(" ");
  return `${vllmExe} serve ${tail}`;
}

/**
 * Build a full bash command that runs a given cmd inside a conda environment.
 * Uses `conda run --no-capture-output` which is more reliable than
 * `conda activate && …` in non-interactive shells.
 *
 * When no explicit condaShPath is configured we search the common conda
 * installation directories for `etc/profile.d/conda.sh` and source the first
 * one found.  We cannot rely on `source ~/.bashrc` because most distros guard
 * it with `case $- in *i*) ;; *) return;; esac`, making it a no-op in
 * non-interactive shells.
 */
function buildCondaRunInvocation(rt: VllmRuntimeConfig, cmd: string): string {
  const sh = (rt.condaShPath ?? "").trim();
  const env = (rt.condaEnvName ?? "vllm").trim() || "vllm";
  const run = `conda run --no-capture-output -n ${escapeBashSingleQuoted(env)} ${cmd}`;
  if (sh) {
    return `source ${escapeBashSingleQuoted(sh)} && ${run}`;
  }
  // Search common conda prefix locations for the shell init script.
  const findConda =
    "for _cc in ~/miniconda3/etc/profile.d/conda.sh " +
    "~/miniforge3/etc/profile.d/conda.sh " +
    "~/anaconda3/etc/profile.d/conda.sh " +
    "/opt/conda/etc/profile.d/conda.sh; " +
    "do [ -f \"$_cc\" ] && { . \"$_cc\"; break; }; done";
  return `${findConda}; ${run}`;
}


function wslExecutable(): string {
  const wsl = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wsl.exe");
  return existsSync(wsl) ? wsl : WSL_EXE;
}

/**
 * Unwrap nested `bash/sh -ic/lc "..."` and `wsl … bash -ic "..."` layers until
 * reaching the real command, using `parseCommandLine` at each level so the
 * POSIX double-quote escaping (`\"` → `"`, `\\` → `\`) is correctly applied.
 * Stops when the executable is no longer a shell wrapper (bash/sh/wsl).
 */
function unwrapShellLayers(s: string): string {
  for (let depth = 0; depth < 8; depth++) {
    let parsed: { executable: string; args: string[] };
    try {
      parsed = parseCommandLine(s);
    } catch {
      break;
    }
    const exeBase = basename(parsed.executable).replace(/\.exe$/i, "").toLowerCase();
    if (exeBase !== "wsl" && exeBase !== "bash" && exeBase !== "sh") break;
    const icIdx = parsed.args.findIndex(
      (a) => a === "-ic" || a === "-lc" || a === "-c",
    );
    if (icIdx < 0 || parsed.args[icIdx + 1] === undefined) break;
    const inner = parsed.args[icIdx + 1]!;
    if (inner === s) break;
    s = inner;
  }
  return s;
}

/**
 * Display string for LaunchCommandPanel — always shows a clean `vllm serve …`
 * command without WSL / conda / bash boilerplate.
 *
 * - Builder mode: constructed directly from the profile config fields.
 * - Custom mode: WSL/bash wrapper layers are stripped until the innermost
 *   `vllm serve` (or `python -m vllm…`) token is found.
 */
export function buildVllmFullCommandDisplay(
  vllm: VllmModel,
  profileConfig: VllmModelConfig,
  settings: AppSettings,
  listenPort: number,
): string {
  const cfg = profileConfig;
  const host =
    (cfg.host ?? settings.vllmDefaultHost).trim() || "127.0.0.1";
  const modelArg = extractHfRepoId(vllm.path) ?? toVllmModelPathForLaunch(vllm.path);

  if (!useCustomLaunch(cfg)) {
    // Builder mode: show the logical vllm serve command only.
    return [
      "vllm", "serve", quoteDisplayToken(modelArg),
      "--host", quoteDisplayToken(host),
      "--port", String(listenPort),
      ...vllmConfigToArgs(cfg).map(quoteDisplayToken),
    ].join(" ");
  }

  // Custom mode: strip all shell wrapper layers then surface the vllm part.
  const core = unwrapShellLayers(cfg.customCommandLine!.trim());

  // Find the `vllm serve` token and return from there.
  const vsIdx = core.indexOf("vllm serve");
  if (vsIdx >= 0) return core.slice(vsIdx);

  // Fallback: python -m vllm… → rewrite as vllm serve for display
  const pmIdx = core.indexOf("python");
  if (pmIdx >= 0 && core.includes("api_server")) {
    const modelM = core.match(/--model\s+('(?:[^']|\\')*'|\S+)/);
    if (modelM) {
      const flags = core.slice(core.indexOf(modelM[0]!) + modelM[0]!.length).trim();
      return `vllm serve ${modelM[1]} ${flags}`.trim();
    }
  }

  return core;
}

/**
 * Produces a process spawn plan for the main `spawn()`.
 * Windows + conda/venv: `wsl.exe` + bash (vLLM has no native Windows wheel).
 * Docker: `docker` on the host. Linux/mac: native `vllm` or bash for conda/venv.
 */
export function buildVllmCommandPlan(
  vllm: VllmModel,
  profileConfig: VllmModelConfig,
  settings: AppSettings,
  listenPort: number,
): { executable: string; args: string[]; env: NodeJS.ProcessEnv } {
  const cfg = profileConfig;
  const host =
    (cfg.host ?? settings.vllmDefaultHost).trim() || "127.0.0.1";
  const wslModel = toVllmModelPathForLaunch(vllm.path);
  // For HF hub cache models use namespace/modelname — vLLM reads from ~/.cache/huggingface/hub
  // automatically. Fall back to the full POSIX path for non-HF models.
  const modelArg = extractHfRepoId(vllm.path) ?? wslModel;
  const rt = normalizeVllmRuntime(settings.vllmRuntime);

  if (useCustomLaunch(cfg)) {
    return buildCustomVllmPlan(
      cfg.customCommandLine!.trim(),
      settings,
      listenPort,
    );
  }

  if (rt.envKind === "docker") {
    // Docker uses volume-mount + container path; keep full path logic
    return buildDockerPlan(vllm.path, wslModel, host, listenPort, rt, cfg);
  }

  if (process.platform === "win32" && (rt.envKind === "conda" || rt.envKind === "venv")) {
    return buildWinWslPlan(modelArg, host, listenPort, rt, cfg);
  }

  if (rt.envKind === "conda") {
    const inner = buildCondaRunInvocation(rt, buildVllmServeInvocation(modelArg, host, listenPort, cfg));
    return { executable: "bash", args: ["-ic", inner], env: { ...process.env } };
  }

  if (rt.envKind === "venv") {
    const rawVenv = (rt.venvPath ?? "").trim();
    if (rawVenv) {
      const vllmBin = join(rawVenv, "bin", "vllm");
      const vllmExe = existsSync(vllmBin) ? vllmBin : "vllm";
      const inner = `source ${rawVenv}/bin/activate && ${buildVllmServeInvocation(modelArg, host, listenPort, cfg, vllmExe)}`;
      return { executable: "bash", args: ["-c", inner], env: { ...process.env } };
    }
  }

  // Windows: never spawn host `vllm.exe` directly — recent vLLM opens an interactive TUI
  // when not under a real TTY ("Terminal not supported" under Electron). Always go through WSL.
  if (process.platform === "win32") {
    return buildWinWslPlan(modelArg, host, listenPort, rt, cfg);
  }

  return {
    executable: "vllm",
    args: [
      "serve",
      modelArg,
      "--host",
      host,
      "--port",
      String(listenPort),
      ...vllmConfigToArgs(cfg),
    ],
    env: { ...process.env },
  };
}

function buildWinWslPlan(
  wslModel: string,
  host: string,
  port: number,
  rt: VllmRuntimeConfig,
  cfg: VllmModelConfig,
): { executable: string; args: string[]; env: NodeJS.ProcessEnv } {
  let inner: string;
  // conda needs -ic so bash sources .bashrc for `conda run`.
  // venv uses -c: non-login, non-interactive — avoids sourcing /etc/profile.d/* which can
  // introduce system nvcc with wrong permissions (PermissionError in torch.inductor on WSL).
  let bashFlag: "-ic" | "-c";
  if (rt.envKind === "conda") {
    bashFlag = "-ic";
    inner = buildCondaRunInvocation(rt, buildVllmServeInvocation(wslModel, host, port, cfg));
  } else {
    bashFlag = "-c";
    const rawVenv = (rt.venvPath ?? "").trim();
    const venvWsl = rawVenv ? toVllmModelPathForLaunch(rawVenv) : "/opt/venv";
    inner = `source ${venvWsl}/bin/activate && ${buildVllmServeInvocation(wslModel, host, port, cfg, `${venvWsl}/bin/vllm`)}`;
  }
  return {
    executable: wslExecutable(),
    args: [...pickWslDistroArgs(rt.wslDistro), "bash", bashFlag, inner],
    env: { ...process.env },
  };
}

/** Split shell-style args respecting single/double quotes (no escape sequences). */
function splitShellArgs(s: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++
    if (i >= s.length) break
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i]!; i++
      let cur = ''
      while (i < s.length && s[i] !== q) cur += s[i++]!
      i++ // skip closing quote
      tokens.push(cur)
    } else {
      let cur = ''
      while (i < s.length && !/\s/.test(s[i]!) && s[i] !== '"' && s[i] !== "'") cur += s[i++]!
      tokens.push(cur)
    }
  }
  return tokens
}

function buildDockerPlan(
  localModelPath: string,
  wslModel: string,
  host: string,
  port: number,
  rt: VllmRuntimeConfig,
  cfg: VllmModelConfig,
): { executable: string; args: string[]; env: NodeJS.ProcessEnv } {
  const image = (rt.dockerImage ?? "vllm/vllm-openai:latest").trim();
  const mBase = basename(localModelPath);
  const extra = (rt.dockerExtraArgs ?? "").trim();

  if (process.platform === "win32") {
    const modelDir = dirname(localModelPath);
    const args: string[] = [
      "run",
      "--rm",
      "-p",
      `${port}:${port}`,
      "--gpus",
      "all",
      "-v",
      `${modelDir}:/models`,
    ];
    if (extra) {
      args.push(...splitShellArgs(extra));
    }
    const inContainer = `/models/${mBase}`.replace(/\\/g, "/");
    args.push(
      image,
      "vllm",
      "serve",
      inContainer,
      "--host",
      host,
      "--port",
      String(port),
      ...vllmConfigToArgs(cfg),
    );
    return { executable: "docker", args, env: { ...process.env } };
  }

  const cDir = dirname(
    wslModel.startsWith("/") ? wslModel : localModelPath,
  );
  const cBase = basename(
    wslModel.startsWith("/") ? wslModel : localModelPath,
  );
  const cPath = `/models/${cBase}`;
  const args: string[] = [
    "run",
    "--rm",
    "-p",
    `${port}:${port}`,
    "--gpus",
    "all",
    "-v",
    `${cDir}:/models`,
  ];
  if (extra) {
    args.push(...splitShellArgs(extra));
  }
  args.push(
    image,
    "vllm",
    "serve",
    cPath,
    "--host",
    host,
    "--port",
    String(port),
    ...vllmConfigToArgs(cfg),
  );
  return { executable: "docker", args, env: { ...process.env } };
}

/** Patch --port inside a flat command string (not a bash wrapper). */
function patchPortInScript(script: string, port: number): string {
  const patched = script
    .replace(/--port=\S+/g, `--port=${port}`)
    .replace(/--port +\S+/g, `--port ${port}`);
  // If no --port was present at all, append it.
  return /--port[\s=]/.test(patched) ? patched : `${patched} --port ${port}`;
}

function buildCustomVllmPlan(
  line: string,
  settings: AppSettings,
  port: number,
): { executable: string; args: string[]; env: NodeJS.ProcessEnv } {
  const parsed = parseCommandLine(line);
  if (process.platform === "win32" && !/^docker$/i.test(basename(parsed.executable))) {
    const rt = normalizeVllmRuntime(settings.vllmRuntime);

    // wsl.exe invocation: pass through, patching --port inside the bash -ic script.
    if (/^wsl(\.exe)?$/i.test(basename(parsed.executable))) {
      const icIdx = parsed.args.findIndex(
        (a) => a === "-ic" || a === "-lc" || a === "-c",
      );
      if (icIdx >= 0 && parsed.args[icIdx + 1] !== undefined) {
        const patched = patchPortInScript(parsed.args[icIdx + 1]!, port);
        const newArgs = [...parsed.args.slice(0, icIdx + 1), patched];
        return { executable: parsed.executable, args: newArgs, env: { ...process.env } };
      }
      return { executable: parsed.executable, args: parsed.args, env: { ...process.env } };
    }

    // bash/sh -ic "script" style: unwrap all nested shell layers, patch port
    // inside the real script, then wrap once in WSL.  Using applyListenPortToArgs
    // here would append --port as a separate bash option argument, breaking the
    // shell syntax (causes "syntax error near unexpected token 'do'").
    if (/^(?:bash|sh)$/.test(basename(parsed.executable))) {
      const icIdx = parsed.args.findIndex(
        (a) => a === "-ic" || a === "-lc" || a === "-c",
      );
      if (icIdx >= 0 && parsed.args[icIdx + 1] !== undefined) {
        const realScript = patchPortInScript(
          unwrapShellLayers(parsed.args[icIdx + 1]!),
          port,
        );
        const needsConda = rt.envKind === "conda" && !realScript.includes("conda");
        const rawVenvB = (rt.venvPath ?? "").trim();
        const needsVenv = rt.envKind === "venv" && !!rawVenvB && !realScript.includes("activate");
        const venvWslB = rawVenvB ? toVllmModelPathForLaunch(rawVenvB) : "/opt/venv";
        const inner = needsConda
          ? buildCondaRunInvocation(rt, realScript)
          : needsVenv
            ? `source ${escapeBashSingleQuoted(venvWslB)}/bin/activate && ${realScript}`
            : realScript;
        const bashFlag = needsConda ? "-ic" : "-c";
        return {
          executable: wslExecutable(),
          args: [...pickWslDistroArgs(rt.wslDistro), "bash", bashFlag, inner],
          env: { ...process.env },
        };
      }
    }

    // Generic non-shell Windows command (e.g. a plain `vllm serve …`): build the
    // inner string from parsed tokens and wrap in WSL.
    // Strip any outer shell quotes the user may have typed (e.g. '{"key":1}') so
    // we can re-apply consistent bash quoting via quoteBashToken.  Without this,
    // unquoted JSON values like {"key":1} trigger bash brace-expansion and break.
    const stripOuterQuotes = (a: string): string => {
      if (a.length >= 2 && ((a.startsWith("'") && a.endsWith("'")) || (a.startsWith('"') && a.endsWith('"')))) {
        return a.slice(1, -1);
      }
      return a;
    };
    const args = applyListenPortToArgs(parsed.args, port);
    const rawInner = [parsed.executable, ...args]
      .map((a) => quoteBashToken(stripOuterQuotes(a)))
      .join(" ");
    const needsConda = rt.envKind === "conda" && !rawInner.includes("conda");
    const rawVenv = (rt.venvPath ?? "").trim();
    const needsVenv = rt.envKind === "venv" && !!rawVenv && !rawInner.includes("activate");
    const venvWsl = rawVenv ? toVllmModelPathForLaunch(rawVenv) : "/opt/venv";
    const inner = needsConda
      ? buildCondaRunInvocation(rt, rawInner)
      : needsVenv
        ? `source ${escapeBashSingleQuoted(venvWsl)}/bin/activate && ${rawInner}`
        : rawInner;
    const bashFlag = needsConda ? "-ic" : "-c";
    return {
      executable: wslExecutable(),
      args: [...pickWslDistroArgs(rt.wslDistro), "bash", bashFlag, inner],
      env: { ...process.env },
    };
  }
  const args = applyListenPortToArgs(parsed.args, port);
  return { executable: parsed.executable, args, env: { ...process.env } };
}
