# Proposed Changes: Use Windows IP for Display/Copy URL (vLLM on WSL2)

## Problem

When vLLM runs inside WSL2, the app stores the WSL VM's Hyper-V NIC IP (`172.x.x.x`) as the instance `host`. This IP is used everywhere — display, copy base URL, chat transport, and health polling. The user wants the Windows LAN IP (`192.168.x.x`) shown/copied instead, as it works for local access and LAN sharing (with a netsh port-forward rule).

## Current Flow

```
vllm.ipc.ts → connectionHost = getWslVmIp() → 172.x.x.x
  → createInstance({ host: connectionHost })
  → startProcess(..., host: connectionHost, ...)
    → HealthPoller(connectionHost)  ← health polling
  → DB stores host = 172.x.x.x
  → Renderer receives host = 172.x.x.x
    → InstancesTable: display, copy URL, open docs
    → chatStore: resolveTransport(host, port) → chat fetches
```

## Proposed Changes

### 1. `src/shared/types.ts` — Add `connectionHost` runtime field

```typescript
export interface ServerInstance {
  // ... existing fields ...
  host: string;
  port: number;
  /** Internal connection host (e.g., WSL2 VM IP). Runtime-only, not persisted.
   *  Used for health polling. Falls back to `host` when not set. */
  connectionHost?: string;
}
```

### 2. `src/main/db/repos/serverInstances.repo.ts` — Accept `connectionHost` in `createInstance`

- Add optional `connectionHost` parameter to the `createInstance` interface
- Store it in a new column (or keep as runtime-only — see tradeoff below)
- Return it from `getInstance`/`listInstances`

**Decision:** Keep `connectionHost` as a runtime-only field on `ManagedProcess` in `processManager.ts`, not persisted in DB. The `createInstance` call doesn't need to change. Instead, `processManager` sets `connectionHost` on the `ServerInstance` object after creation.

### 3. `src/main/ipc/vllm.ipc.ts` — Store Windows IP in `host`, WSL IP in `connectionHost`

```typescript
// Before:
let connectionHost = host;
if (process.platform === "win32" && !isDockerPlan) {
  const wslIp = getWslVmIp();
  if (wslIp) connectionHost = wslIp;
}
createInstance({ ..., host: connectionHost });
startProcess(id, ..., connectionHost, ...);

// After:
const displayHost = host;          // Windows IP or settings default (127.0.0.1 / 0.0.0.0)
let connectionHost = displayHost;
if (process.platform === "win32" && !isDockerPlan) {
  const wslIp = getWslVmIp();
  if (wslIp) connectionHost = wslIp;
}
createInstance({ ..., host: displayHost });
startProcess(id, ..., connectionHost, ...);
```

### 4. `src/main/services/processManager.ts` — Use `connectionHost` for health polling

```typescript
// Before:
const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
const poller = new HealthPoller({ host: displayHost, port, ... });

// After:
const connHost = (connectionHost ?? host) === '0.0.0.0' ? '127.0.0.1' : (connectionHost ?? host);
const poller = new HealthPoller({ host: connHost, port, ... });
```

### 5. `src/main/ipc/server.ipc.ts` — Return `connectionHost` in instance list

```typescript
// In the instances.map() callback:
return {
  ...inst,
  connectionHost: processes.get(inst.id)?.connectionHost,  // runtime-only
  // ...
};
```

### 6. `src/renderer/src/components/server/InstancesTable.tsx` — No change needed

`host` is already used for display/copy. With the new flow, `host` will be the Windows IP.

### 7. `src/renderer/src/lib/transport.ts` — No change needed

Transport uses `host` for fetch. With the new flow, it uses the Windows IP.

## Files to Modify

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `connectionHost?: string` to `ServerInstance` |
| `src/main/ipc/vllm.ipc.ts` | Store Windows IP in `host`, WSL IP in `connectionHost` |
| `src/main/services/processManager.ts` | Add `connectionHost` to `ManagedProcess`, use it for health polling |
| `src/main/ipc/server.ipc.ts` | Return `connectionHost` in instance list |

## Risk & Fallback

- **Risk:** Windows IP may not work for Chromium fetch if WSL2 server isn't bound to the Windows interface. You've confirmed it works for you (with netsh port-forward).
- **Fallback:** If chat breaks, we can add a setting to toggle between WSL IP and Windows IP, or fall back to WSL IP if the Windows IP fails health checks.
