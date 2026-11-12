import * as net from 'net'

// Connect-based check: only returns false when something is actively listening.
// Bind-based checks give false negatives on Windows when Hyper-V/WSL2 excludes
// port ranges — those ports can't be bound from Windows but vLLM (in WSL) can
// still use them.
export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(true); // no response = nothing listening = free
    }, 150);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false); // connection accepted = something is listening
    });
    socket.once('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true); // ECONNREFUSED or any error = nothing listening = free
    });
    socket.connect(port, host);
  });
}

export async function findFreePort(startPort: number, host = '127.0.0.1'): Promise<number> {
  let port = startPort
  while (port < startPort + 100) {
    if (await isPortFree(port, host)) return port
    port++
  }
  throw new Error(`No free port found starting from ${startPort}`)
}
