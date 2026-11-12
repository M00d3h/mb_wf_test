import path from "node:path";
import { homedir } from "os";
import { getDb } from "../database";
import type { AppSettings, VllmRuntimeConfig } from "@shared/types";
import { normalizeVllmRuntime } from "@shared/vllmRuntime";

function normalizeModelsDirKey(p: string): string {
  const t = p.trim();
  if (!t) return "";
  try {
    const n = path.normalize(path.resolve(t)).replace(/[/\\]+$/, "");
    return process.platform === "win32" ? n.toLowerCase() : n;
  } catch {
    return "";
  }
}

function parseModelsDirs(map: Record<string, string>): string[] {
  const json = map["models_dirs"];
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        const cleaned = parsed.map((s) => s.trim()).filter(Boolean);
        if (cleaned.length > 0) return cleaned;
      }
    } catch {
      /* fall through */
    }
  }
  const legacy = map["models_dir"];
  if (legacy && typeof legacy === "string" && legacy.trim()) {
    return [legacy.trim()];
  }
  return [path.join(homedir(), ".modelbox", "models")];
}

function parseVllmModelDirs(map: Record<string, string>): string[] {
  const json = map["vllm_model_dirs"];
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
        return parsed.map((s) => s.trim()).filter(Boolean);
      }
    } catch {
      /* ignore */
    }
  }
  return process.platform === "win32" ? [] : [path.join(homedir(), ".cache", "huggingface", "hub")];
}

function defaultVllmRuntime(): VllmRuntimeConfig {
  return {
    envKind: "conda",
    condaEnvName: "",
    condaShPath: "",
    venvPath: "",
    dockerImage: "vllm/vllm-openai:latest",
    dockerExtraArgs: "",
    wslDistro: "",
  };
}

const BIND_HOST_SET = new Set<string>(["127.0.0.1", "0.0.0.0"]);

function normalizeBindHost(
  raw: string | undefined,
  fallback: "127.0.0.1" | "0.0.0.0",
): string {
  const t = (raw ?? "").trim();
  return BIND_HOST_SET.has(t) ? t : fallback;
}

function clampPort(n: number, fallback: number): number {
  if (!Number.isFinite(n) || n < 1 || n > 65535) return fallback;
  return Math.floor(n);
}

function parseLlamaNetworkingDefaults(map: Record<string, string>): {
  host: string;
  port: number;
} {
  const host = normalizeBindHost(
    map["llama_default_host"] ?? map["default_host"],
    "0.0.0.0",
  );
  const port = clampPort(
    parseInt(map["llama_base_port"] ?? map["base_port"] ?? "8502", 10),
    8502,
  );
  return { host, port };
}

function parseVllmNetworkingDefaults(map: Record<string, string>): {
  host: string;
  port: number;
} {
  const host = normalizeBindHost(map["vllm_default_host"], "0.0.0.0");
  const port = clampPort(parseInt(map["vllm_base_port"] ?? "8000", 10), 8000);
  return { host, port };
}

function parseVllmRuntime(map: Record<string, string>): VllmRuntimeConfig {
  const json = map["vllm_runtime_json"];
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return normalizeVllmRuntime({
          ...defaultVllmRuntime(),
          ...(parsed as VllmRuntimeConfig),
        });
      }
    } catch {
      /* ignore */
    }
  }
  return defaultVllmRuntime();
}

function rowsToSettings(rows: { key: string; value: string }[]): AppSettings {
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  const llamaNet = parseLlamaNetworkingDefaults(map);
  const vllmNet = parseVllmNetworkingDefaults(map);
  return {
    modelsDirs: parseModelsDirs(map),
    vllmModelDirs: parseVllmModelDirs(map),
    vllmRuntime: parseVllmRuntime(map),
    llamaServerPath:
      map["llama_server_path"] ??
      (process.platform === "win32"
        ? "C:\\src\\llama.cpp\\build\\bin\\Release\\llama-server.exe"
        : "/usr/local/bin/llama-server"),
    cudaBinPath:
      map["cuda_bin_path"] ??
      "C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v13.1\\bin",
    llamaDefaultHost: llamaNet.host,
    llamaBasePort: llamaNet.port,
    vllmDefaultHost: vllmNet.host,
    vllmBasePort: vllmNet.port,
    firstRun: map["first_run"] !== "0",
    fontSize: parseInt(map["font_size"] ?? "14", 10),
    wslMode: map["wsl_mode"] === "1",
  };
}

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function getSettings(): AppSettings {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  return rowsToSettings(rows);
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    key,
    value,
  );
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  if (patch.modelsDirs !== undefined)
    setSetting("models_dirs", JSON.stringify(patch.modelsDirs));
  if (patch.llamaServerPath !== undefined)
    setSetting("llama_server_path", patch.llamaServerPath);
  if (patch.cudaBinPath !== undefined)
    setSetting("cuda_bin_path", patch.cudaBinPath);
  if (patch.llamaDefaultHost !== undefined)
    setSetting("llama_default_host", patch.llamaDefaultHost);
  if (patch.llamaBasePort !== undefined)
    setSetting("llama_base_port", String(patch.llamaBasePort));
  if (patch.vllmDefaultHost !== undefined)
    setSetting("vllm_default_host", patch.vllmDefaultHost);
  if (patch.vllmBasePort !== undefined)
    setSetting("vllm_base_port", String(patch.vllmBasePort));
  if (patch.firstRun !== undefined)
    setSetting("first_run", patch.firstRun ? "1" : "0");
  if (patch.fontSize !== undefined)
    setSetting("font_size", String(patch.fontSize));
  if (patch.wslMode !== undefined)
    setSetting("wsl_mode", patch.wslMode ? "1" : "0");
  if (patch.vllmModelDirs !== undefined)
    setSetting("vllm_model_dirs", JSON.stringify(patch.vllmModelDirs));
  if (patch.vllmRuntime !== undefined)
    setSetting("vllm_runtime_json", JSON.stringify(patch.vllmRuntime));
  return getSettings();
}

/** First directory used for new Hugging Face downloads. */
export function getPrimaryModelsDir(settings: AppSettings): string {
  const d = settings.modelsDirs[0]?.trim();
  return d && d.length > 0 ? d : path.join(homedir(), ".modelbox", "models");
}

export type ResolveModelsDirForHfDownloadResult =
  | { ok: true; modelsDir: string }
  | { ok: false; error: string };

/**
 * Resolves where a Hub download should be written. If `requested` is omitted,
 * uses the primary models directory. If provided, it must match a configured
 * `modelsDirs` entry (case- and slash-normalized on Windows).
 */
export function resolveModelsDirForHfDownload(
  settings: AppSettings,
  requested: string | undefined,
): ResolveModelsDirForHfDownloadResult {
  if (requested === undefined || requested.trim() === "") {
    return { ok: true, modelsDir: getPrimaryModelsDir(settings) };
  }
  const want = normalizeModelsDirKey(requested);
  for (const d of settings.modelsDirs) {
    if (normalizeModelsDirKey(d) === want) {
      return { ok: true, modelsDir: d.trim() };
    }
  }
  return {
    ok: false,
    error:
      "That folder is not one of your configured model directories in Settings.",
  };
}

export type ResolveVllmDirForHfDownloadResult =
  | { ok: true; vllmDir: string }
  | { ok: false; error: string };

/**
 * Resolves a Hub download target under configured `vllmModelDirs` (same
 * normalization rules as `modelsDirs`).
 */
export function resolveVllmDirForHfDownload(
  settings: AppSettings,
  requested: string | undefined,
): ResolveVllmDirForHfDownloadResult {
  if (settings.vllmModelDirs.length === 0) {
    return { ok: false, error: "Add at least one vLLM model directory in Settings." };
  }
  if (requested === undefined || requested.trim() === "") {
    return { ok: true, vllmDir: settings.vllmModelDirs[0]!.trim() };
  }
  const want = normalizeModelsDirKey(requested);
  for (const d of settings.vllmModelDirs) {
    if (normalizeModelsDirKey(d) === want) {
      return { ok: true, vllmDir: d.trim() };
    }
  }
  return {
    ok: false,
    error: "That folder is not one of your configured vLLM model directories in Settings.",
  };
}
