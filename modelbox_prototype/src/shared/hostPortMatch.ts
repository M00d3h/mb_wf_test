/**
 * True when `host`/`port` refer to the same listen endpoint as `inst`.
 * Treats loopback variants and `0.0.0.0` (listen-all) like the renderer does
 * so main-process lookups stay aligned with {@link conversationMatchesInstance}.
 */
export function hostPortMatchInstance(
  host: string,
  port: number,
  inst: { host: string; port: number },
): boolean {
  if (Number(inst.port) !== Number(port)) return false;
  const a = host.trim().toLowerCase();
  const b = inst.host.trim().toLowerCase();
  if (a === b) return true;
  const loopback = new Set(["127.0.0.1", "localhost", "::1"]);
  if (loopback.has(a) && loopback.has(b)) return true;
  if (a === "0.0.0.0" || b === "0.0.0.0") return true;
  return false;
}
