import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ensureLocalEngine,
  isInfluenceEngineHealth,
  isLocalEngineBase,
  parseLocalEngineTarget,
  resolvePackageRoot,
} from '../../src/ensure-engine.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function healthOk() {
  return new Response(JSON.stringify({ ok: true, product_id: 'influence-net' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.INFLUENCE_NET_SKIP_AUTOSTART
  delete process.env.INFLUENCE_NET_PYTHON
})

describe('isLocalEngineBase / parseLocalEngineTarget', () => {
  it('accepts default localhost:18765 and custom loopback ports', () => {
    expect(isLocalEngineBase('http://127.0.0.1:18765')).toBe(true)
    expect(isLocalEngineBase('http://localhost:18765/')).toBe(true)
    expect(isLocalEngineBase('http://127.0.0.1:3080')).toBe(true)
    expect(isLocalEngineBase('http://localhost:29123')).toBe(true)
    expect(parseLocalEngineTarget('http://127.0.0.1:3080')).toEqual({
      base: 'http://127.0.0.1:3080',
      hostname: '127.0.0.1',
      port: 3080,
    })
  })

  it('rejects remote, https, or missing explicit port', () => {
    expect(isLocalEngineBase('http://example.com:18765')).toBe(false)
    expect(isLocalEngineBase('https://127.0.0.1:18765')).toBe(false)
    expect(isLocalEngineBase('https://influence.notta.uk')).toBe(false)
    expect(isLocalEngineBase('http://127.0.0.1')).toBe(false)
    expect(isLocalEngineBase('not-a-url')).toBe(false)
  })
})

describe('isInfluenceEngineHealth', () => {
  it('requires ok + product_id', () => {
    expect(isInfluenceEngineHealth({ ok: true, product_id: 'influence-net' })).toBe(true)
    expect(isInfluenceEngineHealth({ ok: true })).toBe(false)
    expect(isInfluenceEngineHealth({ ok: true, product_id: 'other' })).toBe(false)
    expect(isInfluenceEngineHealth(null)).toBe(false)
  })
})

describe('resolvePackageRoot', () => {
  it('maps lib/index.js → package root', () => {
    const fake = path.join(repoRoot, 'lib', 'index.js')
    expect(resolvePackageRoot(`file://${fake}`)).toBe(repoRoot)
  })

  it('maps src/ensure-engine.ts → package root', () => {
    const fake = path.join(repoRoot, 'src', 'ensure-engine.ts')
    expect(resolvePackageRoot(`file://${fake}`)).toBe(repoRoot)
  })
})

describe('ensureLocalEngine', () => {
  it('returns already_up when health ok with engine identity', async () => {
    const fetchImpl = vi.fn(async () => healthOk())
    const spawnImpl = vi.fn()
    const r = await ensureLocalEngine({
      base: 'http://127.0.0.1:18765',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      spawnImpl: spawnImpl as never,
      packageRoot: repoRoot,
    })
    expect(r).toEqual({ ok: true, status: 'already_up', base: 'http://127.0.0.1:18765' })
    expect(spawnImpl).not.toHaveBeenCalled()
  })

  it('does not treat foreign {ok:true} health as already_up', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, product_id: 'something-else' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const spawnImpl = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { pid: 1, unref: vi.fn() })
      return child
    })
    const r = await ensureLocalEngine({
      base: 'http://127.0.0.1:3080',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      spawnImpl: spawnImpl as never,
      packageRoot: repoRoot,
      timeoutMs: 80,
      intervalMs: 20,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe('failed')
    expect(spawnImpl).toHaveBeenCalledOnce()
  })

  it('skips spawn for non-local base', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down')
    })
    const spawnImpl = vi.fn()
    const r = await ensureLocalEngine({
      base: 'http://example.com:18765',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      spawnImpl: spawnImpl as never,
      packageRoot: repoRoot,
      timeoutMs: 100,
      intervalMs: 20,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe('skipped')
    expect(spawnImpl).not.toHaveBeenCalled()
  })

  it('spawns engine with matching host/port and waits until healthy', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      if (calls < 3) throw new Error('down')
      return healthOk()
    })
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      unref: vi.fn(),
    })
    const spawnImpl = vi.fn(() => child)
    const r = await ensureLocalEngine({
      base: 'http://127.0.0.1:29111',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      spawnImpl: spawnImpl as never,
      packageRoot: repoRoot,
      timeoutMs: 2000,
      intervalMs: 10,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.status).toBe('started')
    expect(spawnImpl).toHaveBeenCalledOnce()
    const [cmd, args, opts] = spawnImpl.mock.calls[0]!
    expect(String(cmd)).toMatch(/python/)
    expect(args).toEqual(['-m', 'app.server', '--host', '127.0.0.1', '--port', '29111'])
    expect((opts as { cwd: string }).cwd).toBe(path.join(repoRoot, 'engine'))
    expect(child.unref).toHaveBeenCalled()
  })

  it('surfaces async spawn error without throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down')
    })
    const child = Object.assign(new EventEmitter(), {
      pid: undefined,
      unref: vi.fn(),
    })
    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => child.emit('error', new Error('spawn python3 ENOENT')))
      return child
    })
    const r = await ensureLocalEngine({
      base: 'http://127.0.0.1:29112',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      spawnImpl: spawnImpl as never,
      packageRoot: repoRoot,
      timeoutMs: 500,
      intervalMs: 20,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe('failed')
      expect(r.reason).toMatch(/ENOENT/)
    }
  })

  it('honours INFLUENCE_NET_SKIP_AUTOSTART', async () => {
    process.env.INFLUENCE_NET_SKIP_AUTOSTART = '1'
    const fetchImpl = vi.fn(async () => {
      throw new Error('down')
    })
    const spawnImpl = vi.fn()
    const r = await ensureLocalEngine({
      base: 'http://127.0.0.1:18765',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      spawnImpl: spawnImpl as never,
      packageRoot: repoRoot,
    })
    expect(r).toMatchObject({ ok: false, status: 'skipped' })
    expect(spawnImpl).not.toHaveBeenCalled()
  })
})
