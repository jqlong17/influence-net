/**
 * Ensure the bundled local engine is reachable when the dsh plugin loads.
 * Empty ~/.influence-net is seeded with the FII (工业富联) demo by the engine boot path.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENGINE_DEFAULT_BASE, ENGINE_PATH_HEALTH } from './engine-paths.ts'

export type EnsureEngineResult =
  | { ok: true; status: 'already_up' | 'started'; base: string; detail?: string }
  | { ok: false; status: 'skipped' | 'failed'; base: string; reason: string }

export interface EnsureEngineOptions {
  base?: string
  /** Override package root (tests). */
  packageRoot?: string
  /** Health poll timeout ms (default 12000). */
  timeoutMs?: number
  /** Poll interval ms (default 250). */
  intervalMs?: number
  /** Injected fetch (tests). */
  fetchImpl?: typeof fetch
  /** Injected spawn (tests). */
  spawnImpl?: typeof spawn
  /** Skip auto-start when set (env INFLUENCE_NET_SKIP_AUTOSTART=1 also skips). */
  skipAutostart?: boolean
}

/** Parsed loopback HTTP engine base (safe to spawn). */
export interface LocalEngineTarget {
  base: string
  hostname: string
  port: number
}

function normalizeHostname(hostname: string): string {
  const h = hostname.trim().toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) return h.slice(1, -1)
  return h
}

function isLoopbackHostname(hostname: string): boolean {
  const h = normalizeHostname(hostname)
  return h === '127.0.0.1' || h === 'localhost' || h === '::1'
}

/**
 * Parse a base URL into a spawnable loopback HTTP target.
 * Only `http://` on loopback with an explicit valid port is accepted.
 */
export function parseLocalEngineTarget(base: string): LocalEngineTarget | null {
  try {
    const u = new URL(base)
    if (u.protocol !== 'http:') return null
    if (!isLoopbackHostname(u.hostname)) return null
    if (!u.port) return null
    const port = Number(u.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    const hostname = normalizeHostname(u.hostname)
    // Prefer IPv4 bind name the engine argparse expects; keep localhost as-is.
    const bindHost = hostname === '::1' ? '127.0.0.1' : hostname
    return {
      base: base.replace(/\/$/, ''),
      hostname: bindHost,
      port,
    }
  } catch {
    return null
  }
}

/** True when base is a safe local HTTP loopback URL (any port) we may auto-spawn. */
export function isLocalEngineBase(base: string): boolean {
  return parseLocalEngineTarget(base) !== null
}

/** Package root: works for src/*.ts and bundled lib/index.js. */
export function resolvePackageRoot(fromUrl: string = import.meta.url): string {
  const file = fileURLToPath(fromUrl)
  const dir = path.dirname(file)
  // Bundled host lands in lib/index.js → parent is package root.
  if (path.basename(dir) === 'lib') return path.resolve(dir, '..')
  // Dev: src/ensure-engine.ts → parent is package root.
  if (path.basename(dir) === 'src') return path.resolve(dir, '..')
  return path.resolve(dir)
}

export function engineDirFor(packageRoot: string): string {
  return path.join(packageRoot, 'engine')
}

/** Health is ours only when ok + product_id matches the influence-net engine. */
export function isInfluenceEngineHealth(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const rec = body as { ok?: unknown; product_id?: unknown }
  return rec.ok === true && rec.product_id === 'influence-net'
}

export async function pingEngineHealth(
  base: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${base.replace(/\/$/, '')}${ENGINE_PATH_HEALTH}`, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return false
    const body = await res.json()
    return isInfluenceEngineHealth(body)
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function pickPython(): string {
  const fromEnv = (process.env.INFLUENCE_NET_PYTHON || '').trim()
  if (fromEnv) return fromEnv
  return process.platform === 'win32' ? 'python' : 'python3'
}

/**
 * If the local engine is down, spawn `python -m app.server --host --port` from the packaged engine/.
 * Engine boot auto-loads 工业富联 when ~/.influence-net/nets is empty.
 */
export async function ensureLocalEngine(
  opts: EnsureEngineOptions = {},
): Promise<EnsureEngineResult> {
  const base = (opts.base || process.env.INFLUENCE_NET_URL || ENGINE_DEFAULT_BASE).replace(
    /\/$/,
    '',
  )
  const fetchImpl = opts.fetchImpl ?? fetch
  const spawnImpl = opts.spawnImpl ?? spawn
  const skip =
    opts.skipAutostart === true ||
    process.env.INFLUENCE_NET_SKIP_AUTOSTART === '1' ||
    process.env.INFLUENCE_NET_SKIP_AUTOSTART === 'true'

  if (await pingEngineHealth(base, fetchImpl)) {
    return { ok: true, status: 'already_up', base }
  }

  if (skip) {
    return { ok: false, status: 'skipped', base, reason: 'INFLUENCE_NET_SKIP_AUTOSTART' }
  }

  const target = parseLocalEngineTarget(base)
  if (!target) {
    return {
      ok: false,
      status: 'skipped',
      base,
      reason: 'non-local or non-http INFLUENCE_NET_URL; start the engine yourself',
    }
  }

  const packageRoot = opts.packageRoot || resolvePackageRoot()
  const engineDir = engineDirFor(packageRoot)
  const serverPy = path.join(engineDir, 'app', 'server.py')
  if (!existsSync(serverPy)) {
    return {
      ok: false,
      status: 'failed',
      base,
      reason: `engine missing at ${engineDir}`,
    }
  }

  let child: ChildProcess
  let spawnError: Error | null = null
  let exitedEarly = false
  try {
    child = spawnImpl(
      pickPython(),
      ['-m', 'app.server', '--host', target.hostname, '--port', String(target.port)],
      {
        cwd: engineDir,
        env: {
          ...process.env,
          PYTHONPATH: engineDir,
        },
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    )
    // Detached spawn can emit async 'error' (e.g. missing python); never let it crash the host.
    child.on('error', (err) => {
      spawnError = err instanceof Error ? err : new Error(String(err))
    })
    child.on('exit', () => {
      exitedEarly = true
    })
    child.unref()
  } catch (err) {
    return {
      ok: false,
      status: 'failed',
      base,
      reason: err instanceof Error ? err.message : String(err),
    }
  }

  const timeoutMs = opts.timeoutMs ?? 12_000
  const intervalMs = opts.intervalMs ?? 250
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (spawnError) {
      return {
        ok: false,
        status: 'failed',
        base,
        reason: spawnError.message,
      }
    }
    if (exitedEarly && !(await pingEngineHealth(base, fetchImpl))) {
      return {
        ok: false,
        status: 'failed',
        base,
        reason: `engine process exited before becoming healthy (pid=${child.pid ?? 'unknown'})`,
      }
    }
    if (await pingEngineHealth(base, fetchImpl)) {
      return {
        ok: true,
        status: 'started',
        base,
        detail: `pid=${child.pid ?? 'unknown'}`,
      }
    }
    await sleep(intervalMs)
  }

  if (spawnError) {
    return {
      ok: false,
      status: 'failed',
      base,
      reason: spawnError.message,
    }
  }

  return {
    ok: false,
    status: 'failed',
    base,
    reason: `engine did not become healthy within ${timeoutMs}ms (spawned pid=${child.pid ?? 'unknown'})`,
  }
}
