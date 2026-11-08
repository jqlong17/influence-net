/**
 * Package-level acceptance: npm pack → extract → real plugin apply cold-start
 * on an isolated home + custom loopback port. Does not publish.
 *
 * Requires: Node, python3 (for engine spawn), network only for localhost.
 */
import { spawn, execFileSync } from 'node:child_process'
import {
  createServer,
} from 'node:net'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  copyFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = process.env.ACCEPT_ARTIFACTS_DIR
  || (existsSync('/opt/cursor/artifacts') ? '/opt/cursor/artifacts' : path.join(repo, 'artifacts'))
const report = []
const log = (msg) => {
  const line = `[accept-pack] ${msg}`
  console.log(line)
  report.push(line)
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      s.close((err) => (err ? reject(err) : resolve(port)))
    })
    s.on('error', reject)
  })
}

async function waitFor(fn, { timeoutMs = 20_000, intervalMs = 250, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await fn()
    if (last) return last
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`timeout waiting for ${label}: ${String(last)}`)
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { ok: res.ok, status: res.status, body }
}

function killListenersOnPort(port) {
  const pids = new Set()
  try {
    const out = execFileSync('fuser', [`${port}/tcp`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    for (const m of String(out).matchAll(/(\d+)/g)) pids.add(m[1])
  } catch (err) {
    // fuser exits non-zero when nothing holds the port; also try lsof.
    try {
      const out = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      for (const m of String(out).matchAll(/(\d+)/g)) pids.add(m[1])
    } catch {
      /* nothing listening or tools missing */
    }
    if (err && pids.size === 0) {
      /* ignore */
    }
  }
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM')
    } catch {
      /* already gone */
    }
  }
}

async function occupyPort(port) {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  return server
}

async function main() {
  mkdirSync(artifacts, { recursive: true })
  const work = mkdtempSync(path.join(tmpdir(), 'influence-net-accept-'))
  const home1 = path.join(work, 'home-cold')
  mkdirSync(home1)

  let port = 0
  let conflictPort = 0
  let conflictServer = null

  try {
    log(`repo=${repo}`)
    log('installing npm deps (legacy-peer-deps for plugin unit-test peer graph)…')
    execFileSync('npm', ['install', '--legacy-peer-deps'], {
      cwd: repo,
      stdio: 'inherit',
      env: { ...process.env, npm_config_fund: 'false', npm_config_audit: 'false' },
    })

    log('building host+client…')
    execFileSync('npm', ['run', 'build'], { cwd: repo, stdio: 'inherit' })

    if (!existsSync(path.join(repo, 'lib/index.js'))) throw new Error('lib/index.js missing after build')
    if (!existsSync(path.join(repo, 'lib/client.js'))) throw new Error('lib/client.js missing after build')
    if (!existsSync(path.join(repo, 'locale/zh.json'))) throw new Error('locale/zh.json missing')
    if (!existsSync(path.join(repo, 'data/examples/fii-601138/seed.json'))) {
      throw new Error('example seed missing')
    }

    log('npm pack…')
    // --ignore-scripts: lib/ already built above; avoids prepack stdout polluting --json.
    const packName = execFileSync('npm', ['pack', '--json', '--ignore-scripts'], {
      cwd: repo,
      encoding: 'utf8',
    })
    const packMeta = JSON.parse(packName)
    const tarball = path.join(repo, packMeta[0].filename)
    if (!existsSync(tarball)) throw new Error(`pack tarball missing: ${tarball}`)
    const artifactTar = path.join(artifacts, packMeta[0].filename)
    copyFileSync(tarball, artifactTar)
    log(`artifact tarball → ${artifactTar}`)

    const packDir = path.join(work, 'pkg')
    mkdirSync(packDir)
    execFileSync('tar', ['-xzf', tarball, '-C', packDir])
    const installDir = path.join(packDir, 'package')
    log(`extracted install dir: ${installDir}`)

    // Host peers needed to load lib/index.js (esbuild --packages=external).
    // Do NOT use --legacy-peer-deps here: dsh-tools peers must resolve for import.
    execFileSync(
      'npm',
      [
        'install',
        '--no-save',
        '--no-package-lock',
        '@deepseek-ai/cordis@4.1.0',
        '@deepseek-ai/dsh-tools@0.0.1-rc.1',
      ],
      {
        cwd: installDir,
        stdio: 'inherit',
        env: { ...process.env, npm_config_fund: 'false', npm_config_audit: 'false' },
      },
    )
    for (const name of ['@deepseek-ai/dsh-tools', '@deepseek-ai/cordis', '@deepseek-ai/dsh-timeout']) {
      if (!existsSync(path.join(installDir, 'node_modules', name))) {
        throw new Error(`failed to install ${name} into pack extract dir`)
      }
    }

    const packed = JSON.parse(readFileSync(path.join(installDir, 'package.json'), 'utf8'))
    if (packed.version !== '0.1.5') throw new Error(`expected packed version 0.1.5, got ${packed.version}`)
    if (!packed.files?.includes('locale')) throw new Error('locale not in files')
    if (!existsSync(path.join(installDir, 'lib/index.js'))) throw new Error('packed lib/index.js missing')
    if (!existsSync(path.join(installDir, 'lib/client.js'))) throw new Error('packed lib/client.js missing')
    if (!existsSync(path.join(installDir, 'locale/en.json'))) throw new Error('packed locale/en.json missing')
    if (!existsSync(path.join(installDir, 'engine/app/server.py'))) throw new Error('packed engine missing')
    log('tarball content checks ok')

    port = await freePort()
    const base = `http://127.0.0.1:${port}`
    log(`cold-start apply on ${base} home=${home1}`)

    // Env must be set before importing the packed module (ENGINE_BASE captured at load).
    process.env.INFLUENCE_NET_HOME = home1
    process.env.INFLUENCE_NET_URL = base
    delete process.env.INFLUENCE_NET_SKIP_AUTOSTART
    delete process.env.INFLUENCE_NET_PYTHON

    const mod = await import(pathToFileURL(path.join(installDir, 'lib/index.js')).href)
    const { Context } = await import(pathToFileURL(
      path.join(installDir, 'node_modules/@deepseek-ai/cordis/lib/index.js'),
    ).href)

    async function runApplyOnce(label) {
      const ctx = new Context()
      const registered = []
      ctx.provide('tools', {
        register(tool) {
          registered.push(tool?.name || tool)
          return () => {}
        },
      })
      const fiber = ctx.plugin({ inject: [...mod.inject], apply: mod.apply })
      await fiber.await()
      log(`${label}: apply loaded tools=${registered.length}`)
      return { ctx, fiber, registered }
    }

    const first = await runApplyOnce('first-enable')
    const health = await waitFor(
      async () => {
        const r = await fetchJson(`${base}/api/health`).catch(() => null)
        if (r?.ok && r.body?.product_id === 'influence-net' && r.body?.ok === true) return r.body
        return null
      },
      { label: 'engine health after apply', timeoutMs: 25_000 },
    )
    log(`health ok product_id=${health.product_id} net_id=${health.net_id} home=${health.home}`)
    if (health.net_id !== 'net_fii_601138') {
      throw new Error(`expected autoload net_fii_601138, got ${health.net_id}`)
    }
    if (!String(health.home).startsWith(home1)) {
      throw new Error(`engine home leaked outside temp home: ${health.home}`)
    }

    const nets = await fetchJson(`${base}/api/nets`)
    if (!nets.ok || !Array.isArray(nets.body?.nets) || nets.body.nets.length < 1) {
      throw new Error(`nets empty: ${JSON.stringify(nets.body)}`)
    }
    const graph = await fetchJson(`${base}/api/graph?view=instance`)
    if (!graph.ok || !Array.isArray(graph.body?.nodes) || graph.body.nodes.length < 1) {
      throw new Error(`graph empty: ${JSON.stringify(graph.body)}`)
    }
    if (!Array.isArray(graph.body?.edges) || graph.body.edges.length < 1) {
      throw new Error('graph edges empty')
    }
    log(`graph nodes=${graph.body.nodes.length} edges=${graph.body.edges.length}`)

    const netDir = path.join(home1, 'nets', 'net_fii_601138')
    const sqlitePath = path.join(netDir, 'instances.sqlite')
    if (!existsSync(sqlitePath)) throw new Error('instances.sqlite missing after seed')
    const mtime1 = statSync(sqlitePath).mtimeMs

    // Second enable / restart: should not re-seed / overwrite.
    await first.fiber.dispose()
    killListenersOnPort(port)
    await new Promise((r) => setTimeout(r, 500))

    const second = await runApplyOnce('re-enable')
    await waitFor(
      async () => {
        const r = await fetchJson(`${base}/api/health`).catch(() => null)
        return r?.ok && r.body?.product_id === 'influence-net' ? r.body : null
      },
      { label: 'engine health after re-enable', timeoutMs: 25_000 },
    )
    const mtime2 = statSync(sqlitePath).mtimeMs
    if (mtime2 < mtime1) throw new Error('sqlite mtime went backwards after re-enable')
    // force=false path must keep the same net; file should not be rebuilt from scratch.
    // Allow small mtime drift only if process touched wal; core seed identity must remain.
    const loadPost = await fetch(`${base}/api/mcp/load_example`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ example_id: 'fii', force: false }),
    })
    const loadBody = await loadPost.json()
    if (loadBody.already_present !== true) {
      throw new Error(`expected already_present on re-load, got ${JSON.stringify(loadBody)}`)
    }
    log(`re-enable: already_present=${loadBody.already_present} mtime ${mtime1} → ${mtime2}`)
    await second.fiber.dispose()

    // Remote URL: must skip spawn.
    {
      const remote = await mod.ensureLocalEngine({
        base: 'https://example.com:18765',
        packageRoot: installDir,
        timeoutMs: 200,
        intervalMs: 50,
        fetchImpl: async () => {
          throw new Error('down')
        },
      })
      if (remote.ok || remote.status !== 'skipped') {
        throw new Error(`remote should skip, got ${JSON.stringify(remote)}`)
      }
      log(`remote URL skip: ${remote.reason}`)
    }

    // Missing python.
    {
      const miss = await mod.ensureLocalEngine({
        base: `http://127.0.0.1:${await freePort()}`,
        packageRoot: installDir,
        timeoutMs: 1500,
        intervalMs: 50,
        fetchImpl: async () => {
          throw new Error('down')
        },
        spawnImpl: (cmd, args, opts) => {
          const fake = spawn('/nonexistent-influence-net-python', args, { ...opts, detached: false })
          return fake
        },
      })
      if (miss.ok || miss.status !== 'failed') {
        throw new Error(`missing python should fail, got ${JSON.stringify(miss)}`)
      }
      log(`missing python failed as expected: ${miss.reason}`)
    }

    // Port conflict: foreign listener occupies the port.
    conflictPort = await freePort()
    conflictServer = await occupyPort(conflictPort)
    {
      const conflict = await mod.ensureLocalEngine({
        base: `http://127.0.0.1:${conflictPort}`,
        packageRoot: installDir,
        timeoutMs: 2500,
        intervalMs: 100,
        fetchImpl: async () => {
          throw new Error('down')
        },
      })
      if (conflict.ok) throw new Error(`port conflict should not report ok: ${JSON.stringify(conflict)}`)
      log(`port conflict status=${conflict.status} reason=${conflict.reason}`)
    }

    // Unit-style export sanity from packed module
    if (typeof mod.isLocalEngineBase !== 'function') throw new Error('packed export isLocalEngineBase missing')
    if (!mod.isLocalEngineBase('http://127.0.0.1:9999')) throw new Error('custom port should be local')
    if (mod.isLocalEngineBase('http://example.com:9999')) throw new Error('remote must not be local')

    writeFileSync(path.join(artifacts, 'accept-pack-report.txt'), report.join('\n') + '\n')
    log('ACCEPTANCE PASSED')
    console.log(JSON.stringify({
      ok: true,
      version: packed.version,
      artifact: artifactTar,
      port,
      nodes: graph.body.nodes.length,
      edges: graph.body.edges.length,
    }, null, 2))
  } finally {
    if (conflictServer) {
      await new Promise((r) => conflictServer.close(r))
    }
    if (port) killListenersOnPort(port)
    if (conflictPort) killListenersOnPort(conflictPort)
    // Keep work dir on failure for debug when ACCEPT_KEEP=1
    if (process.env.ACCEPT_KEEP === '1') {
      log(`kept work dir ${work}`)
    } else {
      try {
        rmSync(work, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
    // remove npm pack tarball from repo root (artifact copy retained)
    try {
      for (const f of readdirSync(repo)) {
        if (/^influence-net-.*\.tgz$/.test(f)) rmSync(path.join(repo, f), { force: true })
      }
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error('[accept-pack] FAILED', err)
  writeFileSync(
    path.join(artifacts, 'accept-pack-report.txt'),
    report.concat([`FAILED: ${err instanceof Error ? err.stack || err.message : String(err)}`]).join('\n') + '\n',
  )
  process.exit(1)
})
