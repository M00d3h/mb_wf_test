import { useEffect } from "react";
import {
  MemoryRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { ModelsPage } from "./pages/ModelsPage";
import { ServerPage } from "./pages/ServerPage";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import { HuggingFacePage } from "./pages/HuggingFacePage";
import { FirstRunPage } from "./pages/FirstRunPage";
import { ArchivedChatsMenu } from "./components/chat/ArchivedChatsMenu";
import { useSettingsStore } from "./store/settingsStore";
import { useServerStore } from "./store/serverStore";
import { useChatStore } from "./store/chatStore";
import { api } from "./lib/ipc";
import type { HfDownloadProgressEvent } from "@shared/types";
import { useHfDownloadStore } from "./store/hfDownloadStore";
import { useModelsStore } from "./store/modelsStore";
import { useVllmStore } from "./store/vllmStore";
import { useVllmSetupStore } from "./store/vllmSetupStore";
import { useMCPStore } from "./store/mcpStore";
import { useUpdateStore } from "./store/updateStore";
import type { MCPServerStatus } from "@shared/types";

/** One disk scan per app process (avoids duplicate runs under React Strict Mode in dev). */
let bootModelScanDone = false;
let bootVllmScanDone = false;
let bootInterruptedLoaded = false;
let bootVllmSetupChecked = false;
let bootUpdateChecked = false;

// Inner component rendered inside <MemoryRouter> so useNavigate has a Router context.
function AppRoutes(): JSX.Element {
  const { navigationTarget, setNavigationTarget } = useChatStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (navigationTarget) {
      navigate(navigationTarget);
      setNavigationTarget(null);
    }
  }, [navigationTarget, navigate, setNavigationTarget]);

  return (
    <Routes>
      <Route path="/first-run" element={<FirstRunPage />} />
      <Route element={<Layout />}>
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/huggingface" element={<HuggingFacePage />} />
        <Route path="/server" element={<ServerPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/models" replace />} />
      </Route>
    </Routes>
  );
}

export default function App(): JSX.Element {
  const { settings, fetch: fetchSettings } = useSettingsStore();
  const { onLogChunk, onStateChange, onQueueUpdate } = useServerStore();
  const { showArchivedMenu, setShowArchivedMenu } = useChatStore();

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (!settings) return;
    if (!bootModelScanDone) {
      bootModelScanDone = true;
      void useModelsStore.getState().scanModels();
    }
    if (!bootVllmScanDone) {
      bootVllmScanDone = true;
      if (settings.vllmModelDirs?.some((d) => d.trim() !== "")) {
        void useVllmStore.getState().scan();
      }
    }
    if (!bootInterruptedLoaded) {
      bootInterruptedLoaded = true;
      void api.hf.getAllIncompleteMetas().then((metas) => {
        const store = useHfDownloadStore.getState();
        for (const meta of metas) {
          if (meta.errorMessage) store.addFailed(meta);
          else store.addInterrupted(meta);
        }
      }).catch(() => {});
    }
    if (!bootVllmSetupChecked) {
      bootVllmSetupChecked = true;
      void api.runtime.getStatus().then(({ vllm }) => {
        useVllmSetupStore.getState().setRuntimeInfo(vllm);
      }).catch(() => {});
      void api.runtime.getInterruptedVllmSetup().then((meta) => {
        if (meta) useVllmSetupStore.getState().markInterrupted(meta);
      }).catch(() => {});
    }
    if (!bootUpdateChecked) {
      bootUpdateChecked = true;
      void api.update.check().then((result) => {
        useUpdateStore.getState().setCurrentVersion(result.currentVersion);
        if (result.hasUpdate) {
          useUpdateStore.getState().setAvailable(result);
        }
      }).catch(() => {});
    }
  }, [settings]);

  useEffect(() => {
    if (settings) {
      document.documentElement.style.setProperty(
        "--font-size",
        `${settings.fontSize}px`,
      );
    }
  }, [settings?.fontSize]);

  useEffect(() => {
    if (settings) {
      document.documentElement.style.fontSize = `${settings.fontSize}px`;
    }
  }, [settings?.fontSize]);

  // Wire IPC events
  useEffect(() => {
    const offHf = api.on("hf:download-progress", (_e, payload) => {
      const p = payload as HfDownloadProgressEvent;
      useHfDownloadStore.getState().applyProgressEvent(p);
      if (p.phase === "complete") {
        const entry = useHfDownloadStore.getState().downloads[p.downloadId];
        if (entry?.vllmTarget) {
          void useVllmStore.getState().scan();
        } else {
          void useModelsStore.getState().scanModels();
        }
      }
    });
    return () => {
      offHf();
    };
  }, []);

  useEffect(() => {
    const offLog = api.on("server:log-chunk", (_e, line) =>
      onLogChunk(line as Parameters<typeof onLogChunk>[0]),
    );
    const offState = api.on("server:state-change", (_e, payload) =>
      onStateChange(payload as Parameters<typeof onStateChange>[0]),
    );
    const offQueue = api.on("server:queue-update", (_e, payload) =>
      onQueueUpdate(payload as Parameters<typeof onQueueUpdate>[0]),
    );
    const offMcp = api.on("mcp:status-update", (_e, status) => {
      const mcpStore = useMCPStore.getState()
      mcpStore.applyStatusUpdate(status as MCPServerStatus[])
    });
    return () => {
      offLog();
      offState();
      offQueue();
      offMcp();
    };
  }, [onLogChunk, onStateChange, onQueueUpdate]);

  if (!settings) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-400 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <>
      <MemoryRouter
        initialEntries={[settings.firstRun ? "/first-run" : "/models"]}
      >
        <AppRoutes />
      </MemoryRouter>
      {showArchivedMenu && (
        <ArchivedChatsMenu onClose={() => setShowArchivedMenu(false)} />
      )}
    </>
  );
}
