import { hostPortMatchInstance } from "@shared/hostPortMatch";
import type { ServerState } from "@shared/types";

/**
 * Returns true for every server state that means the instance is alive and
 * should appear in the active-instance list. Includes the vLLM-specific
 * intermediate states (vllm-shards, vllm-compile, vllm-cudagraph) so the model
 * dropdown doesn't lose its selection during torch.compile / CUDA graph capture.
 */
export function isActiveState(state: ServerState): boolean {
  return (
    state === "running" ||
    state === "loading" ||
    state === "starting" ||
    state === "vllm-shards" ||
    state === "vllm-compile" ||
    state === "vllm-cudagraph"
  );
}

/**
 * Match a conversation's bound host/port to a running {@link ServerInstance}.
 * Treats loopback variants and `0.0.0.0` (listen-all) as compatible so the UI
 * stays in sync when the DB stores `127.0.0.1` but the process reports `0.0.0.0`, etc.
 */
export function conversationMatchesInstance(
  convHost: string | null | undefined,
  convPort: number | null | undefined,
  inst: { host: string; port: number },
): boolean {
  if (convHost == null || convPort == null) return false;
  return hostPortMatchInstance(convHost, convPort, inst);
}
