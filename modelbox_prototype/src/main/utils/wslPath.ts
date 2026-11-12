import path from "node:path";
import { execSync, execFile, execFileSync } from "child_process";
import { promisify } from "util";
import { mkdir as fsMkdir } from "fs/promises";
import { mkdirSync as fsMkdirSync } from "fs";

const execFileAsync = promisify(execFile);

/**
 * `\\wsl$\Distro\home\moody\...` (or `\\wsl.localhost\...`) → `/home/moody/...` inside
 * that distro. Returns null if the path is not a WSL UNC.
 */
export function parseWslUncPath(unc: string): {
  distro: string;
  linuxPath: string;
} | null {
  // Normalise: convert forward slashes to backslashes, then ensure the UNC
  // prefix is exactly two backslashes.  Paths stored from path.resolve() on
  // Windows sometimes arrive with only one leading backslash (\wsl.localhost\…)
  // instead of the canonical UNC form (\\wsl.localhost\…).
  let t = unc.trim().replace(/\//g, "\\");
  if (t.startsWith("\\") && !t.startsWith("\\\\")) t = "\\" + t;
  const m =
    /^\\\\wsl(\$|\.localhost)\\([^\\]+)\\(.+)$/i.exec(t);
  if (!m) return null;
  const rest = m[3]!.replace(/\\/g, "/");
  const linuxPath = `/${rest.replace(/^\/+/, "")}`;
  return { distro: m[2]!, linuxPath };
}

/**
 * Build `\\wsl$\Distro\...` for a path that exists at `linuxPath` in that WSL
 * (same mapping Explorer uses: `/home/a/b` → `\\wsl$\Distro\home\a\b`).
 */
export function linuxPathToWslUnc(distro: string, absLinux: string): string {
  const clean = absLinux.replace(/\/+/g, "/").replace(/\/$/, "");
  const noLead = (clean.startsWith("/") ? clean.slice(1) : clean) || "";
  const segs = noLead.split("/").filter((s) => s.length > 0);
  return `\\\\wsl$\\${distro}\\${segs.join("\\")}`;
}

/**
 * Convert a Windows path like `C:\Users\foo` to WSL path `/mnt/c/Users/foo`.
 * `\\wsl$\...` is converted to a Linux path inside the distro (not `/mnt/...`).
 */
export function windowsPathToWslMnt(windowsPath: string): string {
  const t = windowsPath.trim();
  if (!t) return t;
  if (t.startsWith("/")) {
    return t;
  }
  if (t.startsWith("\\")) {
    // Covers both canonical UNC (\\wsl$\…) and single-backslash variants (\wsl.localhost\…).
    // parseWslUncPath normalises the leading backslash count internally.
    const wsl = parseWslUncPath(t);
    if (wsl) {
      return wsl.linuxPath;
    }
    return t;
  }
  const norm = path.normalize(t);
  const m = /^([a-zA-Z]):[/\\](.*)$/.exec(norm);
  if (!m) {
    return t;
  }
  const drive = m[1]!.toLowerCase();
  const rest = m[2]!.replace(/\\/g, "/");
  return `/mnt/${drive}/${rest}`;
}

/**
 * Asynchronously resolves the default WSL HuggingFace hub cache path as a Windows UNC path,
 * e.g. `\\wsl$\Ubuntu\home\moody\.cache\huggingface\hub`.
 * Returns null if WSL is unavailable or the distro/user can't be determined.
 * Uses execFile (non-blocking) so the main thread is never stalled.
 */
export async function getWslDefaultHfCacheDir(): Promise<string | null> {
  try {
    const stripWsl = (s: string): string => s.replace(/\x00/g, "").replace(/\r/g, "");
    const { stdout: listRaw } = await execFileAsync("wsl.exe", ["--list", "--verbose"], { timeout: 5000 });
    const clean = stripWsl(listRaw);
    const line = clean.split("\n").find((l) => l.trim().startsWith("*"));
    if (!line) return null;
    const distro = line.trim().replace(/^\*\s*/, "").split(/\s+/)[0];
    if (!distro) return null;
    const { stdout: userRaw } = await execFileAsync("wsl.exe", ["-d", distro, "--", "whoami"], { timeout: 5000 });
    const username = stripWsl(userRaw).trim();
    if (!username) return null;
    return linuxPathToWslUnc(distro, `/home/${username}/.cache/huggingface/hub`);
  } catch {
    return null;
  }
}

/**
 * Returns the primary IPv4 address of the running WSL2 VM (e.g. "172.x.x.x").
 *
 * WSL2's loopback forwarding (127.0.0.1 → wslhost.exe) is unreliable for both
 * Node.js http and Chromium fetch.  The VM's actual Hyper-V NIC IP is directly
 * routable from Windows and bypasses the proxy entirely.
 *
 * Returns null on non-Windows or if WSL2 is unavailable.
 */
export function getWslVmIp(): string | null {
  if (process.platform !== "win32") return null;
  try {
    const raw = execSync("wsl.exe hostname -I", { timeout: 3000 })
      .toString()
      .replace(/\x00/g, "")
      .replace(/\r/g, "")
      .trim();
    const ip = raw.split(/\s+/).find((s) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s));
    return ip ?? null;
  } catch {
    return null;
  }
}

/**
 * `mkdir -p` that works on WSL UNC paths (`\\wsl$\...` / `\\wsl.localhost\...`).
 * Node's built-in recursive mkdir fails on those paths via the 9P driver.
 * For WSL paths, delegates to `wsl.exe -d Distro -- mkdir -p /linuxpath`.
 * If the named distro is not found, retries with the default distro (no -d flag).
 */
export async function mkdirSafe(p: string): Promise<void> {
  const wsl = parseWslUncPath(p);
  if (wsl) {
    try {
      await execFileAsync("wsl.exe", ["-d", wsl.distro, "--", "mkdir", "-p", wsl.linuxPath], { timeout: 10000 });
    } catch {
      await execFileAsync("wsl.exe", ["--", "mkdir", "-p", wsl.linuxPath], { timeout: 10000 });
    }
    return;
  }
  await fsMkdir(p, { recursive: true });
}

/** Synchronous variant of mkdirSafe. For WSL paths, uses execFileSync. */
export function mkdirSafeSync(p: string): void {
  const wsl = parseWslUncPath(p);
  if (wsl) {
    try {
      execFileSync("wsl.exe", ["-d", wsl.distro, "--", "mkdir", "-p", wsl.linuxPath], { timeout: 10000 });
    } catch {
      execFileSync("wsl.exe", ["--", "mkdir", "-p", wsl.linuxPath], { timeout: 10000 });
    }
    return;
  }
  fsMkdirSync(p, { recursive: true });
}

/**
 * If `p` is a WSL UNC path and the embedded distro name is not a valid WSL install,
 * returns a copy of the path with the distro replaced by the default installed distro.
 * Otherwise returns `p` unchanged.
 *
 * Call this once before constructing file paths to ensure mkdir and file I/O both
 * target the same distro (avoids the case where mkdirSafe fallback creates the dir in
 * Ubuntu-24.04 but destPath still references the non-existent "Ubuntu" mount).
 */
export async function normalizeWslUncDistro(p: string): Promise<string> {
  if (process.platform !== "win32") return p;
  const wsl = parseWslUncPath(p);
  if (!wsl) return p;
  try {
    await execFileAsync("wsl.exe", ["-d", wsl.distro, "--", "true"], { timeout: 3000 });
    return p; // distro name is valid
  } catch {
    /* fall through */
  }
  try {
    const { stdout } = await execFileAsync("wsl.exe", ["-l", "-q"], {
      windowsHide: true,
      maxBuffer: 8 * 1024,
      encoding: "buffer",
      timeout: 5000,
    });
    const decoded = (stdout as unknown as Buffer)
      .toString("utf16le")
      .replace(/^﻿/, "");
    const defDistro = decoded
      .split(/\r?\n/u)
      .map((s) => s.replace(/\0/g, "").trim())
      .find((s) => s.length > 0);
    if (defDistro && defDistro !== wsl.distro) {
      return linuxPathToWslUnc(defDistro, wsl.linuxPath);
    }
  } catch {
    /* ignore */
  }
  return p;
}

/**
 * vLLM launch path: on Windows, Python in WSL expects `/mnt/...` for files on the NTFS drive.
 * On other platforms, return normalized native path.
 */
export function toVllmModelPathForLaunch(modelPath: string): string {
  if (process.platform === "win32") {
    return windowsPathToWslMnt(modelPath);
  }
  try {
    return path.normalize(path.resolve(modelPath));
  } catch {
    return modelPath;
  }
}
