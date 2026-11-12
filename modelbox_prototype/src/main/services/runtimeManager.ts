import { exec, execFile, spawn } from "child_process";
import { promisify } from "util";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { rm, rename, readdir } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";
import { getSettings, getSetting, setSetting } from "../db/repos/settings.repo";
import { linuxPathToWslUnc } from "../utils/wslPath";
import { scanVllmModelDirs } from "./vllmModelScanner";
import type {
  GpuDetectionResult,
  GpuTier,
  LlamaRuntimeInfo,
  RuntimeProgressEvent,
  VllmModel,
  VllmRuntimeInfo,
  VllmSetupMeta,
} from "@shared/types";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ─── Directory helpers ────────────────────────────────────────────────────────

export function getModelboxDir(): string {
  return join(homedir(), ".modelbox");
}

export function getLlamaRuntimeDir(): string {
  return join(getModelboxDir(), "runtime", "llama");
}

export function getLlamaServerExePath(): string {
  const exe = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  return join(getLlamaRuntimeDir(), exe);
}

export function getDefaultModelsDir(): string {
  return join(getModelboxDir(), "models");
}

export function getVllmVenvDir(): string {
  return join(getModelboxDir(), "vllm-env");
}

/** Creates all managed directories idempotently. Called once at app startup. */
export function ensureModelboxDirs(): void {
  for (const d of [
    getModelboxDir(),
    getDefaultModelsDir(),
    join(getModelboxDir(), "runtime", "llama"),
  ]) {
    mkdirSync(d, { recursive: true });
  }
}

// ─── GPU detection ────────────────────────────────────────────────────────────

export async function detectGpu(): Promise<GpuDetectionResult> {
  // Step 1: CUDA via nvidia-smi
  try {
    const { stdout } = await execAsync(
      "nvidia-smi --query-gpu=name,driver_version --format=csv,noheader",
      { timeout: 4000 },
    );
    const line = stdout.trim().split("\n")[0] ?? "";
    const parts = line.split(",").map((s) => s.trim());
    const gpuName = parts[0] ?? undefined;
    return { tier: "cuda", gpuName };
  } catch {
    /* not NVIDIA or nvidia-smi not available */
  }

  // macOS: all Macs support Metal; nvidia-smi will never fire above
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execAsync("ioreg -r -d 1 -w 0 -c AGXAccelerator", { timeout: 4000 });
      const match = stdout.match(/"AGXAcceleratorName"\s*=\s*"([^"]+)"/);
      return { tier: "metal", gpuName: match?.[1] ?? "Apple GPU" };
    } catch { /* Intel Mac — no AGXAccelerator */ }
    return { tier: "metal", gpuName: "Metal GPU" };
  }

  // Step 2: AMD/Intel/Radeon → Vulkan
  try {
    let videoInfo = "";
    if (process.platform === "win32") {
      const { stdout } = await execAsync("wmic path win32_VideoController get name", {
        timeout: 4000,
      });
      videoInfo = stdout;
    } else {
      const { stdout } = await execAsync("lspci 2>/dev/null | grep -i vga", {
        timeout: 4000,
      });
      videoInfo = stdout;
    }
    const line = videoInfo
      .split("\n")
      .find((l) => /AMD|Radeon|Intel/i.test(l) && !/Microsoft/i.test(l));
    if (line) {
      return { tier: "vulkan", gpuName: line.trim() };
    }
  } catch {
    /* ignore */
  }

  return { tier: "cpu" };
}

// ─── GitHub release fetching ──────────────────────────────────────────────────

interface GhAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GhRelease {
  tag_name: string;
  assets: GhAsset[];
}

async function fetchLatestRelease(): Promise<GhRelease> {
  const res = await fetch(
    "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest",
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ModelBox/1.0",
      },
    },
  );
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return (await res.json()) as GhRelease;
}

function buildTagFromRelease(tagName: string): string {
  // tag_name examples: "b5248", "v2.1.0" — strip leading "v" if present
  return tagName.startsWith("v") ? tagName.slice(1) : tagName;
}

function resolveAsset(
  assets: GhAsset[],
  tier: GpuTier,
  build: string,
): GhAsset {
  const names = assets.map((a) => a.name);

  if (process.platform === "win32") {
    if (tier === "cuda") {
      // Try to match available CUDA versions in descending preference
      const cudaPriority = ["cu12.6", "cu12.5", "cu12.4", "cu12.3", "cu12.2", "cu12.1", "cu12.0", "cu11.8"];
      for (const cuVer of cudaPriority) {
        const target = `llama-${build}-bin-win-cuda-${cuVer}-x64.zip`;
        const found = assets.find((a) => a.name === target);
        if (found) return found;
      }
      // Fall through to vulkan if no CUDA asset found
    }
    if (tier === "cuda" || tier === "vulkan") {
      const vulkanAsset = assets.find((a) =>
        a.name === `llama-${build}-bin-win-vulkan-x64.zip`,
      );
      if (vulkanAsset) return vulkanAsset;
    }
    // CPU / AVX2 fallback
    const cpuAsset = assets.find((a) =>
      a.name === `llama-${build}-bin-win-avx2-x64.zip`,
    );
    if (cpuAsset) return cpuAsset;
    // Last-resort: any Windows zip
    const anyWin = assets.find((a) => a.name.includes("-bin-win") && a.name.endsWith(".zip"));
    if (anyWin) return anyWin;
  } else if (process.platform === "darwin") {
    // macOS assets are .tar.gz; prefer standard build over kleidiai/experimental variants
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const macosStd = assets.find(
      (a) => a.name.includes(`macos-${arch}`) && !a.name.includes("kleidiai") && a.name.endsWith(".tar.gz"),
    );
    if (macosStd) return macosStd;
    const macosAny = assets.find((a) => a.name.includes(`macos-${arch}`) && a.name.endsWith(".tar.gz"));
    if (macosAny) return macosAny;
    const anyMac = assets.find((a) => a.name.includes("macos") && a.name.endsWith(".tar.gz"));
    if (anyMac) return anyMac;
  } else {
    // Linux: prefer CUDA build, fall back to generic ubuntu build
    if (tier === "cuda") {
      const cudaLinux = assets.find(
        (a) => a.name.includes("ubuntu") && a.name.includes("cuda") && a.name.endsWith(".tar.gz"),
      );
      if (cudaLinux) return cudaLinux;
    }
    const ubuntuAsset = assets.find(
      (a) => a.name.includes("ubuntu") && a.name.endsWith(".tar.gz"),
    );
    if (ubuntuAsset) return ubuntuAsset;
    // Any .tar.gz
    const anyTar = assets.find((a) => a.name.endsWith(".tar.gz"));
    if (anyTar) return anyTar;
  }

  throw new Error(
    `No suitable llama.cpp release asset found for platform=${process.platform} tier=${tier}. Available: ${names.slice(0, 5).join(", ")}`,
  );
}

// ─── Download + extract ───────────────────────────────────────────────────────

async function downloadFile(
  url: string,
  destPath: string,
  onProgress: (received: number, total: number | undefined) => void,
): Promise<void> {
  const res = await fetch(url, {
    headers: { "User-Agent": "ModelBox/1.0" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const total = res.headers.get("content-length")
    ? parseInt(res.headers.get("content-length")!, 10)
    : undefined;

  const ws = createWriteStream(destPath);
  let received = 0;
  let lastEmit = 0;

  const reader = res.body!.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      ws.write(value);
      received += value.length;
      const now = Date.now();
      if (now - lastEmit >= 150) {
        onProgress(received, total);
        lastEmit = now;
      }
    }
  } finally {
    reader.releaseLock();
    ws.end();
    // Wait for write to finish
    await new Promise<void>((resolve, reject) => {
      ws.on("finish", resolve);
      ws.on("error", reject);
    });
  }
  onProgress(received, total);
}

async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  const isZip = archivePath.endsWith(".zip");
  const isTarGz = archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz");

  mkdirSync(destDir, { recursive: true });

  if (isZip) {
    // Windows tar.exe supports ZIP natively
    await execFileAsync("tar", ["-xf", archivePath, "-C", destDir], { timeout: 120000 });
  } else if (isTarGz) {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", destDir], { timeout: 120000 });
  } else {
    throw new Error(`Unsupported archive format: ${basename(archivePath)}`);
  }

  // Flatten if tar extracted into a single subdirectory.
  // Filter to directories only — the temp download file sits in destDir and
  // would otherwise make entries.length === 2 and skip the flatten.
  const allEntries = await readdir(destDir, { withFileTypes: true });
  const dirEntries = allEntries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (dirEntries.length === 1) {
    const sub = join(destDir, dirEntries[0]!);
    const subEntries = await readdir(sub);
    for (const e of subEntries) {
      await rename(join(sub, e), join(destDir, e));
    }
    await rm(sub, { recursive: true, force: true });
  }
}

// ─── Version file ─────────────────────────────────────────────────────────────

interface VersionJson {
  build: string;
  tier: GpuTier;
  gpuName?: string;
  installedAt: string;
}

function readVersionJson(): VersionJson | null {
  const versionPath = join(getLlamaRuntimeDir(), "version.json");
  if (!existsSync(versionPath)) return null;
  try {
    return JSON.parse(readFileSync(versionPath, "utf-8")) as VersionJson;
  } catch {
    return null;
  }
}

function writeVersionJson(v: VersionJson): void {
  writeFileSync(join(getLlamaRuntimeDir(), "version.json"), JSON.stringify(v, null, 2));
}

// ─── Public: read current llama runtime state ─────────────────────────────────

export function readLlamaRuntimeInfo(): LlamaRuntimeInfo {
  // Require all three to agree: DB flag (cleared when AppData is deleted),
  // exe on disk, and version.json. A running process can lock the exe and
  // prevent its deletion, so the DB flag is the authoritative "managed install"
  // signal — deleting AppData is always sufficient to reset the installed state.
  const isMarkedInstalled = getSetting("llama_runtime_installed") === "1";
  const exeExists = existsSync(getLlamaServerExePath());
  const version = readVersionJson();
  if (!isMarkedInstalled || !exeExists || !version) {
    return {
      status: "not-installed",
      installedBuild: null,
      installPath: null,
      tier: null,
      error: null,
    };
  }
  return {
    status: "installed",
    installedBuild: version.build,
    installPath: getLlamaServerExePath(),
    tier: version.tier,
    error: null,
  };
}

// ─── Public: install llama.cpp ────────────────────────────────────────────────

export async function installLlamaRuntime(
  onProgress: (e: RuntimeProgressEvent) => void,
): Promise<LlamaRuntimeInfo> {
  try {
    const gpuResult = await detectGpu();
    onProgress({ kind: "llama", phase: "gpu-detect", result: gpuResult });

    const release = await fetchLatestRelease();
    const build = buildTagFromRelease(release.tag_name);
    const asset = resolveAsset(release.assets, gpuResult.tier, build);

    onProgress({ kind: "llama", phase: "fetch-release", build, assetName: asset.name });

    const dir = getLlamaRuntimeDir();
    mkdirSync(dir, { recursive: true });
    const tmpPath = join(dir, ".tmp-download" + (asset.name.endsWith(".zip") ? ".zip" : ".tar.gz"));

    await downloadFile(asset.browser_download_url, tmpPath, (received, total) => {
      onProgress({ kind: "llama", phase: "download", receivedBytes: received, totalBytes: total });
    });

    onProgress({ kind: "llama", phase: "extract" });
    await extractArchive(tmpPath, dir);

    // Clean up temp file
    await rm(tmpPath, { force: true });

    // Ensure binary is executable on macOS/Linux (tar doesn't always preserve bits)
    if (process.platform !== "win32") {
      try { await execAsync(`chmod +x "${getLlamaServerExePath()}"`); } catch { /* best-effort */ }
    }

    writeVersionJson({
      build,
      tier: gpuResult.tier,
      gpuName: gpuResult.gpuName,
      installedAt: new Date().toISOString(),
    });

    setSetting("llama_server_path", getLlamaServerExePath());
    setSetting("llama_runtime_installed", "1");

    const info: LlamaRuntimeInfo = {
      status: "installed",
      installedBuild: build,
      installPath: getLlamaServerExePath(),
      tier: gpuResult.tier,
      error: null,
    };
    onProgress({ kind: "llama", phase: "complete", info });
    return info;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    onProgress({ kind: "llama", phase: "error", error });
    return {
      status: "error",
      installedBuild: null,
      installPath: null,
      tier: null,
      error,
    };
  }
}

export async function updateLlamaRuntime(
  onProgress: (e: RuntimeProgressEvent) => void,
): Promise<LlamaRuntimeInfo> {
  return installLlamaRuntime(onProgress);
}

// ─── vLLM setup interruption tracking ────────────────────────────────────────

function getVllmSetupMetaPath(): string {
  return join(getModelboxDir(), "vllm-setup-meta.json");
}

function _writeVllmSetupMeta(meta: VllmSetupMeta): void {
  try {
    writeFileSync(getVllmSetupMetaPath(), JSON.stringify(meta, null, 2));
  } catch { /* best-effort */ }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const writeVllmSetupMeta = _writeVllmSetupMeta;

function readVllmSetupMeta(): VllmSetupMeta | null {
  try {
    return JSON.parse(readFileSync(getVllmSetupMetaPath(), "utf-8")) as VllmSetupMeta;
  } catch {
    return null;
  }
}

function clearVllmSetupMeta(): void {
  try {
    unlinkSync(getVllmSetupMetaPath());
  } catch { /* already gone */ }
}

/**
 * Returns the interrupted-setup meta if the app was closed while pip install
 * was running. Auto-clears if vLLM is now fully installed (stale meta).
 */
export function readInterruptedVllmSetup(): VllmSetupMeta | null {
  const meta = readVllmSetupMeta();
  if (!meta) return null;
  if (readVllmRuntimeInfo().status === "installed") {
    clearVllmSetupMeta();
    return null;
  }
  return meta;
}

// ─── vLLM setup ───────────────────────────────────────────────────────────────

// Pause-and-confirm mechanism for in-setup prompts sent to the renderer.
let venvConfirmResolve: ((confirmed: boolean) => void) | null = null;

export function respondVenvConfirm(confirmed: boolean): void {
  venvConfirmResolve?.(confirmed);
  venvConfirmResolve = null;
}

function awaitVenvConfirm(onProgress: (e: RuntimeProgressEvent) => void): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    venvConfirmResolve = resolve;
    onProgress({ kind: "vllm", phase: "needs-venv-confirm" });
  });
}

function stripWslEncoding(raw: string): string {
  // wsl.exe outputs UTF-16LE; Node exec reads it as bytes → null bytes between chars.
  // Strip nulls + carriage returns so the result is plain ASCII text.
  return raw.replace(/\x00/g, "").replace(/\r/g, "");
}

async function getWslDefaultDistro(): Promise<string | null> {
  try {
    const { stdout } = await execAsync("wsl.exe --list --verbose", { timeout: 6000 });
    const clean = stripWslEncoding(stdout);
    // Lines look like: "* Ubuntu   Running   2"
    const line = clean.split("\n").find((l) => l.trim().startsWith("*"));
    if (!line) return null;
    const parts = line.trim().replace(/^\*\s*/, "").split(/\s+/);
    return parts[0] ?? null;
  } catch {
    return null;
  }
}

/** Reject distro names containing characters that could escape positional args (defensive). */
function sanitizeWslIdentifier(name: string): string {
  if (!/^[\w][\w .\-()]*$/.test(name)) {
    throw new Error(`Invalid WSL identifier: "${name}"`);
  }
  return name;
}

async function getWslUsername(distro?: string): Promise<string | null> {
  try {
    const args = distro
      ? ["-d", sanitizeWslIdentifier(distro), "--", "whoami"]
      : ["--", "whoami"];
    const { stdout } = await execFileAsync("wsl.exe", args, { timeout: 6000 });
    return stripWslEncoding(stdout).trim() || null;
  } catch {
    return null;
  }
}

function spawnAndStream(
  executable: string,
  args: string[],
  onLine: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    const onData = (data: Buffer): void => {
      const lines = data.toString().split(/\r?\n/);
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Process exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

// ─── Public: read current vLLM runtime state ──────────────────────────────────

export function readVllmRuntimeInfo(): VllmRuntimeInfo {
  if (process.platform === "darwin") {
    return { status: "not-installed", venvPath: null, wslDistro: null, error: null };
  }

  const venvDir = getVllmVenvDir();

  if (process.platform === "win32") {
    // Check if a managed WSL venv path is stored in settings
    try {
      const settings = getSettings();
      if (
        settings.vllmRuntime.envKind === "venv" &&
        settings.vllmRuntime.venvPath?.includes(".modelbox")
      ) {
        return {
          status: "installed",
          venvPath: settings.vllmRuntime.venvPath,
          wslDistro: settings.vllmRuntime.wslDistro ?? null,
          error: null,
        };
      }
    } catch {
      /* ignore */
    }
    return { status: "not-installed", venvPath: null, wslDistro: null, error: null };
  } else {
    // Linux: check if venv/bin/vllm exists
    const vllmBin = join(venvDir, "bin", "vllm");
    if (existsSync(vllmBin)) {
      return {
        status: "installed",
        venvPath: venvDir,
        wslDistro: null,
        error: null,
      };
    }
    return { status: "not-installed", venvPath: null, wslDistro: null, error: null };
  }
}

// ─── vLLM scan helper ────────────────────────────────────────────────────────

/** Run a scan and return the model list; swallow errors (scan is best-effort). */
async function scanVllmModelDirsSafe(dirs: string[]): Promise<VllmModel[]> {
  try {
    const result = await scanVllmModelDirs(dirs);
    return result.models;
  } catch {
    return [];
  }
}

// ─── Public: setup vLLM ───────────────────────────────────────────────────────

export async function setupVllm(
  onProgress: (e: RuntimeProgressEvent) => void,
): Promise<VllmRuntimeInfo> {
  if (process.platform === "darwin") {
    const error = "vLLM is not supported on macOS.";
    onProgress({ kind: "vllm", phase: "error", error });
    return { status: "error", venvPath: null, wslDistro: null, error };
  }
  try {
    if (process.platform === "win32") {
      return await setupVllmWsl(onProgress);
    } else {
      return await setupVllmLinux(onProgress);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    clearVllmSetupMeta();
    onProgress({ kind: "vllm", phase: "error", error });
    return { status: "error", venvPath: null, wslDistro: null, error };
  }
}

async function setupVllmWsl(
  onProgress: (e: RuntimeProgressEvent) => void,
): Promise<VllmRuntimeInfo> {
  const distro = await getWslDefaultDistro();
  if (!distro) {
    throw new Error("WSL is not available or no default distro found. Please install WSL 2 first.");
  }
  onProgress({ kind: "vllm", phase: "env-check", distro });

  const username = await getWslUsername(distro);
  if (!username) {
    console.warn("[runtime] Could not determine WSL username for distro:", distro, "— falling back to /root paths");
  }

  // Compute paths now so we can set vllm_model_dirs before pip install starts,
  // making models scannable immediately without waiting for install to finish.
  const hfCacheLinux = username
    ? `/home/${username}/.cache/huggingface/hub`
    : `/root/.cache/huggingface/hub`;
  const hfCacheWin = linuxPathToWslUnc(distro, hfCacheLinux);

  // Only set if the user hasn't already configured custom dirs.
  const existingModelDirs = getSetting("vllm_model_dirs");
  if (!existingModelDirs || existingModelDirs === "[]") {
    setSetting("vllm_model_dirs", JSON.stringify([hfCacheWin]));
  }

  // Scan now (WSL idle, no pip contention) and embed directly in the event.
  const dirsSetModels = await scanVllmModelDirsSafe([hfCacheWin]);
  onProgress({ kind: "vllm", phase: "dirs-set", models: dirsSetModels });

  // Pre-flight: verify python3 + ensurepip are present before touching disk.
  try {
    await execFileAsync(
      "wsl.exe",
      ["-d", sanitizeWslIdentifier(distro), "--", "python3", "-c", "import ensurepip"],
      { timeout: 10000 },
    );
  } catch {
    const confirmed = await awaitVenvConfirm(onProgress);
    if (!confirmed) throw new Error("Setup cancelled.");
    await spawnAndStream(
      "wsl.exe",
      ["-d", distro, "--", "bash", "-c", "sudo apt-get install -y python3-venv python3-full"],
      (line) => { onProgress({ kind: "vllm", phase: "pip-install", line }); },
    );
  }

  const cmd = [
    `mkdir -p ~/.modelbox`,
    `python3 -m venv ~/.modelbox/vllm-env`,
    `~/.modelbox/vllm-env/bin/pip install --upgrade pip`,
    `~/.modelbox/vllm-env/bin/pip install ninja vllm`,
  ].join(" && ");

  writeVllmSetupMeta({ distro, startedAt: new Date().toISOString() });

  await spawnAndStream("wsl.exe", ["-d", distro, "--", "bash", "-c", cmd], (line) => {
    onProgress({ kind: "vllm", phase: "pip-install", line });
  });

  const absVenvPath = username
    ? `/home/${username}/.modelbox/vllm-env`
    : `/root/.modelbox/vllm-env`;
  const wslUncPath = linuxPathToWslUnc(distro, absVenvPath);

  setSetting(
    "vllm_runtime_json",
    JSON.stringify({ envKind: "venv", venvPath: wslUncPath, wslDistro: distro }),
  );
  clearVllmSetupMeta();

  const info: VllmRuntimeInfo = {
    status: "installed",
    venvPath: wslUncPath,
    wslDistro: distro,
    error: null,
  };
  // Scan again after install so any newly downloaded models are picked up.
  const completeModels = await scanVllmModelDirsSafe([hfCacheWin]);
  onProgress({ kind: "vllm", phase: "complete", info, models: completeModels });
  return info;
}

async function setupVllmLinux(
  onProgress: (e: RuntimeProgressEvent) => void,
): Promise<VllmRuntimeInfo> {
  onProgress({ kind: "vllm", phase: "env-check" });

  const venvDir = getVllmVenvDir();
  const modelboxDir = getModelboxDir();

  // Set vllm_model_dirs before pip install so models are scannable immediately.
  // Only set if the user hasn't already configured custom dirs.
  const hfCacheLinux = join(homedir(), ".cache", "huggingface", "hub");
  const existingModelDirs = getSetting("vllm_model_dirs");
  if (!existingModelDirs || existingModelDirs === "[]") {
    setSetting("vllm_model_dirs", JSON.stringify([hfCacheLinux]));
  }

  // Scan now and embed directly in the event — no renderer-side IPC scan needed.
  const dirsSetModels = await scanVllmModelDirsSafe([hfCacheLinux]);
  onProgress({ kind: "vllm", phase: "dirs-set", models: dirsSetModels });

  // Pre-flight: verify python3 + ensurepip are present before touching disk.
  try {
    await execAsync(`python3 -c "import ensurepip"`, { timeout: 10000 });
  } catch {
    const confirmed = await awaitVenvConfirm(onProgress);
    if (!confirmed) throw new Error("Setup cancelled.");
    await spawnAndStream(
      "bash",
      ["-c", "sudo apt-get install -y python3-venv python3-full"],
      (line) => { onProgress({ kind: "vllm", phase: "pip-install", line }); },
    );
  }

  const cmd = [
    `mkdir -p "${modelboxDir}"`,
    `python3 -m venv "${venvDir}"`,
    `"${venvDir}/bin/pip" install --upgrade pip`,
    `"${venvDir}/bin/pip" install ninja vllm`,
  ].join(" && ");

  writeVllmSetupMeta({ startedAt: new Date().toISOString() });

  await spawnAndStream("bash", ["-c", cmd], (line) => {
    onProgress({ kind: "vllm", phase: "pip-install", line });
  });

  setSetting(
    "vllm_runtime_json",
    JSON.stringify({ envKind: "venv", venvPath: venvDir }),
  );
  clearVllmSetupMeta();

  const info: VllmRuntimeInfo = {
    status: "installed",
    venvPath: venvDir,
    wslDistro: null,
    error: null,
  };
  // Scan again after install in case new models were downloaded during pip.
  const completeModels = await scanVllmModelDirsSafe([hfCacheLinux]);
  onProgress({ kind: "vllm", phase: "complete", info, models: completeModels });
  return info;
}

// ─── Public: update vLLM ─────────────────────────────────────────────────────

export async function updateVllmRuntime(
  onProgress: (e: RuntimeProgressEvent) => void,
): Promise<VllmRuntimeInfo> {
  try {
    const current = readVllmRuntimeInfo();
    if (current.status !== "installed" || !current.venvPath) {
      throw new Error("vLLM is not installed. Use Setup vLLM first.");
    }

    onProgress({ kind: "vllm", phase: "env-check", distro: current.wslDistro ?? undefined });

    if (process.platform === "win32" && current.wslDistro) {
      const distro = current.wslDistro;
      const cmd = `~/.modelbox/vllm-env/bin/pip install --upgrade vllm`;
      await spawnAndStream("wsl.exe", ["-d", distro, "--", "bash", "-c", cmd], (line) => {
        onProgress({ kind: "vllm", phase: "pip-install", line });
      });
    } else {
      const venvDir = getVllmVenvDir();
      const cmd = `"${venvDir}/bin/pip" install --upgrade vllm`;
      await spawnAndStream("bash", ["-c", cmd], (line) => {
        onProgress({ kind: "vllm", phase: "pip-install", line });
      });
    }

    const settings = getSettings();
    const updateModels = await scanVllmModelDirsSafe(settings.vllmModelDirs ?? []);
    onProgress({ kind: "vllm", phase: "complete", info: current, models: updateModels });
    return current;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    onProgress({ kind: "vllm", phase: "error", error });
    return { status: "error", venvPath: null, wslDistro: null, error };
  }
}
