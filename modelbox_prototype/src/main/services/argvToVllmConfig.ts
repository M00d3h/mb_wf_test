import type { VllmModelConfig } from "@shared/types";

type VllmConfigKey = keyof VllmModelConfig;

const TRACKED: VllmConfigKey[] = [
  "host",
  "port",
  "maxModelLen",
  "reasoningParser",
  "enableAutoToolChoice",
  "toolCallParser",
  "servedModelName",
  "maxNumSeqs",
  "gpuMemoryUtilization",
  "kvCacheDtype",
  "speculativeConfig",
  "temperature",
  "topP",
  "topK",
  "minP",
  "repetitionPenalty",
  "presencePenalty",
  "frequencyPenalty",
];

function parseFloatStrict(s: string): number | undefined {
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function parseIntStrict(s: string): number | undefined {
  const n = parseInt(s.replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Merge argv-derived vLLM flags into profile config for Apply custom command.
 * Keys seen in argv replace structured fields; keys not present are removed from
 * the merged slice so the UI matches the command. `launchMode` / API-key–like
 * fields are left to the caller.
 */
export function mergeArgvIntoVllmConfig(
  args: string[],
  base: VllmModelConfig,
): VllmModelConfig {
  const extracted: Partial<VllmModelConfig> = {};
  const seen = new Set<VllmConfigKey>();

  const setNum = (key: VllmConfigKey, v: number | undefined): void => {
    if (v === undefined) return;
    seen.add(key);
    (extracted as Record<string, unknown>)[key] = v;
  };

  const setStr = (key: VllmConfigKey, v: string | undefined): void => {
    if (v === undefined || v === "") return;
    seen.add(key);
    // Strip surrounding shell quotes (from display-command round-trip or user input)
    const cleaned = v.replace(/^(['"])(.*)\1$/s, '$2');
    (extracted as Record<string, unknown>)[key] = cleaned;
  };

  const setBool = (key: VllmConfigKey, v: boolean): void => {
    seen.add(key);
    (extracted as Record<string, unknown>)[key] = v;
  };

  let i = 0;
  while (i < args.length) {
    let tok = args[i]!;
    if (!tok.startsWith("-")) {
      i++;
      continue;
    }

    const eq = tok.indexOf("=");
    let flag = tok;
    let inlineVal: string | undefined;
    if (eq !== -1) {
      flag = tok.slice(0, eq);
      inlineVal = tok.slice(eq + 1);
    }

    const nextVal = (): string | undefined => {
      if (inlineVal !== undefined) return inlineVal;
      const n = args[i + 1];
      if (n !== undefined && !n.startsWith("-")) {
        i++;
        return n;
      }
      return undefined;
    };

    switch (flag) {
      case "--host":
        setStr("host", nextVal());
        break;
      case "--port":
        setNum("port", parseIntStrict(nextVal() ?? ""));
        break;
      case "--max-model-len":
        setNum("maxModelLen", parseIntStrict(nextVal() ?? ""));
        break;
      case "--reasoning-parser":
        setStr("reasoningParser", nextVal());
        break;
      case "--enable-auto-tool-choice":
        setBool("enableAutoToolChoice", true);
        break;
      case "--tool-call-parser":
        setStr("toolCallParser", nextVal());
        break;
      case "--served-model-name":
        setStr("servedModelName", nextVal());
        break;
      case "--max-num-seqs":
        setNum("maxNumSeqs", parseIntStrict(nextVal() ?? ""));
        break;
      case "--gpu-memory-utilization":
        setNum("gpuMemoryUtilization", parseFloatStrict(nextVal() ?? ""));
        break;
      case "--kv-cache-dtype":
        setStr("kvCacheDtype", nextVal());
        break;
      case "--speculative-config": {
        let raw = nextVal();
        if (!raw) break;
        // Strip surrounding shell quotes that the user may have typed
        if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) raw = raw.slice(1, -1);
        if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
        if (raw) setStr("speculativeConfig", raw);
        break;
      }
      case "--override-generation-config": {
        const raw = nextVal();
        if (!raw) break;
        try {
          const j = JSON.parse(raw) as Record<string, unknown>;
          const num = (jsonKey: string, cfgKey: VllmConfigKey, integer = false): void => {
            const v = j[jsonKey];
            if (typeof v !== "number" || !Number.isFinite(v)) return;
            setNum(cfgKey, integer ? Math.round(v) : v);
          };
          num("temperature", "temperature");
          num("top_p", "topP");
          num("top_k", "topK", true);
          num("min_p", "minP");
          num("repetition_penalty", "repetitionPenalty");
          num("presence_penalty", "presencePenalty");
          num("frequency_penalty", "frequencyPenalty");
        } catch { /* ignore invalid JSON */ }
        break;
      }
      default:
        break;
    }
    i++;
  }

  const next: VllmModelConfig = { ...base };
  for (const k of TRACKED) {
    if (!seen.has(k)) {
      delete next[k];
    }
  }
  return { ...next, ...extracted };
}
