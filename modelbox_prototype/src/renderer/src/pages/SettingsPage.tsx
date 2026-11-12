import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LlamaRuntimeInfo, VllmRuntimeInfo, RuntimeProgressEvent } from "@shared/types";
import { useLocation } from "react-router-dom";
import {
  Archive,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Moon,
  Sun,
  Plus,
  Trash2,
  RefreshCw,
  Plug,
  PlugZap,
  Search,
  Monitor,
} from "lucide-react";
import { useSettingsStore } from "../store/settingsStore";
import { useThemeStore } from "../store/themeStore";
import { useChatStore } from "../store/chatStore";
import { useMCPStore } from "../store/mcpStore";
import { useVllmSetupStore } from "../store/vllmSetupStore";
import { useUpdateStore } from "../store/updateStore";
import { isVllmConfigured } from "../lib/runtimeUtils";
import { api } from "../lib/ipc";
import { cn } from "../lib/utils";
import { ModelsDirsEditor } from "../components/settings/ModelsDirsEditor";
import type {
  AppSettings,
  MCPServerConfig,
  MCPTransport,
  // VllmEnvKind, // unused while venv/docker runtime options are disabled
} from "@shared/types";
import { VllmModelDirsEditor } from "../components/settings/VllmModelDirsEditor";
import claudecodeColorIcon from "../assets/claudecode-color.svg";
import huggingfaceColorIcon from "../assets/huggingface-color.svg";
import llamacppIcon from "../assets/llamacpp-icon.png";
import mcpIcon from "../assets/mcp.svg";
import vllmColorIcon from "../assets/vllm-color.svg";

const INPUT_CLASS_BASE =
  "w-full rounded-lg border border-zinc-700/60 bg-zinc-800/80 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 transition-colors focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/20";

/** Bind hosts exposed as defaults for llama.cpp and vLLM profiles. */
const PROFILE_BIND_HOST_OPTIONS = ["127.0.0.1", "0.0.0.0"] as const;

const PROFILE_BIND_HOST_MENU_OPTIONS: { value: string; label: string }[] =
  PROFILE_BIND_HOST_OPTIONS.map((h) => ({ value: h, label: h }));

// venv and Docker runtime options are disabled for this release; only conda is supported.
// const VLLM_RUNTIME_MENU_OPTIONS: { value: VllmEnvKind; label: string }[] = [...];

function useSettingsInputClass(extraClass?: string): string {
  const { theme } = useThemeStore();
  return cn(
    INPUT_CLASS_BASE,
    theme === "light" ? "shadow-none ring-1 ring-zinc-700/15" : "shadow-sm",
    extraClass,
  );
}

/** Native `<select>` popovers cannot be themed on Electron; matches MCP transport styling. */
function SettingsMenuSelect({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  options: readonly { value: string; label: string }[];
  ariaLabel: string;
  className?: string;
}): JSX.Element {
  const { theme } = useThemeStore();
  const inputClass = useSettingsInputClass();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected =
    options.find((o) => o.value === value) ?? options[0] ?? {
      value,
      label: value,
    };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          inputClass,
          "flex w-full cursor-pointer items-center justify-between gap-2 text-left font-sans",
        )}
      >
        <span className="min-w-0 truncate">{selected.label}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-200",
            theme === "light" ? "text-neutral-500" : "text-zinc-500",
            open && "-rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <ul
          role="listbox"
          className={cn(
            "absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border py-0.5 shadow-lg backdrop-blur-md",
            theme === "light"
              ? "border-neutral-200/90 bg-white/95 ring-1 ring-black/[0.04] shadow-black/10"
              : "border-zinc-700/50 bg-zinc-900/95 ring-1 ring-inset ring-white/[0.05] shadow-black/50",
          )}
        >
          {options.map((o) => (
            <li key={o.value} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={cn(
                  "flex w-full items-center px-2.5 py-2 text-left text-sm transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/35 focus-visible:ring-offset-0",
                  o.value === value
                    ? theme === "light"
                      ? "bg-cyan-500/12 font-medium text-cyan-800"
                      : "bg-cyan-500/15 font-medium text-cyan-300"
                    : theme === "light"
                      ? "text-neutral-800 hover:bg-neutral-100"
                      : "text-zinc-200 hover:bg-zinc-800/90",
                )}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const DEBOUNCE_MS = 400;

/** Simpler debounced text: commits patch with key from `field`. */
function DebouncedPathInput({
  field,
  value,
  update,
}: {
  field: keyof AppSettings;
  value: string;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}): JSX.Element {
  const inputClass = useSettingsInputClass();
  const { theme } = useThemeStore();
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const schedule = useCallback(
    (v: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void update({ [field]: v } as Partial<AppSettings>);
      }, DEBOUNCE_MS);
    },
    [field, update],
  );

  return (
    <div className="flex gap-1.5">
      <input
        value={local}
        onChange={(e) => {
          const v = e.target.value;
          setLocal(v);
          schedule(v);
        }}
        onBlur={(e) => {
          if (timer.current) clearTimeout(timer.current);
          void update({ [field]: e.target.value } as Partial<AppSettings>);
        }}
        className={cn(inputClass, "min-w-0 flex-1 font-mono text-[13px]")}
        spellCheck={false}
      />
      <button
        type="button"
        onClick={async () => {
          const path = await api.settings.pickDirectory();
          if (!path) return;
          setLocal(path);
          void update({ [field]: path } as Partial<AppSettings>);
        }}
        className={cn(
          "shrink-0 rounded-lg border p-1.5 transition-colors",
          theme === "light"
            ? "border-zinc-600/45 bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800/75 hover:text-zinc-300"
            : "border-zinc-700/60 bg-zinc-800/80 text-zinc-500 hover:bg-zinc-700/80 hover:text-zinc-300",
        )}
        title="Browse"
      >
        <FolderOpen className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function DebouncedFileInput({
  field,
  value,
  update,
  pickFile,
}: {
  field: keyof AppSettings;
  value: string;
  update: (patch: Partial<AppSettings>) => Promise<void>;
  pickFile: () => Promise<void>;
}): JSX.Element {
  const inputClass = useSettingsInputClass();
  const { theme } = useThemeStore();
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const schedule = useCallback(
    (v: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void update({ [field]: v } as Partial<AppSettings>);
      }, DEBOUNCE_MS);
    },
    [field, update],
  );

  return (
    <div className="flex gap-1.5">
      <input
        value={local}
        onChange={(e) => {
          const v = e.target.value;
          setLocal(v);
          schedule(v);
        }}
        onBlur={(e) => {
          if (timer.current) clearTimeout(timer.current);
          void update({ [field]: e.target.value } as Partial<AppSettings>);
        }}
        className={cn(inputClass, "min-w-0 flex-1 font-mono text-[13px]")}
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => void pickFile()}
        className={cn(
          "shrink-0 rounded-lg border p-1.5 transition-colors",
          theme === "light"
            ? "border-zinc-600/45 bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800/75 hover:text-zinc-300"
            : "border-zinc-700/60 bg-zinc-800/80 text-zinc-500 hover:bg-zinc-700/80 hover:text-zinc-300",
        )}
        title="Browse file"
      >
        <FolderOpen className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function SettingsCard({
  title,
  description,
  children,
  id,
  className,
  titleIcon,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  id?: string;
  className?: string;
  titleIcon?: React.ReactNode;
}): JSX.Element {
  const { theme } = useThemeStore();
  return (
    <section
      id={id}
      className={cn(
        "overflow-hidden rounded-2xl",
        theme === "light"
          ? "border border-zinc-700/35 bg-zinc-950/55 shadow-none ring-1 ring-zinc-700/20"
          : "bg-zinc-900/35 ring-1 ring-white/[0.06] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
        className,
      )}
    >
      <div
        className={cn(
          "border-b px-4 py-3",
          theme === "light" ? "border-zinc-800/30" : "border-white/[0.06]",
        )}
      >
        <div className="flex items-start gap-2.5">
          {titleIcon ? (
            <div className="shrink-0 pt-0.5 [&_img]:block">{titleIcon}</div>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-medium text-zinc-200">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
                {description}
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <div
        className={cn(
          "divide-y",
          theme === "light" ? "divide-zinc-800/30" : "divide-white/[0.06]",
        )}
      >
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={cn(
        "flex min-h-[3rem] flex-col justify-center gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-2",
        className,
      )}
    >
      <div className="min-w-0 shrink-0 sm:max-w-[45%]">
        <p className="text-sm text-zinc-200">{label}</p>
        {hint ? (
          <p className="mt-0.5 text-xs leading-snug text-zinc-500">{hint}</p>
        ) : null}
      </div>
      <div className="min-w-0 flex-1 sm:flex sm:justify-end">{children}</div>
    </div>
  );
}

function RowStack({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-2 px-4 py-3">
      <div>
        <p className="text-sm text-zinc-200">{label}</p>
        {hint ? (
          <p className="mt-0.5 text-xs leading-snug text-zinc-500">{hint}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

// ── MCP Servers Section ───────────────────────────────────────────────────────

type TransportOption = { value: MCPTransport; label: string }
const TRANSPORT_OPTIONS: TransportOption[] = [
  { value: 'stdio', label: 'stdio (local process)' },
  { value: 'sse', label: 'SSE (HTTP server-sent events)' },
  { value: 'http', label: 'Streamable HTTP' },
]

const EMPTY_FORM: Omit<MCPServerConfig, 'id' | 'createdAt'> = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '[]',
  url: '',
  token: '',
  env: '{}',
  enabled: true,
}

type McpEditSubTab = "details" | "permissions";

function MCPServerPermissionsPanel({ serverName }: { serverName: string }): JSX.Element {
  const { theme } = useThemeStore();
  const { tools, isAlwaysAllowed, setAlwaysAllowForTool } = useMCPStore();
  const [toolSearch, setToolSearch] = useState("");

  const serverTools = useMemo(() => {
    return tools
      .filter((t) => t.serverName === serverName)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tools, serverName]);

  const filteredTools = useMemo(() => {
    const q = toolSearch.trim().toLowerCase();
    if (!q) return serverTools;
    return serverTools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q),
    );
  }, [serverTools, toolSearch]);

  if (!serverName) {
    return (
      <div
        className={cn(
          "py-6 text-center text-sm",
          theme === "light" ? "text-neutral-600" : "text-zinc-500",
        )}
      >
        Save the server first, then open permissions.
      </div>
    );
  }

  if (serverTools.length === 0) {
    return (
      <div
        className={cn(
          "py-6 text-center text-sm",
          theme === "light" ? "text-neutral-600" : "text-zinc-500",
        )}
      >
        No tools discovered for this server yet. Use Reconnect all below if they
        should appear.
      </div>
    );
  }

  return (
    <div className="flex max-h-[min(60vh,22rem)] flex-col overflow-hidden">
      <p
        className={cn(
          "shrink-0 pb-2 text-xs leading-relaxed",
          theme === "light" ? "text-neutral-600" : "text-zinc-500",
        )}
      >
        For each tool, choose <span className="font-medium">Ask</span> to confirm
        every call, or <span className="font-medium">Always allow</span> to run it
        without a prompt. Preferences are saved on this device.
      </p>
      <div
        className={cn(
          "mb-2 flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1.5",
          theme === "light"
            ? "border-neutral-200/90 bg-white/90"
            : "border-zinc-600/50 bg-zinc-950/50",
        )}
      >
        <Search
          className={cn(
            "h-3.5 w-3.5 shrink-0 opacity-70",
            theme === "light" ? "text-neutral-500" : "text-zinc-500",
          )}
          aria-hidden
        />
        <input
          type="text"
          inputMode="search"
          autoComplete="off"
          value={toolSearch}
          onChange={(e) => setToolSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setToolSearch("");
          }}
          placeholder="Search tools…"
          className={cn(
            "box-border min-h-0 min-w-0 flex-1 rounded border-0 bg-transparent py-0.5 text-[11px] leading-normal outline-none ring-0 transition-colors placeholder:text-[11px] focus:ring-0",
            theme === "light"
              ? "text-neutral-900 placeholder:text-neutral-400"
              : "text-zinc-100 placeholder:text-zinc-600",
          )}
          aria-label="Search tools"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
        {filteredTools.length === 0 && toolSearch.trim() !== "" ? (
          <div className="flex flex-col items-center justify-center px-2 py-6 text-center">
            <p
              className={cn(
                "text-sm",
                theme === "light" ? "text-neutral-700" : "text-zinc-500",
              )}
            >
              No tools match your search.
            </p>
            <button
              type="button"
              className={cn(
                "mt-2 text-xs underline-offset-2 hover:underline",
                theme === "light" ? "text-cyan-700" : "text-cyan-400",
              )}
              onClick={() => setToolSearch("")}
            >
              Clear search
            </button>
          </div>
        ) : (
        filteredTools.map((tool) => {
          const always = isAlwaysAllowed(serverName, tool.name);
          return (
            <div
              key={`${serverName}:${tool.name}`}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5",
                theme === "light" ? "bg-neutral-100/80" : "bg-zinc-950/40",
              )}
            >
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    theme === "light" ? "text-neutral-900" : "text-zinc-200",
                  )}
                >
                  {tool.name}
                </p>
                {tool.description ? (
                  <p
                    className={cn(
                      "truncate text-[10px]",
                      theme === "light" ? "text-neutral-600" : "text-zinc-600",
                    )}
                  >
                    {tool.description}
                  </p>
                ) : null}
              </div>
              <div
                className={cn(
                  "inline-flex shrink-0 overflow-hidden rounded-lg border",
                  theme === "light"
                    ? "divide-x divide-neutral-200/90 border-neutral-200/90 bg-white/90"
                    : "divide-x divide-zinc-700/60 border-zinc-700/60 bg-zinc-900/60",
                )}
                role="group"
                aria-label={`Permission for ${tool.name}`}
              >
                <button
                  type="button"
                  onClick={() => setAlwaysAllowForTool(serverName, tool.name, false)}
                  className={cn(
                    "rounded-none px-2.5 py-1 text-[11px] font-medium transition-colors",
                    !always
                      ? theme === "light"
                        ? "bg-cyan-500/15 text-cyan-800"
                        : "bg-cyan-500/15 text-cyan-300"
                      : theme === "light"
                        ? "text-neutral-600 hover:bg-neutral-100"
                        : "text-zinc-500 hover:bg-zinc-800/80",
                  )}
                >
                  Ask
                </button>
                <button
                  type="button"
                  onClick={() => setAlwaysAllowForTool(serverName, tool.name, true)}
                  className={cn(
                    "rounded-none px-2.5 py-1 text-[11px] font-medium transition-colors",
                    always
                      ? theme === "light"
                        ? "bg-emerald-500/15 text-emerald-800"
                        : "bg-emerald-500/15 text-emerald-400"
                      : theme === "light"
                        ? "text-neutral-600 hover:bg-neutral-100"
                        : "text-zinc-500 hover:bg-zinc-800/80",
                  )}
                >
                  Always allow
                </button>
              </div>
            </div>
          );
        })
        )}
      </div>
    </div>
  );
}

function MCPServersSection(): JSX.Element {
  const { theme } = useThemeStore()
  const {
    servers,
    status,
    tools,
    loadServers,
    refreshStatus,
    createServer,
    updateServer,
    deleteServer,
    reconnectAll,
  } = useMCPStore()

  const inputClass = useSettingsInputClass()
  const labelClass = cn(
    "text-[11px]",
    theme === "light" ? "text-neutral-600" : "text-zinc-500",
  )
  const [showAdd, setShowAdd] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [testResult, setTestResult] = useState<{ serverName: string; tools: number } | null>(null)
  const [transportOpen, setTransportOpen] = useState(false)
  const transportRef = useRef<HTMLDivElement>(null)
  const [editSubTab, setEditSubTab] = useState<McpEditSubTab>("details")

  useEffect(() => {
    void loadServers()
    void refreshStatus()
  }, [loadServers, refreshStatus])

  useEffect(() => {
    if (!showAdd) setTransportOpen(false)
  }, [showAdd])

  useEffect(() => {
    if (!transportOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!transportRef.current?.contains(e.target as Node)) setTransportOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setTransportOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [transportOpen])

  const openAdd = (): void => {
    setForm(EMPTY_FORM)
    setEditId(null)
    setEditSubTab("details")
    setShowAdd(true)
    setTestResult(null)
  }

  const openEdit = (server: MCPServerConfig): void => {
    setEditSubTab("details")
    setForm({
      name: server.name,
      transport: server.transport,
      command: server.command ?? '',
      args: server.args ?? '[]',
      url: server.url ?? '',
      token: server.token ?? '',
      env: server.env ?? '{}',
      enabled: server.enabled,
    })
    setEditId(server.id)
    setShowAdd(true)
    setTestResult(null)
  }

  const handleSave = async (): Promise<void> => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (editId) {
        await updateServer(editId, form)
      } else {
        await createServer(form)
      }
      setShowAdd(false)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    await deleteServer(id)
  }

  const handleReconnectAll = async (): Promise<void> => {
    setReconnecting(true)
    try {
      await reconnectAll()
    } finally {
      setReconnecting(false)
    }
  }

  const handleToggleEnabled = async (server: MCPServerConfig): Promise<void> => {
    await updateServer(server.id, { enabled: !server.enabled })
  }

  const divClass = cn(
    "divide-y",
    theme === "light" ? "divide-neutral-200/90" : "divide-white/[0.06]",
  )

  return (
    <SettingsCard
      id="settings-mcp-servers"
      className="scroll-mt-6"
      title="MCP Servers"
      description="Connect to Model Context Protocol servers. Edit a server to adjust tool permissions."
      titleIcon={
        <img
          src={mcpIcon}
          alt=""
          className={cn(
            "h-7 w-7 shrink-0 object-contain",
            theme === "dark" && "brightness-0 invert",
          )}
          draggable={false}
        />
      }
    >
      <div className={divClass}>
        {/* Server list */}
        {servers.length === 0 && !showAdd && (
          <div
            className={cn(
              "px-4 py-5 text-center text-sm",
              theme === "light" ? "text-neutral-600" : "text-zinc-500",
            )}
          >
            No MCP servers configured yet.
          </div>
        )}
        {servers.map((server) => {
          const st = status.find((s) => s.serverName === server.name)
          const toolCount = tools.filter((t) => t.serverName === server.name).length
          return (
            <div key={server.id} className="flex items-center gap-3 px-4 py-2.5">
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  !server.enabled
                    ? theme === "light"
                      ? "bg-neutral-400"
                      : "bg-zinc-600"
                    : st?.connected === true || (st == null && toolCount > 0)
                      ? "bg-emerald-400"
                      : st?.connected === false
                        ? "bg-red-400"
                        : st == null
                          ? theme === "light"
                            ? "bg-neutral-400"
                            : "bg-zinc-500"
                          : "bg-emerald-400",
                )}
                title={
                  !server.enabled
                    ? "Server disabled"
                    : st?.connected === false
                      ? st.error ?? "Disconnected"
                      : st?.connected === true || toolCount > 0
                        ? "Connected"
                        : "Connection status pending…"
                }
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    theme === "light" ? "text-neutral-900" : "text-zinc-200",
                  )}
                >
                  {server.name}
                </p>
                <p
                  className={cn(
                    "text-[11px]",
                    theme === "light" ? "text-neutral-600" : "text-zinc-500",
                  )}
                >
                  {server.transport}
                  {server.command ? ` · ${server.command}` : ''}
                  {server.url ? ` · ${server.url}` : ''}
                  {st?.connected ? ` · ${toolCount} tool${toolCount !== 1 ? 's' : ''}` : ''}
                  {st?.error ? ` · Error: ${st.error}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleToggleEnabled(server)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                    server.enabled
                      ? theme === "light"
                        ? "bg-cyan-500/15 text-cyan-800 hover:bg-cyan-500/25"
                        : "bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25"
                      : theme === "light"
                        ? "bg-neutral-200/90 text-neutral-600 hover:bg-neutral-300/90"
                        : "bg-zinc-700/40 text-zinc-500 hover:bg-zinc-700/70",
                  )}
                >
                  {server.enabled ? 'Enabled' : 'Disabled'}
                </button>
                <button
                  type="button"
                  onClick={() => openEdit(server)}
                  className={cn(
                    "rounded-md p-1 transition-colors",
                    theme === "light"
                      ? "text-neutral-600 hover:bg-neutral-200/90 hover:text-neutral-900"
                      : "text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-300",
                  )}
                  title="Edit"
                >
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(server.id)}
                  className={cn(
                    "rounded-md p-1 transition-colors",
                    theme === "light"
                      ? "text-neutral-600 hover:bg-red-500/10 hover:text-red-600"
                      : "text-zinc-500 hover:bg-red-500/15 hover:text-red-400",
                  )}
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )
        })}

        {/* Add / Edit form */}
        {showAdd && (
          <div className="px-4 py-3 flex flex-col gap-3">
            <p
              className={cn(
                "text-xs font-semibold",
                theme === "light" ? "text-neutral-700" : "text-zinc-400",
              )}
            >
              {editId ? 'Edit server' : 'Add server'}
            </p>

            {editId ? (
              <div
                className={cn(
                  "flex gap-1 rounded-lg p-0.5",
                  theme === "light" ? "bg-neutral-200/50" : "bg-zinc-800/80",
                )}
                role="tablist"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={editSubTab === "details"}
                  onClick={() => setEditSubTab("details")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    editSubTab === "details"
                      ? theme === "light"
                        ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200/90"
                        : "bg-zinc-700/90 text-zinc-100 ring-1 ring-white/[0.08]"
                      : theme === "light"
                        ? "text-neutral-600 hover:text-neutral-900"
                        : "text-zinc-500 hover:text-zinc-300",
                  )}
                >
                  Details
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editSubTab === "permissions"}
                  onClick={() => setEditSubTab("permissions")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    editSubTab === "permissions"
                      ? theme === "light"
                        ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200/90"
                        : "bg-zinc-700/90 text-zinc-100 ring-1 ring-white/[0.08]"
                      : theme === "light"
                        ? "text-neutral-600 hover:text-neutral-900"
                        : "text-zinc-500 hover:text-zinc-300",
                  )}
                >
                  Permissions
                </button>
              </div>
            ) : null}

            {(!editId || editSubTab === "details") && (
            <>
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="My filesystem tools"
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={labelClass} id="mcp-transport-label">
                Transport
              </label>
              <div ref={transportRef} className="relative">
                <button
                  type="button"
                  id="mcp-transport-trigger"
                  aria-haspopup="listbox"
                  aria-expanded={transportOpen}
                  aria-labelledby="mcp-transport-label"
                  onClick={() => setTransportOpen((v) => !v)}
                  className={cn(
                    inputClass,
                    "flex w-full cursor-pointer items-center justify-between gap-2 text-left font-sans",
                  )}
                >
                  <span className="min-w-0 truncate">
                    {TRANSPORT_OPTIONS.find((o) => o.value === form.transport)?.label ?? form.transport}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform duration-200",
                      theme === "light" ? "text-neutral-500" : "text-zinc-500",
                      transportOpen && "-rotate-180",
                    )}
                    aria-hidden
                  />
                </button>
                {transportOpen && (
                  <ul
                    role="listbox"
                    aria-labelledby="mcp-transport-label"
                    className={cn(
                      "absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-lg border py-0.5 shadow-lg backdrop-blur-md",
                      theme === "light"
                        ? "border-neutral-200/90 bg-white/95 ring-1 ring-black/[0.04] shadow-black/10"
                        : "border-zinc-700/50 bg-zinc-900/95 ring-1 ring-inset ring-white/[0.05] shadow-black/50",
                    )}
                  >
                    {TRANSPORT_OPTIONS.map((o) => (
                      <li key={o.value} role="presentation">
                        <button
                          type="button"
                          role="option"
                          aria-selected={o.value === form.transport}
                          className={cn(
                            "flex w-full items-center px-2.5 py-2 text-left text-sm transition-colors",
                            "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/35 focus-visible:ring-offset-0",
                            o.value === form.transport
                              ? theme === "light"
                                ? "bg-cyan-500/12 font-medium text-cyan-800"
                                : "bg-cyan-500/15 font-medium text-cyan-300"
                              : theme === "light"
                                ? "text-neutral-800 hover:bg-neutral-100"
                                : "text-zinc-200 hover:bg-zinc-800/90",
                          )}
                          onClick={() => {
                            setForm((f) => ({ ...f, transport: o.value as MCPTransport }))
                            setTransportOpen(false)
                          }}
                        >
                          {o.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {form.transport === 'stdio' ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>Command</label>
                  <input
                    value={form.command}
                    onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                    placeholder="npx"
                    className={cn(inputClass, "font-mono text-[13px]")}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>Args (JSON array)</label>
                  <input
                    value={form.args}
                    onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
                    placeholder='["@modelcontextprotocol/server-filesystem", "."]'
                    className={cn(inputClass, "font-mono text-[13px]")}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>URL</label>
                  <input
                    value={form.url}
                    onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                    placeholder="http://localhost:3000/sse"
                    className={cn(inputClass, "font-mono text-[13px]")}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={labelClass}>Bearer token (optional)</label>
                  <input
                    value={form.token ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
                    placeholder="Authorization: Bearer ..."
                    type="password"
                    className={cn(inputClass, "font-mono text-[13px]")}
                  />
                </div>
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Environment variables (JSON object, optional)</label>
              <input
                value={form.env}
                onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))}
                placeholder='{}'
                className={cn(inputClass, "font-mono text-[13px]")}
              />
            </div>

            {testResult && (
              <p
                className={cn(
                  "text-xs",
                  theme === "light" ? "text-emerald-700" : "text-emerald-400",
                )}
              >
                Connected — {testResult.tools} tool{testResult.tools !== 1 ? 's' : ''} discovered from "{testResult.serverName}".
              </p>
            )}
            </>
            )}

            {editId && editSubTab === "permissions" && (
              <MCPServerPermissionsPanel
                serverName={servers.find((s) => s.id === editId)?.name ?? ""}
              />
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !form.name.trim()}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg bg-cyan-500/15 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-cyan-500/25 disabled:opacity-50",
                  theme === "light" ? "text-cyan-800" : "text-cyan-400",
                )}
              >
                {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
                {editId ? 'Save' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs transition-colors",
                  theme === "light"
                    ? "text-neutral-600 hover:text-neutral-900"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-4 py-2">
          {!showAdd && (
            <button
              type="button"
              onClick={openAdd}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                theme === "light"
                  ? "bg-neutral-200/90 text-neutral-800 hover:bg-neutral-300/90"
                  : "bg-zinc-700/40 text-zinc-300 hover:bg-zinc-700/70",
              )}
            >
              <Plus className="h-3.5 w-3.5" />
              Add server
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleReconnectAll()}
            disabled={reconnecting}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
              theme === "light"
                ? "bg-neutral-200/90 text-neutral-700 hover:bg-neutral-300/90"
                : "bg-zinc-700/40 text-zinc-400 hover:bg-zinc-700/70",
            )}
          >
            {reconnecting
              ? <RefreshCw className="h-3 w-3 animate-spin" />
              : <PlugZap className="h-3.5 w-3.5" />}
            Reconnect all
          </button>
        </div>
      </div>
    </SettingsCard>
  )
}

export function SettingsPage(): JSX.Element {
  const { settings, update } = useSettingsStore();
  const { theme, setTheme } = useThemeStore();
  const { archivedConversations, fetchArchived, setShowArchivedMenu } =
    useChatStore();
  const { phase: updatePhase, dismissed: updateDismissed, currentVersion, latestVersion, releaseUrl, downloadUrl, dismiss: dismissUpdate } = useUpdateStore();
  const location = useLocation();
  const [hfToken, setHfToken] = useState("");
  const [hfTokenVisible, setHfTokenVisible] = useState(false);
  const hfTokenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchArchived();
  }, [fetchArchived]);

  useEffect(() => {
    void api.hf.getToken().then((t) => setHfToken(t ?? ""));
  }, []);

  const commitHfToken = useCallback((value: string) => {
    void api.hf.setToken(value);
  }, []);

  const handleHfTokenChange = (e: { target: { value: string } }): void => {
    const v = e.target.value;
    setHfToken(v);
    if (hfTokenTimer.current) clearTimeout(hfTokenTimer.current);
    hfTokenTimer.current = setTimeout(() => {
      commitHfToken(v);
    }, 600);
  };

  useEffect(() => () => { if (hfTokenTimer.current) clearTimeout(hfTokenTimer.current); }, []);

  /** When opening Settings from the chat MCP menu (#mcp-servers), scroll the MCP card into view. */
  useEffect(() => {
    if (!settings) return;
    if (location.hash !== "#mcp-servers") return;
    const el = document.getElementById("settings-mcp-servers");
    if (!el) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [settings, location.hash, location.pathname]);

  const patch = useCallback(
    async (p: Partial<AppSettings>) => {
      await update(p);
    },
    [update],
  );

  const pickExe = useCallback(async () => {
    const filters = navigator.userAgent.includes("Windows")
      ? [{ name: "Executable", extensions: ["exe"] }]
      : [];
    const path = await api.settings.pickFile(filters);
    if (path) await patch({ llamaServerPath: path });
  }, [patch]);

  const settingsInputClass = useSettingsInputClass();

  // ── Runtime management state ──────────────────────────────────────
  const [llamaRuntimeInfo, setLlamaRuntimeInfo] = useState<LlamaRuntimeInfo | null>(null);
  const [vllmRuntimeInfo, setVllmRuntimeInfo] = useState<VllmRuntimeInfo | null>(null);
  const [llamaInstalling, setLlamaInstalling] = useState(false);
  const [llamaInstallProgress, setLlamaInstallProgress] = useState<string>('');
  const [llamaProgressPct, setLlamaProgressPct] = useState<number | null>(null);
  const [vllmSetupRunning, setVllmSetupRunning] = useState(false);
  const [vllmPipLines, setVllmPipLines] = useState<string[]>([]);
  const pipLogRef = useRef<HTMLPreElement>(null);
  const vllmSetup = useVllmSetupStore();

  // Derived: user has their own llama.cpp binary but managed runtime isn't installed
  const hasCustomLlama = !llamaInstalling
    && llamaRuntimeInfo?.status !== 'installed'
    && !!(settings?.llamaServerPath);

  // Derived: user has vLLM configured (conda/venv/docker) but managed venv isn't installed
  const managedVllmInstalled = vllmRuntimeInfo?.status === 'installed';
  const hasCustomVllm = isVllmConfigured(settings, vllmRuntimeInfo) && !managedVllmInstalled;

  useEffect(() => {
    void api.runtime.getStatus().then((s) => {
      setLlamaRuntimeInfo(s.llama);
      setVllmRuntimeInfo(s.vllm);
    });
  }, []);

  useEffect(() => {
    const unsub = api.on('runtime:progress', (...args: unknown[]) => {
      const event = args[1] as RuntimeProgressEvent;
      if (event.kind === 'llama') {
        if (event.phase === 'download') {
          const pct = event.totalBytes
            ? Math.round((event.receivedBytes / event.totalBytes) * 100)
            : null;
          setLlamaInstallProgress(`Downloading… ${pct != null ? pct + '%' : ''}`);
          setLlamaProgressPct(pct);
        } else if (event.phase === 'extract') {
          setLlamaInstallProgress('Extracting…');
          setLlamaProgressPct(null);
        } else if (event.phase === 'gpu-detect') {
          setLlamaInstallProgress('Detecting GPU…');
        } else if (event.phase === 'fetch-release') {
          setLlamaInstallProgress(`Fetching release ${event.build}…`);
        } else if (event.phase === 'complete') {
          setLlamaRuntimeInfo(event.info);
          setLlamaInstallProgress('');
          setLlamaProgressPct(null);
        } else if (event.phase === 'error') {
          setLlamaInstallProgress('');
          setLlamaProgressPct(null);
        }
      } else if (event.kind === 'vllm') {
        if (event.phase === 'pip-install') {
          setVllmPipLines((prev) => [...prev.slice(-49), event.line]);
        } else if (event.phase === 'complete') {
          setVllmRuntimeInfo(event.info);
        }
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (pipLogRef.current) {
      pipLogRef.current.scrollTop = pipLogRef.current.scrollHeight;
    }
  }, [vllmPipLines]);

  const handleInstallLlama = useCallback(async () => {
    setLlamaInstalling(true);
    setLlamaInstallProgress('Detecting GPU…');
    setLlamaProgressPct(null);
    try {
      const info = await api.runtime.installLlama();
      setLlamaRuntimeInfo(info);
      if (info.status === 'installed') await update({});
    } finally {
      setLlamaInstalling(false);
      setLlamaInstallProgress('');
    }
  }, [update]);

  const handleUpdateLlama = useCallback(async () => {
    setLlamaInstalling(true);
    setLlamaInstallProgress('Detecting GPU…');
    setLlamaProgressPct(null);
    try {
      const info = await api.runtime.updateLlama();
      setLlamaRuntimeInfo(info);
    } finally {
      setLlamaInstalling(false);
      setLlamaInstallProgress('');
    }
  }, []);

  const handleSetupVllm = useCallback(async () => {
    if (vllmSetup.phase === 'interrupted') vllmSetup.dismiss();
    setVllmSetupRunning(true);
    setVllmPipLines([]);
    try {
      const info = await api.runtime.setupVllm();
      setVllmRuntimeInfo(info);
      if (info.status === 'installed') await update({});
    } finally {
      setVllmSetupRunning(false);
    }
  }, [update, vllmSetup]);

  const handleUpdateVllm = useCallback(async () => {
    setVllmSetupRunning(true);
    setVllmPipLines([]);
    try {
      const info = await api.runtime.updateVllm();
      setVllmRuntimeInfo(info);
    } finally {
      setVllmSetupRunning(false);
    }
  }, []);

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto p-3">
      <div className="mx-auto flex max-w-xl flex-col gap-3">
        <header className="px-1 pt-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <h1 className="text-base font-semibold tracking-tight text-zinc-100">
              Settings
            </h1>
            {currentVersion && (
              <span className="text-[11px] tabular-nums text-zinc-600">
                v{currentVersion}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            Changes save automatically.
          </p>
        </header>

        {updatePhase === 'available' && updateDismissed && (
          <div
            className={cn(
              'flex items-center justify-between gap-3 rounded-2xl border px-4 py-3',
              theme === 'light'
                ? 'border-emerald-600/30 bg-emerald-500/10'
                : 'border-emerald-500/20 bg-emerald-500/[0.08]',
            )}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                  theme === 'light' ? 'bg-emerald-100' : 'bg-emerald-500/15',
                )}
              >
                <ArrowUp className={cn('h-3.5 w-3.5', theme === 'light' ? 'text-emerald-700' : 'text-emerald-400')} />
              </div>
              <div className="min-w-0">
                <p className={cn('text-xs font-semibold', theme === 'light' ? 'text-emerald-800' : 'text-emerald-300')}>
                  Update available — v{latestVersion}
                </p>
                <p className={cn('text-[11px]', theme === 'light' ? 'text-emerald-700' : 'text-emerald-600')}>
                  You have v{currentVersion}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                void api.update.openRelease(downloadUrl ?? releaseUrl)
                dismissUpdate()
              }}
              className={cn(
                'shrink-0 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors',
                theme === 'light'
                  ? 'border-emerald-600/40 bg-emerald-50 text-emerald-700 hover:border-emerald-600/60 hover:bg-emerald-100'
                  : 'border-emerald-500/30 bg-emerald-950/40 text-emerald-300 hover:border-emerald-500/50 hover:bg-emerald-500/10',
              )}
            >
              <Download className="h-3 w-3" />
              Download
            </button>
          </div>
        )}

        <SettingsCard
          title="Appearance"
          description="Theme and interface density."
        >
          <Row label="Theme">
            <div
              className={cn(
                "inline-flex overflow-hidden rounded-lg border p-0.5",
                theme === "light"
                  ? "border-zinc-600/45 bg-zinc-800/50 shadow-none ring-1 ring-zinc-700/15"
                  : "border-zinc-700/60 bg-zinc-800/80 shadow-sm",
              )}
            >
              {([
                { value: 'system' as const, label: 'System', Icon: Monitor },
                { value: 'dark' as const, label: 'Dark', Icon: Moon },
                { value: 'light' as const, label: 'Light', Icon: Sun },
              ]).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                    theme === value
                      ? theme === "light"
                        ? "bg-cyan-500/15 text-cyan-800"
                        : "bg-cyan-500/15 text-cyan-300"
                      : "text-zinc-500 hover:text-zinc-300",
                  )}
                >
                  <Icon className={cn(
                    "h-3.5 w-3.5",
                    value === 'light' ? "text-amber-400/90" : value === 'dark' ? "text-zinc-400" : "text-zinc-500",
                  )} />
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row
            label="Font size"
            hint="Applies across the app."
          >
            <div
              className={cn(
                "inline-flex items-center rounded-lg border p-0.5",
                theme === "light"
                  ? "border-zinc-600/45 bg-zinc-800/50 shadow-none ring-1 ring-zinc-700/15"
                  : "border-zinc-700/60 bg-zinc-800/80 shadow-sm",
              )}
            >
              <button
                type="button"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md text-sm text-zinc-400 transition-colors",
                  theme === "light"
                    ? "hover:bg-zinc-800/90 hover:text-zinc-100"
                    : "hover:bg-zinc-700/80 hover:text-zinc-100",
                )}
                onClick={() =>
                  void patch({
                    fontSize: Math.max(10, (settings.fontSize ?? 14) - 1),
                  })
                }
              >
                −
              </button>
              <span className="min-w-[2.75rem] text-center text-xs tabular-nums text-zinc-300">
                {Number.isFinite(settings.fontSize) ? settings.fontSize : 14}px
              </span>
              <button
                type="button"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md text-sm text-zinc-400 transition-colors",
                  theme === "light"
                    ? "hover:bg-zinc-800/90 hover:text-zinc-100"
                    : "hover:bg-zinc-700/80 hover:text-zinc-100",
                )}
                onClick={() =>
                  void patch({
                    fontSize: Math.min(24, (settings.fontSize ?? 14) + 1),
                  })
                }
              >
                +
              </button>
            </div>
          </Row>
        </SettingsCard>

        <SettingsCard title="Data">
          <button
            type="button"
            onClick={() => setShowArchivedMenu(true)}
            className={cn(
              "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors",
              theme === "light"
                ? "hover:bg-zinc-900/25"
                : "hover:bg-white/[0.04]",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Archive className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <span className="text-sm text-zinc-200">Archived conversations</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-xs tabular-nums text-zinc-500">
                {archivedConversations.length}
              </span>
              <ChevronRight className="h-4 w-4 text-zinc-600" />
            </div>
          </button>
        </SettingsCard>

        <SettingsCard
          title="LlamaCpp settings"
          description="Paths, binaries, and default host/port for new llama.cpp profiles."
          titleIcon={
            <img
              src={llamacppIcon}
              alt=""
              className="h-7 w-7 shrink-0 object-contain"
              draggable={false}
            />
          }
        >
          <Row
            label="Runtime"
            hint={
              llamaRuntimeInfo?.status === 'installed'
                ? `Build ${llamaRuntimeInfo.installedBuild} · ${llamaRuntimeInfo.tier}`
                : 'Managed llama.cpp runtime (auto-downloaded).'
            }
          >
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {llamaInstalling && llamaInstallProgress && (
                <span className="text-xs text-zinc-400">
                  {llamaInstallProgress}
                  {llamaProgressPct != null && ` ${llamaProgressPct}%`}
                </span>
              )}
              {llamaInstalling && (
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-cyan-400" />
              )}
              {!llamaInstalling && llamaRuntimeInfo?.status === 'installed' && (
                <span className="text-xs font-medium text-emerald-400">Installed</span>
              )}
              {!llamaInstalling && llamaRuntimeInfo?.status !== 'installed' && (
                <span className={cn("text-xs", hasCustomLlama ? "text-zinc-400" : "text-zinc-500")}>
                  {hasCustomLlama ? "Using your own installation" : "Not installed"}
                </span>
              )}
              {!llamaInstalling && llamaRuntimeInfo?.status !== 'installed' && (
                <button
                  type="button"
                  onClick={() => void handleInstallLlama()}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                    theme === "light"
                      ? "bg-cyan-500/15 text-cyan-800 hover:bg-cyan-500/25"
                      : "bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25",
                  )}
                >
                  <Download className="h-3 w-3" />
                  Install
                </button>
              )}
              {!llamaInstalling && llamaRuntimeInfo?.status === 'installed' && (
                <button
                  type="button"
                  onClick={() => void handleUpdateLlama()}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                    theme === "light"
                      ? "bg-neutral-200/90 text-neutral-700 hover:bg-neutral-300/90"
                      : "bg-zinc-700/40 text-zinc-400 hover:bg-zinc-700/70",
                  )}
                >
                  <RefreshCw className="h-3 w-3" />
                  Update
                </button>
              )}
            </div>
          </Row>
          <Row
            label="Default bind host"
            hint="Used when you create a new llama.cpp profile (you can override per profile)."
          >
            <SettingsMenuSelect
              ariaLabel="Default bind host for new llama.cpp profiles"
              value={settings.llamaDefaultHost}
              onChange={(v) => void patch({ llamaDefaultHost: v })}
              options={PROFILE_BIND_HOST_MENU_OPTIONS}
              className="max-w-[12rem]"
            />
          </Row>
          <Row
            label="Default port"
            hint="Starting listen port for new profiles; another port may be chosen if this one is busy."
          >
            <input
              type="number"
              value={settings.llamaBasePort}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isFinite(n)) return;
                void patch({ llamaBasePort: n < 1 ? 1 : n > 65535 ? 65535 : n });
              }}
              className={cn(settingsInputClass, "max-w-[7rem] tabular-nums")}
              min={1}
              max={65535}
            />
          </Row>
          <RowStack
            label="Models directories"
            hint="GGUF files are scanned under each root (e.g. fast SSD + bulk storage)."
          >
            <ModelsDirsEditor
              value={settings.modelsDirs}
              onCommit={(modelsDirs) => void update({ modelsDirs })}
            />
          </RowStack>
          <RowStack
            label={navigator.userAgent.includes("Windows") ? "llama-server.exe" : "llama-server"}
            hint="Path to the llama.cpp server executable."
          >
            <DebouncedFileInput
              field="llamaServerPath"
              value={settings.llamaServerPath}
              update={update}
              pickFile={pickExe}
            />
          </RowStack>
          {!navigator.userAgent.includes("Mac") && (
            <RowStack label="CUDA bin" hint="Optional. Directory with nvcc / CUDA tools.">
              <DebouncedPathInput
                field="cudaBinPath"
                value={settings.cudaBinPath}
                update={update}
              />
            </RowStack>
          )}
        </SettingsCard>

        {window.platform !== "darwin" && (
          <SettingsCard
            title="vLLM"
            description="Default bind address and port for new vLLM profiles; model roots for scanning and Hugging Face downloads; how to launch vLLM via conda. On Windows, the conda environment runs inside WSL; paths are translated for the guest."
          titleIcon={
            <img
              src={vllmColorIcon}
              alt=""
              className="h-7 w-7 shrink-0 object-contain"
              draggable={false}
            />
          }
        >
          <Row
            label="Default bind host"
            hint="Used when you create a new vLLM profile (you can override per profile)."
          >
            <SettingsMenuSelect
              ariaLabel="Default bind host for new vLLM profiles"
              value={settings.vllmDefaultHost}
              onChange={(v) => void patch({ vllmDefaultHost: v })}
              options={PROFILE_BIND_HOST_MENU_OPTIONS}
              className="max-w-[12rem]"
            />
          </Row>
          <Row
            label="Default port"
            hint="Starting listen port for new profiles; another port may be chosen if this one is busy."
          >
            <input
              type="number"
              value={settings.vllmBasePort}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (!Number.isFinite(n)) return;
                void patch({ vllmBasePort: n < 1 ? 1 : n > 65535 ? 65535 : n });
              }}
              className={cn(settingsInputClass, "max-w-[7rem] tabular-nums")}
              min={1}
              max={65535}
            />
          </Row>
          <RowStack
            label="vLLM model directories"
            hint="Optional. Scanned for local vLLM-compatible model trees; Hub safetensor downloads go here when you pick a target."
          >
            <VllmModelDirsEditor
              value={settings.vllmModelDirs}
              onCommit={(vllmModelDirs) => void patch({ vllmModelDirs })}
            />
          </RowStack>
          <Row label="Runtime">
            <span className="text-sm font-mono text-zinc-300">Conda</span>
          </Row>
          <>
              <Row label="Conda environment" hint="Environment name to activate.">
                <input
                  value={settings.vllmRuntime.condaEnvName ?? ""}
                  onChange={(e) =>
                    void patch({
                      vllmRuntime: {
                        ...settings.vllmRuntime,
                        condaEnvName: e.target.value,
                      },
                    })
                  }
                  onBlur={(e) =>
                    void patch({
                      vllmRuntime: {
                        ...settings.vllmRuntime,
                        condaEnvName: e.target.value.trim() || undefined,
                      },
                    })
                  }
                  placeholder="vllm"
                  className={cn(settingsInputClass, "max-w-md font-mono")}
                />
              </Row>
              <Row
                label="conda.sh path"
                hint="Optional. e.g. ~/miniconda3/etc/profile.d/conda.sh"
              >
                <input
                  value={settings.vllmRuntime.condaShPath ?? ""}
                  onChange={(e) =>
                    void patch({
                      vllmRuntime: {
                        ...settings.vllmRuntime,
                        condaShPath: e.target.value,
                      },
                    })
                  }
                  onBlur={(e) =>
                    void patch({
                      vllmRuntime: {
                        ...settings.vllmRuntime,
                        condaShPath: e.target.value.trim() || undefined,
                      },
                    })
                  }
                  className={cn(settingsInputClass, "w-full max-w-xl font-mono")}
                />
              </Row>
            </>
          {navigator.userAgent.includes("Windows") && (
            <Row
              label="WSL distro (Windows)"
              hint="Optional distro name (e.g. Ubuntu-22.04). Leave empty to use the default WSL distro."
            >
              <input
                value={settings.vllmRuntime.wslDistro ?? ""}
                onChange={(e) =>
                  void patch({
                    vllmRuntime: {
                      ...settings.vllmRuntime,
                      wslDistro: e.target.value,
                    },
                  })
                }
                onBlur={(e) =>
                  void patch({
                    vllmRuntime: {
                      ...settings.vllmRuntime,
                      wslDistro: e.target.value.trim() || undefined,
                    },
                  })
                }
                placeholder="Ubuntu-22.04"
                className={cn(settingsInputClass, "max-w-md font-mono")}
              />
            </Row>
          )}
          {/* Managed vLLM environment section — temporarily hidden until the setup wizard is complete. Re-enable by removing the `false &&`. */}
          {false && <RowStack
            label="Managed vLLM environment"
            hint={
              window.platform === "win32"
                ? "Creates a Python venv in WSL at ~/.modelbox/vllm-env and installs vllm."
                : "Creates a Python venv at ~/.modelbox/vllm-env and installs vllm."
            }
          >
            <div className="flex flex-col gap-2">
              {vllmRuntimeInfo?.status === 'installed' && !vllmSetupRunning && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-emerald-400">Installed</span>
                  {vllmRuntimeInfo?.wslDistro && (
                    <span className="text-xs text-zinc-500">in {vllmRuntimeInfo?.wslDistro}</span>
                  )}
                  {!vllmRuntimeInfo?.wslDistro && vllmRuntimeInfo?.venvPath && (
                    <span className="font-mono text-xs text-zinc-500 truncate max-w-xs">{vllmRuntimeInfo?.venvPath}</span>
                  )}
                </div>
              )}
              {hasCustomVllm && !vllmSetupRunning && (
                <p className="text-xs text-zinc-400">
                  {settings?.vllmRuntime.envKind === 'conda' && settings?.vllmRuntime.condaEnvName
                    ? `Using conda env: ${settings?.vllmRuntime.condaEnvName}`
                    : settings?.vllmRuntime.envKind === 'docker' && settings?.vllmRuntime.dockerImage
                    ? `Using Docker: ${settings?.vllmRuntime.dockerImage}`
                    : settings?.vllmRuntime.venvPath
                    ? `Using venv: ${settings?.vllmRuntime.venvPath}`
                    : null}
                </p>
              )}
              {vllmSetup.phase === 'interrupted' && !managedVllmInstalled && !hasCustomVllm && !vllmSetupRunning && (
                <div
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
                    theme === "light"
                      ? "border-amber-500/30 bg-amber-500/10"
                      : "border-amber-500/20 bg-amber-500/[0.08]",
                  )}
                >
                  <div className="min-w-0">
                    <p className={cn("text-xs font-medium", theme === "light" ? "text-amber-800" : "text-amber-300")}>
                      Setup was interrupted
                    </p>
                    <p className={cn("text-[11px] mt-0.5", theme === "light" ? "text-amber-700" : "text-amber-500")}>
                      {vllmSetup.distro
                        ? `vLLM pip install in ${vllmSetup.distro} did not finish.`
                        : "vLLM pip install did not finish."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSetupVllm()}
                    className={cn(
                      "shrink-0 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                      theme === "light"
                        ? "bg-amber-500/20 text-amber-800 hover:bg-amber-500/30"
                        : "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25",
                    )}
                  >
                    <RefreshCw className="h-3 w-3" />
                    Resume
                  </button>
                </div>
              )}
              {vllmSetupRunning && vllmPipLines.length > 0 && (
                <pre
                  ref={pipLogRef}
                  className={cn(
                    "max-h-40 overflow-y-auto rounded-lg border p-2 font-mono text-[11px] leading-relaxed",
                    theme === "light"
                      ? "border-zinc-700/30 bg-zinc-950/60 text-zinc-300"
                      : "border-zinc-700/40 bg-zinc-950/70 text-zinc-400",
                  )}
                >
                  {vllmPipLines.join('\n')}
                </pre>
              )}
              <div className="flex gap-2">
                {/* Setup vLLM button — temporarily hidden until the wizard is complete. Re-enable by removing the `false &&`. */}
                {false && !vllmSetupRunning && !managedVllmInstalled && vllmSetup.phase !== 'interrupted' && (
                  <button
                    type="button"
                    onClick={() => void handleSetupVllm()}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                      theme === "light"
                        ? "bg-cyan-500/15 text-cyan-800 hover:bg-cyan-500/25"
                        : "bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25",
                    )}
                  >
                    <Download className="h-3 w-3" />
                    Setup vLLM
                  </button>
                )}
                {!vllmSetupRunning && vllmRuntimeInfo?.status === 'installed' && (
                  <button
                    type="button"
                    onClick={() => void handleUpdateVllm()}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                      theme === "light"
                        ? "bg-neutral-200/90 text-neutral-700 hover:bg-neutral-300/90"
                        : "bg-zinc-700/40 text-zinc-400 hover:bg-zinc-700/70",
                    )}
                  >
                    <RefreshCw className="h-3 w-3" />
                    Update vLLM
                  </button>
                )}
                {vllmSetupRunning && (
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <RefreshCw className="h-3 w-3 animate-spin text-cyan-400" />
                    {vllmRuntimeInfo?.status === 'installed' ? 'Updating…' : 'Setting up…'}
                  </div>
                )}
              </div>
            </div>
          </RowStack>}
        </SettingsCard>
        )}

        <SettingsCard
          title="HuggingFace"
          description="Optional access token for downloading gated models."
          titleIcon={
            <img
              src={huggingfaceColorIcon}
              alt=""
              className="h-7 w-7 shrink-0 object-contain"
              draggable={false}
            />
          }
        >
          <Row
            label="Access token"
            hint="Create one at huggingface.co/settings/tokens. Required for gated models."
          >
            <div className="relative flex w-full items-center gap-1.5">
              <input
                type={hfTokenVisible ? "text" : "password"}
                value={hfToken}
                onChange={handleHfTokenChange}
                placeholder="hf_…"
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  INPUT_CLASS_BASE,
                  "flex-1 font-mono text-xs",
                  theme === "light" ? "shadow-none ring-1 ring-zinc-700/15" : "shadow-sm",
                )}
              />
              <button
                type="button"
                onClick={() => setHfTokenVisible((v) => !v)}
                className={cn(
                  "shrink-0 rounded-md p-1.5 text-zinc-500 transition-colors",
                  theme === "light"
                    ? "hover:bg-zinc-800/10 hover:text-zinc-700"
                    : "hover:bg-white/[0.06] hover:text-zinc-300",
                )}
                aria-label={hfTokenVisible ? "Hide token" : "Show token"}
              >
                {hfTokenVisible
                  ? <EyeOff className="h-3.5 w-3.5" />
                  : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </Row>
        </SettingsCard>

        {window.platform === "win32" && (
          <SettingsCard
            title="Claude Code integration"
            description="Controls the shell syntax used by the 'Use with Claude Code' button."
            titleIcon={
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded",
                  theme === "light" ? "bg-white" : "bg-black",
                )}
              >
                <img
                  src={claudecodeColorIcon}
                  alt=""
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              </span>
            }
          >
            <Row
              label="WSL mode"
              hint="Use bash export syntax instead of PowerShell $env: — useful when running Claude Code inside a WSL terminal."
            >
              <button
                type="button"
                role="switch"
                aria-checked={settings.wslMode}
                onClick={() => void patch({ wslMode: !settings.wslMode })}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50",
                  settings.wslMode ? "bg-cyan-500" : "bg-zinc-700",
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200",
                    settings.wslMode ? "translate-x-4" : "translate-x-0",
                  )}
                />
              </button>
            </Row>
          </SettingsCard>
        )}

        <MCPServersSection />
      </div>
    </div>
  );
}
