import { ipcMain } from "electron";
import { basename } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { getWslVmIp } from "../utils/wslPath";
import { getSettings } from "../db/repos/settings.repo";
import {
  createInstance,
  getInstance,
  listInstances,
  deleteInstance,
} from "../db/repos/serverInstances.repo";
import {
  getVllmModel,
  updateVllmModel,
  listVllmModels,
  deleteVllmModel,
} from "../db/repos/vllmModels.repo";
import {
  listVllmProfiles,
  getVllmProfile,
  createVllmProfile,
  updateVllmProfile,
  deleteVllmProfile,
  setActiveVllmProfile,
  duplicateVllmProfile,
} from "../db/repos/vllmProfiles.repo";
import { scanVllmModelDirs } from "../services/vllmModelScanner";
import {
  buildVllmCommandPlan,
  buildVllmFullCommandDisplay,
} from "../services/vllmCommandBuilder";
import {
  startProcess,
  isRunning,
  stopProcess,
  clearArchivedLogs,
} from "../services/processManager";
import { parseCommandLine } from "../services/commandLineParse";
import { mergeArgvIntoVllmConfig } from "../services/argvToVllmConfig";
import {
  readGenerationConfigForModelDir,
  readConfigJsonMetaForModelDir,
} from "../services/vllmModelScannerWsl";
import { deleteVllmModelFiles } from "../services/deleteVllmModelFiles";
import type { VllmModelConfig } from "@shared/types";

const portsBeingStarted = new Set<number>();

/**
 * Peel wsl.exe / bash -ic / sh -c wrapper layers to get the args of the actual
 * inner command (e.g. "conda run … vllm serve …").  Stops as soon as the
 * executable is no longer a shell wrapper.  Leaves docker/venv/native untouched.
 */
function unwrapInnerArgs(
  executable: string,
  args: string[],
): string[] {
  let exe = basename(executable).replace(/\.exe$/i, "").toLowerCase();
  let currentArgs = args;
  for (let depth = 0; depth < 8; depth++) {
    if (exe !== "wsl" && exe !== "bash" && exe !== "sh") return currentArgs;
    const icIdx = currentArgs.findIndex(
      (a) => a === "-ic" || a === "-lc" || a === "-c",
    );
    if (icIdx < 0 || currentArgs[icIdx + 1] === undefined) return currentArgs;
    const inner = currentArgs[icIdx + 1]!;
    let next: { executable: string; args: string[] };
    try {
      next = parseCommandLine(inner);
    } catch {
      return currentArgs;
    }
    exe = basename(next.executable).replace(/\.exe$/i, "").toLowerCase();
    currentArgs = next.args;
  }
  return currentArgs;
}

export function registerVllmIpc(): void {
  ipcMain.handle("vllm:generation-config", async (_e, modelPath: string) => {
    return readGenerationConfigForModelDir(modelPath);
  });

  ipcMain.handle("vllm:config-meta", async (_e, modelPath: string) => {
    return readConfigJsonMetaForModelDir(modelPath);
  });

  ipcMain.handle("vllm:list", async () => listVllmModels());

  ipcMain.handle("vllm:scan", async () => {
    const settings = getSettings();
    return await scanVllmModelDirs(settings.vllmModelDirs ?? []);
  });

  ipcMain.handle(
    "vllm:update",
    async (
      _e,
      id: string,
      patch: { displayName?: string; config?: Partial<VllmModelConfig> },
    ) => {
      return updateVllmModel(id, patch);
    },
  );

  ipcMain.handle("vllm:get", async (_e, id: string) => getVllmModel(id));

  ipcMain.handle("vllm:delete", async (_e, id: string) => {
    const model = getVllmModel(id)
    if (!model) throw new Error(`vLLM model ${id} not found`)

    // Stop running instances
    const instances = listInstances().filter((i) => i.vllmModelId === id)
    for (const inst of instances) {
      await stopProcess(inst.id)
      deleteInstance(inst.id)
      clearArchivedLogs(inst.id)
    }

    // Delete model files from disk
    await deleteVllmModelFiles(model.path)

    // Remove from DB (profiles cascade-delete via foreign key)
    deleteVllmModel(id)
  });

  ipcMain.handle("vllm:profiles:list", async (_e, vllmModelId: string) =>
    listVllmProfiles(vllmModelId),
  );

  ipcMain.handle(
    "vllm:profiles:create",
    async (
      _e,
      vllmModelId: string,
      name: string,
      config: VllmModelConfig,
    ) => {
      const profiles = listVllmProfiles(vllmModelId);
      const id = uuidv4();
      return createVllmProfile(id, vllmModelId, name, config, profiles.length === 0);
    },
  );

  ipcMain.handle(
    "vllm:profiles:update",
    async (
      _e,
      id: string,
      patch: { name?: string; config?: VllmModelConfig },
    ) => updateVllmProfile(id, patch),
  );

  ipcMain.handle("vllm:profiles:delete", async (_e, id: string) => {
    deleteVllmProfile(id);
  });

  ipcMain.handle("vllm:profiles:set-active", async (_e, id: string) => {
    setActiveVllmProfile(id);
  });

  ipcMain.handle("vllm:profiles:duplicate", async (_e, id: string) => {
    const source = getVllmProfile(id);
    if (!source) throw new Error(`vLLM profile ${id} not found`);
    const newId = uuidv4();
    return duplicateVllmProfile(id, newId, `${source.name} (copy)`);
  });

  ipcMain.handle(
    "vllm:profiles:build-command",
    async (
      _e,
      profileId: string,
      opts?: {
        forceBuilder?: boolean;
        configOverride?: VllmModelConfig;
      },
    ) => {
      const profile = getVllmProfile(profileId);
      if (!profile) throw new Error(`vLLM profile ${profileId} not found`);
      const vm = getVllmModel(profile.vllmModelId);
      if (!vm) throw new Error(`vLLM model ${profile.vllmModelId} not found`);
      const settings = getSettings();
      let cfg = opts?.configOverride ?? profile.config;
      if (opts?.forceBuilder === true) {
        cfg = { ...cfg, launchMode: "builder", customCommandLine: undefined };
      }
      const port = cfg.port ?? settings.vllmBasePort;
      const fullCommand = buildVllmFullCommandDisplay(vm, cfg, settings, port);
      const plan = buildVllmCommandPlan(vm, cfg, settings, port);
      return {
        fullCommand,
        executable: plan.executable,
        args: plan.args,
        // Spawn uses the real process env; never dump `process.env` into the UI
        // (would leak IDE tokens, PATH noise, and hundreds of unrelated vars).
        envDisplay: {} as Record<string, string>,
      };
    },
  );

  ipcMain.handle(
    "vllm:profiles:apply-custom-command-line",
    async (_e, id: string, line: string) => {
      const profile = getVllmProfile(id);
      if (!profile) throw new Error(`vLLM profile ${id} not found`);
      const trimmed = line.trim();
      if (!trimmed) throw new Error("Command line is empty");
      let parsed: { executable: string; args: string[] };
      try {
        parsed = parseCommandLine(trimmed);
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : String(e));
      }
      // WSL/bash wrappers hide the real vllm flags inside a bash -ic string arg,
      // so mergeArgvIntoVllmConfig can't see them from the outer argv.
      // Unwrap shell layers (wsl → bash -ic → inner) to get the actual vllm args.
      const argsForMerge = unwrapInnerArgs(parsed.executable, parsed.args);
      const base: VllmModelConfig = { ...profile.config };
      delete base.customCommandLine;
      delete base.launchMode;
      const merged = mergeArgvIntoVllmConfig(argsForMerge, base);
      // Regex fallback for --port in case unwrapping couldn't reach it.
      if (merged.port === undefined) {
        const m = trimmed.match(/--port[=\s]+(\d+)/);
        if (m) merged.port = parseInt(m[1]!, 10);
      }
      return updateVllmProfile(id, {
        config: {
          ...merged,
          launchMode: "custom",
          customCommandLine: trimmed,
        },
      });
    },
  );

  ipcMain.handle("vllm:start", async (_e, vllmProfileId: string) => {
    const profile = getVllmProfile(vllmProfileId);
    if (!profile) throw new Error(`vLLM profile ${vllmProfileId} not found`);
    const vm = getVllmModel(profile.vllmModelId);
    if (!vm) throw new Error(`vLLM model ${profile.vllmModelId} not found`);
    const settings = getSettings();
    const cfg = profile.config;
    // Priority: explicit profile port → port embedded in custom command string
    // (handles wsl.exe bash -ic "..." where --port is inside the quoted arg) →
    // settings base port.
    const portFromCmd = cfg.port == null && cfg.customCommandLine
      ? (() => { const m = cfg.customCommandLine.match(/--port[=\s]+(\d+)/); return m ? parseInt(m[1]!, 10) : null; })()
      : null;
    const requestedPort = cfg.port ?? portFromCmd ?? settings.vllmBasePort;
    const host = cfg.host ?? settings.vllmDefaultHost;

    let actualPort = requestedPort;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!portsBeingStarted.has(actualPort)) {
        const dbConflict = listInstances().some(
          (i) =>
            i.port === actualPort &&
            isRunning(i.id) &&
            (i.state === "running" ||
              i.state === "starting" ||
              i.state === "loading"),
        );
        if (!dbConflict) break;
      }
      actualPort++;
    }
    if (actualPort >= requestedPort + 100) {
      throw new Error(`No free port found starting from ${requestedPort}`);
    }
    portsBeingStarted.add(actualPort);

    const plan = buildVllmCommandPlan(vm, cfg, settings, actualPort);
    const id = uuidv4();

    // On Windows, vLLM runs inside WSL2. We store the Windows-side host in the
    // DB (for display and LAN sharing) but pass the WSL2 VM's Hyper-V NIC IP as
    // connectionHost so health polling and Chromium fetch bypass the unreliable
    // wslhost.exe loopback. Docker plans are excluded (port mapped to Windows host).
    const isDockerPlan = /^docker$/i.test(basename(plan.executable));
    let connectionHost: string | undefined;
    if (process.platform === "win32" && !isDockerPlan) {
      const wslIp = getWslVmIp();
      if (wslIp) connectionHost = wslIp;
    }

    try {
      createInstance({
        id,
        instanceKind: "vllm",
        vllmModelId: vm.id,
        vllmProfileId: profile.id,
        host,
        port: actualPort,
      });
      startProcess(id, plan.executable, plan.args, plan.env, host, actualPort, "vllm", connectionHost);
    } finally {
      portsBeingStarted.delete(actualPort);
    }
    return getInstance(id)!;
  });
}
