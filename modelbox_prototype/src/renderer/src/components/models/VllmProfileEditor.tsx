import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/themeStore";
import { api } from "../../lib/ipc";
import type { VllmModelConfig, VllmProfile } from "@shared/types";
import {
  ProfileOptionalBool,
  ProfileOptionalNumber,
  ProfileOptionalSelect,
  ProfileOptionalText,
  ProfileRow,
} from "./ProfileField";

const VLLM_KV_CACHE_DTYPE_OPTIONS = [
  { label: "auto", value: "auto" },
  { label: "bfloat16", value: "bfloat16" },
  { label: "float16", value: "float16" },
  { label: "fp8", value: "fp8" },
  { label: "fp8_e4m3", value: "fp8_e4m3" },
  { label: "fp8_e5m2", value: "fp8_e5m2" },
  { label: "fp8_ds_mla", value: "fp8_ds_mla" },
  { label: "fp8_inc", value: "fp8_inc" },
  { label: "fp8_per_token_head", value: "fp8_per_token_head" },
  { label: "int8_per_token_head", value: "int8_per_token_head" },
  { label: "nvfp4", value: "nvfp4" },
  { label: "turboquant_3bit_nc", value: "turboquant_3bit_nc" },
  { label: "turboquant_4bit_nc", value: "turboquant_4bit_nc" },
  { label: "turboquant_k3v4_nc", value: "turboquant_k3v4_nc" },
  { label: "turboquant_k8v4_nc", value: "turboquant_k8v4_nc" },
];

interface GenConfig {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
}

function gcPlaceholder(val: number | undefined): string | undefined {
  return val != null ? `model default: ${val}` : undefined;
}

interface Props {
  profile: VllmProfile;
  modelPath: string;
  onPersist: (patch: {
    name?: string;
    config?: VllmModelConfig;
  }) => Promise<void>;
  onLiveChange?: (live: VllmModelConfig | null) => void;
}

function builderConfig(c: VllmModelConfig): VllmModelConfig {
  const next = { ...c, launchMode: "builder" as const };
  delete next.customCommandLine;
  return next;
}

export function VllmProfileEditor({
  profile,
  modelPath,
  onPersist,
  onLiveChange,
}: Props): JSX.Element {
  const { theme } = useThemeStore();
  const [name, setName] = useState(profile.name);
  const [config, setConfig] = useState<VllmModelConfig>({ ...profile.config });
  const [saving, setSaving] = useState(false);
  const [genConfig, setGenConfig] = useState<GenConfig>({});
  const [maxPositionEmbeddings, setMaxPositionEmbeddings] = useState<number | null>(null);
  const skipFirstPersist = useRef(true);
  const skipFirstLive = useRef(true);
  const onPersistRef = useRef(onPersist);
  onPersistRef.current = onPersist;
  const onLiveChangeRef = useRef(onLiveChange);
  onLiveChangeRef.current = onLiveChange;

  const profileConfigSig = JSON.stringify(profile.config);
  useEffect(() => {
    skipFirstPersist.current = true;
    skipFirstLive.current = true;
  }, [profile.id, profile.updatedAt]);

  useLayoutEffect(() => {
    setName((n) => (n === profile.name ? n : profile.name));
    setConfig((prev) =>
      JSON.stringify(prev) === profileConfigSig
        ? prev
        : { ...profile.config },
    );
  }, [profile.id, profile.updatedAt, profileConfigSig, profile.name]);

  useEffect(() => {
    let cancelled = false;
    if (!modelPath) return;
    api.vllm.generationConfig(modelPath).then((gc) => {
      if (cancelled) return;
      const fields = (gc as GenConfig | null) ?? {};
      setGenConfig(fields);
      // Pre-fill any sampling fields that aren't already set in the profile.
      setConfig((prev) => {
        const updates: Partial<VllmModelConfig> = {};
        const maybe = (key: keyof VllmModelConfig, v: number | undefined): void => {
          if (prev[key] === undefined && v != null) (updates as Record<string, unknown>)[key] = v;
        };
        maybe("temperature", fields.temperature);
        maybe("topP", fields.top_p);
        maybe("topK", fields.top_k);
        maybe("minP", fields.min_p);
        maybe("repetitionPenalty", fields.repetition_penalty);
        maybe("presencePenalty", fields.presence_penalty);
        maybe("frequencyPenalty", fields.frequency_penalty);
        if (Object.keys(updates).length === 0) return prev;
        return { ...prev, ...updates };
      });
    }).catch(() => {
      if (!cancelled) setGenConfig({});
    });
    return () => { cancelled = true; };
  }, [modelPath]);

  useEffect(() => {
    let cancelled = false;
    if (!modelPath) return;
    api.vllm.configMeta(modelPath).then((meta) => {
      if (cancelled) return;
      setMaxPositionEmbeddings(meta?.maxPositionEmbeddings ?? null);
    }).catch(() => {
      if (!cancelled) setMaxPositionEmbeddings(null);
    });
    return () => { cancelled = true; };
  }, [modelPath]);

  const set = <K extends keyof VllmModelConfig>(
    key: K,
    val: VllmModelConfig[K],
  ): void => {
    setConfig((c) => builderConfig({ ...c, [key]: val }));
  };

  const unset = (key: keyof VllmModelConfig): void => {
    setConfig((c) => {
      const next = builderConfig({ ...c });
      delete next[key];
      return next;
    });
  };

  const setOrUnset = <K extends keyof VllmModelConfig>(
    key: K,
    val: VllmModelConfig[K] | undefined,
  ): void => {
    if (val === undefined) unset(key);
    else set(key, val);
  };

  const persist = useCallback(async (): Promise<void> => {
    const namePatch = name !== profile.name ? name : undefined;
    const configPatch =
      JSON.stringify(config) !== profileConfigSig ? config : undefined;
    if (namePatch === undefined && configPatch === undefined) return;
    setSaving(true);
    try {
      await onPersistRef.current({
        name: namePatch,
        config: configPatch,
      });
    } finally {
      setSaving(false);
    }
  }, [name, config, profile.name, profileConfigSig]);

  useEffect(() => {
    if (skipFirstLive.current) {
      skipFirstLive.current = false;
      return;
    }
    onLiveChangeRef.current?.(config);
  }, [config]);

  useEffect(() => {
    if (skipFirstPersist.current) {
      skipFirstPersist.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      void persist();
    }, 300);
    return () => window.clearTimeout(t);
  }, [name, config, persist]);

  const isLight = theme === "light";
  const inputClass = cn(
    "w-full rounded-lg border border-zinc-700/60 bg-zinc-800/80 px-2.5 py-2 text-sm text-zinc-100 transition-colors focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/20",
    isLight ? "shadow-none ring-1 ring-zinc-700/15" : "shadow-sm",
  );

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

      <VllmSection title="Model">
        <ProfileRow
          label="Served model name"
          hint="OpenAI API name — `--served-model-name`"
        >
          <ProfileOptionalText
            value={config.servedModelName}
            onChange={(v) => setOrUnset("servedModelName", v)}
          />
        </ProfileRow>
      </VllmSection>

      <VllmSection title="Context & performance">
        <ProfileRow
          label="Max model length"
          hint={
            maxPositionEmbeddings
              ? `\`--max-model-len\` — model supports up to ${maxPositionEmbeddings.toLocaleString()} tokens (config.json).`
              : "`--max-model-len` — context window cap"
          }
        >
          <ProfileOptionalNumber
            value={config.maxModelLen}
            onChange={(v) => setOrUnset("maxModelLen", v)}
            min={256}
            max={maxPositionEmbeddings ?? 2_000_000}
          />
        </ProfileRow>
        <ProfileRow
          label="Max concurrent sequences"
          hint="`--max-num-seqs` — batch / concurrent requests"
        >
          <ProfileOptionalNumber
            value={config.maxNumSeqs}
            onChange={(v) => setOrUnset("maxNumSeqs", v)}
            min={1}
            max={256}
            showSlider={false}
          />
        </ProfileRow>
        <ProfileRow
          label="GPU memory utilization"
          hint="`--gpu-memory-utilization` — fraction of GPU memory (0–1)"
        >
          <ProfileOptionalNumber
            value={config.gpuMemoryUtilization}
            onChange={(v) => setOrUnset("gpuMemoryUtilization", v)}
            min={0.01}
            max={0.99}
            step={0.01}
          />
        </ProfileRow>
        <ProfileRow
          label="KV cache dtype"
          hint="`--kv-cache-dtype` — vLLM storage dtype"
        >
          <ProfileOptionalSelect
            value={config.kvCacheDtype}
            onChange={(v) => setOrUnset("kvCacheDtype", v)}
            options={VLLM_KV_CACHE_DTYPE_OPTIONS}
          />
        </ProfileRow>
      </VllmSection>

      <VllmSection title="Networking">
        <ProfileRow label="Host" hint="`--host`">
          <ProfileOptionalText
            value={config.host}
            onChange={(v) => setOrUnset("host", v)}
          />
        </ProfileRow>
        <ProfileRow
          label="Port"
          hint="`--port` — overrides Settings base port when set"
        >
          <ProfileOptionalNumber
            value={config.port}
            onChange={(v) => setOrUnset("port", v)}
            min={1024}
            max={65535}
            showSlider={false}
          />
        </ProfileRow>
      </VllmSection>

      <VllmSection title="Tools & reasoning">
        <ProfileRow
          label="Auto tool choice"
          hint="`--enable-auto-tool-choice`"
        >
          <ProfileOptionalBool
            value={config.enableAutoToolChoice}
            onChange={(v) => setOrUnset("enableAutoToolChoice", v)}
          />
        </ProfileRow>
        <ProfileRow label="Reasoning parser" hint="`--reasoning-parser`">
          <ProfileOptionalText
            value={config.reasoningParser}
            onChange={(v) => setOrUnset("reasoningParser", v)}
          />
        </ProfileRow>
        <ProfileRow label="Tool call parser" hint="`--tool-call-parser`">
          <ProfileOptionalText
            value={config.toolCallParser}
            onChange={(v) => setOrUnset("toolCallParser", v)}
          />
        </ProfileRow>
      </VllmSection>

      <VllmSection title="Sampling">
        <p className="-mt-1 mb-1 text-xs text-zinc-500">
          Unset options use the model&apos;s generation_config.json defaults (shown as placeholders) when present, otherwise vLLM server defaults apply.
        </p>
        <ProfileRow label="Temperature">
          <ProfileOptionalNumber
            value={config.temperature}
            onChange={(v) => setOrUnset("temperature", v)}
            min={0}
            max={2}
            step={0.05}
            placeholder={gcPlaceholder(genConfig.temperature)}
          />
        </ProfileRow>
        <ProfileRow label="Top-P">
          <ProfileOptionalNumber
            value={config.topP}
            onChange={(v) => setOrUnset("topP", v)}
            min={0}
            max={1}
            step={0.01}
            placeholder={gcPlaceholder(genConfig.top_p)}
          />
        </ProfileRow>
        <ProfileRow label="Top-K">
          <ProfileOptionalNumber
            value={config.topK}
            onChange={(v) => setOrUnset("topK", v)}
            min={0}
            step={1}
            showSlider={false}
            placeholder={gcPlaceholder(genConfig.top_k)}
          />
        </ProfileRow>
        <ProfileRow label="Min-P">
          <ProfileOptionalNumber
            value={config.minP}
            onChange={(v) => setOrUnset("minP", v)}
            min={0}
            max={1}
            step={0.01}
            placeholder={gcPlaceholder(genConfig.min_p)}
          />
        </ProfileRow>
        <ProfileRow label="Repetition penalty">
          <ProfileOptionalNumber
            value={config.repetitionPenalty}
            onChange={(v) => setOrUnset("repetitionPenalty", v)}
            min={0}
            max={2}
            step={0.05}
            placeholder={gcPlaceholder(genConfig.repetition_penalty)}
          />
        </ProfileRow>
        <ProfileRow label="Presence penalty">
          <ProfileOptionalNumber
            value={config.presencePenalty}
            onChange={(v) => setOrUnset("presencePenalty", v)}
            min={-2}
            max={2}
            step={0.05}
            placeholder={gcPlaceholder(genConfig.presence_penalty)}
          />
        </ProfileRow>
        <ProfileRow label="Frequency penalty">
          <ProfileOptionalNumber
            value={config.frequencyPenalty}
            onChange={(v) => setOrUnset("frequencyPenalty", v)}
            min={-2}
            max={2}
            step={0.05}
            placeholder={gcPlaceholder(genConfig.frequency_penalty)}
          />
        </ProfileRow>
      </VllmSection>
    </div>
  );
}

function VllmSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
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
