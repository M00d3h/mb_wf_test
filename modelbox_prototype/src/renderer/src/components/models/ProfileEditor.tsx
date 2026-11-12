import {
  useState,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import { Eye, EyeOff, AlertTriangle, FolderOpen } from "lucide-react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/themeStore";
import { api } from "../../lib/ipc";
import type { Model, Profile, ProfileConfig } from "@shared/types";
import {
  idleUnsetLook,
  ProfileOptionalBool,
  ProfileOptionalNumber,
  ProfileOptionalSelect,
  ProfileOptionalText,
  ProfileRow,
} from "./ProfileField";

const CONTEXT_MAX_FALLBACK = 2_000_000;
const GPU_LAYERS_MAX_FALLBACK = 999;

function formatTokenCap(n: number): string {
  if (n >= 1_048_576 && n % 1_048_576 === 0) return `${n / 1_048_576}M`;
  if (n >= 1_000_000 && n % 100_000 === 0) return `${n / 1_000_000}M`;
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}k`;
  return n.toLocaleString();
}

interface Props {
  profile: Profile;
  model?: Model | null;
  onPersist: (patch: {
    name?: string;
    config?: ProfileConfig;
    apiKey?: string | null;
  }) => Promise<void>;
  onLiveChange?: (live: { config: ProfileConfig; apiKey: string }) => void;
}

const KV_CACHE_OPTIONS = [
  { label: "f16", value: "f16" },
  { label: "q8_0", value: "q8_0" },
  { label: "q4_0", value: "q4_0" },
  { label: "q4_1", value: "q4_1" },
];

const FLASH_ATTN_OPTIONS = [
  { label: "on", value: "on" },
  { label: "off", value: "off" },
];

export function ProfileEditor({
  profile,
  model,
  onPersist,
  onLiveChange,
}: Props): JSX.Element {
  const { theme } = useThemeStore();
  const contextSliderMax = model?.maxContextTokens ?? CONTEXT_MAX_FALLBACK;
  const gpuLayersSliderMax = model?.blockCount ?? GPU_LAYERS_MAX_FALLBACK;
  const contextHint = model?.maxContextTokens
    ? `Model supports up to ${formatTokenCap(model.maxContextTokens)} tokens (GGUF).`
    : undefined;
  const gpuHint = model?.blockCount
    ? `GGUF reports ${model.blockCount} blocks — typical max for GPU layers.`
    : undefined;
  const [name, setName] = useState(profile.name);
  const [config, setConfig] = useState<ProfileConfig>({ ...profile.config });
  const [apiKey, setApiKey] = useState<string>("");
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [apiKeyFocused, setApiKeyFocused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [envEntries, setEnvEntries] = useState<[string, string][]>(
    Object.entries(config.env ?? {}),
  );
  const skipFirstPersist = useRef(true);
  const skipFirstLive = useRef(true);
  const onPersistRef = useRef(onPersist);
  onPersistRef.current = onPersist;
  const onLiveChangeRef = useRef(onLiveChange);
  onLiveChangeRef.current = onLiveChange;
  // Track profile identity and last-saved config/env so the layout effect can tell our
  // own saves apart from external profile changes and not clobber in-flight edits.
  const profileIdRef = useRef(profile.id);
  const lastSavedConfigRef = useRef<ProfileConfig>({ ...profile.config });
  const lastSavedEnvRef = useRef<Record<string, string>>(profile.config.env ?? {});
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs so the layout effect can read apiKey/apiKeyLoaded without including them in its
  // deps — having them there caused the effect to fire on every keystroke, which set
  // skipFirstLive = true and prevented onLiveChange from ever being called.
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;
  const apiKeyLoadedRef = useRef(apiKeyLoaded);
  apiKeyLoadedRef.current = apiKeyLoaded;

  const detectedMmproj = useMemo(() => {
    if (!model?.detectedFiles?.length) return null;
    return (
      model.detectedFiles.find((f) =>
        /mmproj/i.test(f.replace(/\\/g, "/").split("/").pop() ?? ""),
      ) ?? null
    );
  }, [model?.detectedFiles]);

  /** Show vision controls when disk scan found mmproj or the user set a plausible mmproj path. */
  const visionMmprojPath = useMemo(() => {
    if (detectedMmproj) return detectedMmproj;
    const manual = config.mmproj?.trim();
    if (
      manual &&
      /mmproj/i.test(manual.replace(/\\/g, "/").split("/").pop() ?? "")
    ) {
      return manual;
    }
    return null;
  }, [detectedMmproj, config.mmproj]);

  useEffect(() => {
    setApiKeyLoaded(false);
    skipFirstPersist.current = true;
    skipFirstLive.current = true;
    setApiKey("");
    void api.profiles.getApiKey(profile.id).then((k) => {
      setApiKey(k ?? "");
      setApiKeyLoaded(true);
    });
  }, [profile.id, profile.updatedAt]);

  // Auto-populate mmproj path from the detected file when no path is saved yet.
  // Depends on apiKeyLoaded so it fires after skipFirstPersist has been consumed,
  // ensuring the resulting config change actually triggers a save.
  useEffect(() => {
    if (!detectedMmproj || !apiKeyLoaded) return;
    setConfig((c) => {
      if (!c.mmproj) {
        return { ...c, mmproj: detectedMmproj };
      }
      return c;
    });
  }, [profile.id, detectedMmproj, apiKeyLoaded]);

  // When the profile is updated elsewhere (e.g. Launch command → Apply), keep form state in sync.
  // Include serialized config: updatedAt can repeat within the same second in SQLite, so deps on
  // updatedAt alone miss server-side config changes and stale local state can overwrite Apply.
  const profileConfigSig = JSON.stringify(profile.config);
  useLayoutEffect(() => {
    const sameProfile = profileIdRef.current === profile.id;
    profileIdRef.current = profile.id;

    // Detect if this profile update is the echo of our own save completing.
    // When our save fires, it updates lastSavedConfigRef, then the IPC response
    // triggers fetchProfiles which updates the store and thus the profile prop.
    // If the incoming config matches what we last saved, it's our own update —
    // preserve local state (user may still have in-progress edits).
    // If it differs, it's an external change (Apply custom command, another tab, etc.) — sync.
    const lastSaved = lastSavedConfigRef.current;
    const incoming = profile.config;
    const allKeys = new Set([...Object.keys(lastSaved), ...Object.keys(incoming)]);
    const isOwnUpdate = sameProfile && Array.from(allKeys).every((k) => {
      const a = (lastSaved as any)[k];
      const b = (incoming as any)[k];
      if (a === b) return true;
      // Both undefined (key removed) is equal
      if (a === undefined && b === undefined) return true;
      return false;
    });

    if (isOwnUpdate) {
      // Our own save completed — preserve local form state, only sync env drafts.
      skipFirstPersist.current = true;
      skipFirstLive.current = true;
      const newEntries = Object.entries(profile.config.env ?? {});
      setEnvEntries((prev) => {
        const drafts = prev.filter(([k]) => !k.trim());
        return drafts.length > 0 ? [...newEntries, ...drafts] : prev;
      });
      return;
    }

    // External change — sync form state from profile.
    // Cancel any pending auto-save so a stale timer can't overwrite the new state.
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    skipFirstPersist.current = true;
    skipFirstLive.current = true;
    lastSavedConfigRef.current = { ...profile.config };
    lastSavedEnvRef.current = { ...profile.config.env ?? {} };
    setName(profile.name);
    setConfig({ ...profile.config });
    const newEntries = Object.entries(profile.config.env ?? {});
    setEnvEntries(newEntries);

    // Emit current form state so the launch command preview reflects the new values.
    if (apiKeyLoadedRef.current) {
      const envObj: Record<string, string> = {};
      for (const [k, v] of newEntries) {
        if (k.trim()) envObj[k.trim()] = v;
      }
      const liveConfig: ProfileConfig = {
        ...profile.config,
        env: Object.keys(envObj).length > 0 ? envObj : undefined,
      };
      onLiveChangeRef.current?.({ config: liveConfig, apiKey: apiKeyRef.current });
    }
  }, [profile.id, profile.updatedAt, profileConfigSig]);

  const set = <K extends keyof ProfileConfig>(
    key: K,
    val: ProfileConfig[K],
  ): void => {
    setConfig((c) => ({ ...c, [key]: val }));
  };
  const unset = (key: keyof ProfileConfig): void => {
    setConfig((c) => {
      const next = { ...c };
      delete next[key];
      return next;
    });
  };
  const setOrUnset = <K extends keyof ProfileConfig>(
    key: K,
    val: ProfileConfig[K] | undefined,
  ): void => {
    if (val === undefined) unset(key);
    else set(key, val);
  };

  const pickMmproj = useCallback(async () => {
    const filters = [{ name: "mmproj files", extensions: ["*"] }];
    const path = await api.settings.pickFile(filters);
    if (path) set("mmproj", path);
  }, [set]);

  const warnings: string[] = [];
  if (config.embeddings && (config.temp !== undefined || config.topP !== undefined)) {
    warnings.push("Sampling params are ignored in embeddings mode");
  }
  if (
    config.mmproj === undefined &&
    !config.embeddings &&
    profile.config.mmproj !== undefined
  ) {
    warnings.push("mmproj was set but is now cleared");
  }

  const buildPatch = useCallback((): {
    name?: string;
    config: ProfileConfig;
    apiKey: string | null;
  } => {
    const envObj: Record<string, string> = {};
    for (const [k, v] of envEntries) {
      if (k.trim()) envObj[k.trim()] = v;
    }
    const finalConfig: ProfileConfig = {
      ...config,
      env: Object.keys(envObj).length > 0 ? envObj : undefined,
    };
    if (finalConfig.alias === "") delete finalConfig.alias;
    if (finalConfig.mmproj === "") delete finalConfig.mmproj;
    if (finalConfig.specType === "") delete finalConfig.specType;
    // ProfileEditor never owns these — they're set exclusively by LaunchCommandPanel's Apply.
    // Stripping them here ensures a slider/select change switches the profile back to builder mode.
    delete finalConfig.launchMode;
    delete finalConfig.customCommandLine;
    return {
      name: name !== profile.name ? name : undefined,
      config: finalConfig,
      apiKey: apiKey || null,
    };
  }, [name, config, envEntries, apiKey, profile.name]);

  const persist = useCallback(async (): Promise<void> => {
    const patch = buildPatch();
    // Record the actual saved config (after empty-string deletions) so that
    // isOwnUpdate correctly matches the DB response and doesn't spuriously reset.
    lastSavedConfigRef.current = { ...patch.config };
    lastSavedEnvRef.current = patch.config.env ?? {};
    setSaving(true);
    try {
      await onPersistRef.current(patch);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }, [buildPatch]);

  useEffect(() => {
    if (!apiKeyLoaded) return;
    if (skipFirstLive.current) {
      skipFirstLive.current = false;
      return;
    }
    const envObj: Record<string, string> = {};
    for (const [k, v] of envEntries) {
      if (k.trim()) envObj[k.trim()] = v;
    }
    const liveConfig: ProfileConfig = {
      ...config,
      env: Object.keys(envObj).length > 0 ? envObj : undefined,
    };
    onLiveChangeRef.current?.({ config: liveConfig, apiKey });
  }, [config, envEntries, apiKey, apiKeyLoaded]);

  useEffect(() => {
    if (!apiKeyLoaded) return;
    if (skipFirstPersist.current) {
      skipFirstPersist.current = false;
      return;
    }
    const t = setTimeout(() => {
      persistTimerRef.current = null;
      void persist();
    }, 300);
    persistTimerRef.current = t;
    return () => {
      clearTimeout(t);
      persistTimerRef.current = null;
    };
  }, [name, config, envEntries, apiKey, apiKeyLoaded, persist]);

  const inputClass = cn(
    "w-full rounded-lg border border-zinc-700/60 bg-zinc-800/80 px-2.5 py-2 text-sm text-zinc-100 transition-colors focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/20",
    theme === "light" ? "shadow-none ring-1 ring-zinc-700/15" : "shadow-sm",
  );

  const apiKeyEmpty = !apiKey.trim();
  const apiKeyIdleLook = apiKeyEmpty && !apiKeyFocused;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label className="block text-xs font-medium text-zinc-400">
            Profile name
          </label>
          {saving ? (
            <span className="shrink-0 text-xs text-zinc-500">Saving…</span>
          ) : null}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </div>

      {warnings.map((w) => (
        <div
          key={w}
          className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/95"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400/90" />
          {w}
        </div>
      ))}

      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400">
          API key
        </label>
        <div className="flex gap-2">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onFocus={() => setApiKeyFocused(true)}
            onBlur={() => setApiKeyFocused(false)}
            autoComplete="off"
            placeholder="Optional"
            className={cn(
              inputClass,
              "min-w-0 flex-1 font-mono text-[13px]",
              apiKeyIdleLook && idleUnsetLook,
            )}
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowKey(!showKey)}
            className={cn(
              "shrink-0 rounded-lg border border-zinc-700/60 bg-zinc-800/80 px-2.5 py-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200",
              theme === "light" && "ring-1 ring-zinc-700/15",
            )}
            title={showKey ? "Hide" : "Show"}
          >
            {showKey ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <Section title="Model">
        <ProfileRow label="Alias (-a)">
          <ProfileOptionalText
            value={config.alias}
            onChange={(v) => setOrUnset("alias", v)}
            placeholder="e.g. my-model"
          />
        </ProfileRow>
        {visionMmprojPath ? (
          <ProfileRow label="Enable vision">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={!config.mmprojDisabled}
                  onClick={() =>
                    setConfig((c) =>
                      c.mmprojDisabled
                        ? (({ mmprojDisabled: _, ...rest }) => rest)(c)
                        : { ...c, mmprojDisabled: true },
                    )
                  }
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50",
                    !config.mmprojDisabled
                      ? theme === "light" ? "bg-cyan-500" : "bg-cyan-600"
                      : theme === "light" ? "bg-zinc-300" : "bg-zinc-700",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200",
                      !config.mmprojDisabled ? "translate-x-[18px]" : "translate-x-[3px]",
                    )}
                  />
                </button>
                <span className="text-sm text-zinc-200">
                  {!config.mmprojDisabled ? "Vision enabled" : "Vision disabled"}
                </span>
              </div>
              <div className={cn("flex w-full max-w-md flex-col gap-1.5 sm:items-end", config.mmprojDisabled && "opacity-40")}>
                <label className="w-full max-w-sm text-xs font-medium text-zinc-400">mmproj path</label>
                <div className="flex w-full max-w-md items-center gap-2">
                  <input
                    type="text"
                    value={config.mmproj ?? ""}
                    disabled={config.mmprojDisabled}
                    onChange={(e) => {
                      const val = e.target.value;
                      setConfig((c) => ({ ...c, mmproj: val || undefined }));
                    }}
                    className={cn(inputClass, "min-w-0 flex-1 font-mono text-[13px]", config.mmprojDisabled && "cursor-not-allowed")}
                  />
                  <button
                    type="button"
                    onClick={() => void pickMmproj()}
                    disabled={config.mmprojDisabled}
                    className={cn(
                      "shrink-0 rounded-lg border p-1.5 transition-colors",
                      theme === "light"
                        ? "border-zinc-600/45 bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800/75 hover:text-zinc-300"
                        : "border-zinc-700/60 bg-zinc-800/80 text-zinc-500 hover:bg-zinc-700/80 hover:text-zinc-300",
                      config.mmprojDisabled && "cursor-not-allowed opacity-40",
                    )}
                    title="Browse file"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>
                </div>
                {detectedMmproj && config.mmproj !== detectedMmproj && (
                  <button
                    type="button"
                    onClick={() => set("mmproj", detectedMmproj)}
                    className="self-end text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
                  >
                    Reset to detected
                  </button>
                )}
              </div>
            </div>
          </ProfileRow>
        ) : (
          <ProfileRow label="mmproj path">
            <ProfileOptionalText
              value={config.mmproj}
              onChange={(v) => setOrUnset("mmproj", v)}
              placeholder="Path to mmproj file"
            />
          </ProfileRow>
        )}
        <ProfileRow label="Embeddings mode">
          <ProfileOptionalBool
            value={config.embeddings}
            onChange={(v) => setOrUnset("embeddings", v)}
          />
        </ProfileRow>
      </Section>

      <Section title="Context & performance">
        <ProfileRow label="Context size (-c)" hint={contextHint}>
          <ProfileOptionalNumber
            value={config.contextSize}
            onChange={(v) => setOrUnset("contextSize", v)}
            min={256}
            max={contextSliderMax}
          />
        </ProfileRow>
        <ProfileRow label="GPU layers (--n-gpu-layers)" hint={gpuHint}>
          <ProfileOptionalNumber
            value={config.gpuLayers}
            onChange={(v) => setOrUnset("gpuLayers", v)}
            min={0}
            max={gpuLayersSliderMax}
          />
        </ProfileRow>
        <ProfileRow label="CPU MoE layers (--n-cpu-moe)">
          <ProfileOptionalNumber
            value={config.nCpuMoe}
            onChange={(v) => setOrUnset("nCpuMoe", v)}
            min={0}
          />
        </ProfileRow>
        <ProfileRow label="Flash attention (-fa)">
          <ProfileOptionalSelect
            value={config.flashAttn}
            onChange={(v) => setOrUnset("flashAttn", v as "on" | "off" | undefined)}
            options={FLASH_ATTN_OPTIONS}
          />
        </ProfileRow>
        <ProfileRow label="Backend sampling">
          <ProfileOptionalBool
            value={config.backendSampling}
            onChange={(v) => setOrUnset("backendSampling", v)}
          />
        </ProfileRow>
        <ProfileRow label="Parallel slots (--parallel)">
          <ProfileOptionalNumber
            value={config.parallel}
            onChange={(v) => setOrUnset("parallel", v)}
            min={1}
          />
        </ProfileRow>
        <ProfileRow label="KV cache type K (-ctk)">
          <ProfileOptionalSelect
            value={config.kvCacheTypeK}
            onChange={(v) => setOrUnset("kvCacheTypeK", v)}
            options={KV_CACHE_OPTIONS}
          />
        </ProfileRow>
        <ProfileRow label="KV cache type V (-ctv)">
          <ProfileOptionalSelect
            value={config.kvCacheTypeV}
            onChange={(v) => setOrUnset("kvCacheTypeV", v)}
            options={KV_CACHE_OPTIONS}
          />
        </ProfileRow>
      </Section>

      <Section title="Networking">
        <ProfileRow label="Host (--host)">
          <ProfileOptionalText
            value={config.host}
            onChange={(v) => setOrUnset("host", v)}
            placeholder="0.0.0.0"
          />
        </ProfileRow>
        <ProfileRow label="Port (--port)">
          <ProfileOptionalNumber
            value={config.port}
            onChange={(v) => setOrUnset("port", v)}
            min={1024}
            max={65535}
            showSlider={false}
          />
        </ProfileRow>
      </Section>

      <Section title="Sampling">
        <p className="-mt-1 mb-1 text-xs text-zinc-500">
          Unset options are not passed to the server (llama.cpp defaults apply).
        </p>
        <ProfileRow label="Temperature (--temp)">
          <ProfileOptionalNumber
            value={config.temp}
            onChange={(v) => setOrUnset("temp", v)}
            min={0}
            max={10}
            step={0.05}
          />
        </ProfileRow>
        <ProfileRow label="Top-P (--top-p)">
          <ProfileOptionalNumber
            value={config.topP}
            onChange={(v) => setOrUnset("topP", v)}
            min={0}
            max={1}
            step={0.01}
          />
        </ProfileRow>
        <ProfileRow label="Min-P (--min-p)">
          <ProfileOptionalNumber
            value={config.minP}
            onChange={(v) => setOrUnset("minP", v)}
            min={0}
            max={1}
            step={0.01}
          />
        </ProfileRow>
        <ProfileRow label="Top-K (--top-k)">
          <ProfileOptionalNumber
            value={config.topK}
            onChange={(v) => setOrUnset("topK", v)}
            min={0}
            step={1}
            showSlider={false}
          />
        </ProfileRow>
        <ProfileRow label="Repeat penalty (--repeat-penalty)">
          <ProfileOptionalNumber
            value={config.repeatPenalty}
            onChange={(v) => setOrUnset("repeatPenalty", v)}
            min={0}
            max={2}
            step={0.05}
          />
        </ProfileRow>
        <ProfileRow label="Presence penalty (--presence-penalty)">
          <ProfileOptionalNumber
            value={config.presencePenalty}
            onChange={(v) => setOrUnset("presencePenalty", v)}
            min={-2}
            max={2}
            step={0.05}
          />
        </ProfileRow>
      </Section>

      <Section title="Speculative decoding">
        <ProfileRow label="Spec type (--spec-type)">
          <ProfileOptionalText
            value={config.specType}
            onChange={(v) => setOrUnset("specType", v)}
            placeholder="e.g. ngram-mod"
          />
        </ProfileRow>
        <ProfileRow label="Ngram size N (--spec-ngram-size-n)">
          <ProfileOptionalNumber
            value={config.specNgramSizeN}
            onChange={(v) => setOrUnset("specNgramSizeN", v)}
            min={1}
            placeholder="Optional"
          />
        </ProfileRow>
        <ProfileRow label="Draft min (--draft-min)">
          <ProfileOptionalNumber
            value={config.draftMin}
            onChange={(v) => setOrUnset("draftMin", v)}
            min={0}
            placeholder="Optional"
          />
        </ProfileRow>
        <ProfileRow label="Draft max (--draft-max)">
          <ProfileOptionalNumber
            value={config.draftMax}
            onChange={(v) => setOrUnset("draftMax", v)}
            min={0}
            placeholder="Optional"
          />
        </ProfileRow>
      </Section>

      <Section title="Environment">
        {!navigator.userAgent.includes('Mac') && (
          <ProfileRow label="Prepend CUDA bin to PATH">
            <ProfileOptionalBool
              value={config.prependCudaToPath}
              onChange={(v) => setOrUnset("prependCudaToPath", v)}
            />
          </ProfileRow>
        )}
        <div className="pt-1">
          <label className="mb-2 block text-xs font-medium text-zinc-400">
            Extra env vars
          </label>
          <div className="flex flex-col gap-2">
            {envEntries.map(([k, v], i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={k}
                  onChange={(e) => {
                    const next = [...envEntries];
                    next[i] = [e.target.value, v];
                    setEnvEntries(next);
                  }}
                  placeholder="KEY"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-700/60 bg-zinc-900/40 px-2 py-1.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
                />
                <input
                  value={v}
                  onChange={(e) => {
                    const next = [...envEntries];
                    next[i] = [k, e.target.value];
                    setEnvEntries(next);
                  }}
                  placeholder="VALUE"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-700/60 bg-zinc-900/40 px-2 py-1.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/20"
                />
                <button
                  type="button"
                  onClick={() =>
                    setEnvEntries((e) => e.filter((_, j) => j !== i))
                  }
                  className="shrink-0 rounded-lg px-2 text-sm text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setEnvEntries((e) => [...e, ["", ""]])}
              className="w-fit text-left text-xs font-medium text-cyan-500/90 hover:text-cyan-400"
            >
              + Add variable
            </button>
          </div>
          {!navigator.userAgent.includes('Mac') && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  setEnvEntries((e) => [
                    ...e.filter(
                      ([key]) =>
                        key !== "GGML_CUDA_GRAPH_OPT" &&
                        key !== "GGML_CUDA_DISABLE_GRAPHS",
                    ),
                    ["GGML_CUDA_GRAPH_OPT", "1"],
                  ])
                }
                className="rounded-md border border-zinc-700/50 bg-zinc-800/60 px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
              >
                Graphs ON preset
              </button>
              <button
                type="button"
                onClick={() =>
                  setEnvEntries((e) => [
                    ...e.filter(
                      ([key]) =>
                        key !== "GGML_CUDA_GRAPH_OPT" &&
                        key !== "GGML_CUDA_DISABLE_GRAPHS",
                    ),
                    ["GGML_CUDA_GRAPH_OPT", "0"],
                  ])
                }
                className="rounded-md border border-zinc-700/50 bg-zinc-800/60 px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
              >
                Graphs OFF preset
              </button>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h3>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
