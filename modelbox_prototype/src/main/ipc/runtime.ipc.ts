import { BrowserWindow, ipcMain } from "electron";
import {
  detectGpu,
  installLlamaRuntime,
  readInterruptedVllmSetup,
  readLlamaRuntimeInfo,
  readVllmRuntimeInfo,
  respondVenvConfirm,
  setupVllm,
  updateLlamaRuntime,
  updateVllmRuntime,
} from "../services/runtimeManager";
import type { RuntimeProgressEvent } from "@shared/types";

function sendRuntimeProgress(payload: RuntimeProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("runtime:progress", payload);
    }
  }
}

export function registerRuntimeIpc(): void {
  ipcMain.handle("runtime:get-status", () => ({
    llama: readLlamaRuntimeInfo(),
    vllm: readVllmRuntimeInfo(),
  }));

  ipcMain.handle("runtime:detect-gpu", () => detectGpu());

  ipcMain.handle("runtime:install-llama", () =>
    installLlamaRuntime((e) => sendRuntimeProgress(e)),
  );

  ipcMain.handle("runtime:setup-vllm", () =>
    setupVllm((e) => sendRuntimeProgress(e)),
  );

  ipcMain.handle("runtime:update-llama", () =>
    updateLlamaRuntime((e) => sendRuntimeProgress(e)),
  );

  ipcMain.handle("runtime:update-vllm", () =>
    updateVllmRuntime((e) => sendRuntimeProgress(e)),
  );

  ipcMain.handle("runtime:get-interrupted-vllm-setup", () =>
    readInterruptedVllmSetup(),
  );

  ipcMain.handle("runtime:respond-venv-confirm", (_, confirmed: boolean) => {
    respondVenvConfirm(confirmed);
  });
}
