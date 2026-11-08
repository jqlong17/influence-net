import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(scriptDir, '..')
const require = createRequire(path.join(repo, 'package.json'))

function findEsbuild() {
  if (process.env.ESBUILD_BIN && existsSync(process.env.ESBUILD_BIN)) return process.env.ESBUILD_BIN

  try {
    const pkg = require.resolve('esbuild/package.json')
    const bin = path.join(path.dirname(pkg), 'bin', 'esbuild')
    if (existsSync(bin)) return bin
  } catch {
    /* fall through */
  }

  const direct = [
    path.join(repo, 'node_modules', '.bin', 'esbuild'),
    path.join(repo, '../deepseek-harness/node_modules/.bin/esbuild'),
  ]
  for (const c of direct) {
    const resolved = path.resolve(c)
    if (existsSync(resolved)) return resolved
  }

  const pnpmRoots = [
    path.resolve(repo, 'node_modules/.pnpm'),
    path.resolve(repo, '../deepseek-harness/node_modules/.pnpm'),
  ]
  for (const pnpm of pnpmRoots) {
    if (!existsSync(pnpm)) continue
    const bins = []
    for (const ent of readdirSync(pnpm)) {
      if (!ent.startsWith('esbuild@')) continue
      const bin = path.join(pnpm, ent, 'node_modules/esbuild/bin/esbuild')
      if (existsSync(bin)) bins.push({ ent, bin })
    }
    bins.sort((a, b) => b.ent.localeCompare(a.ent, undefined, { numeric: true }))
    if (bins[0]?.bin) return bins[0].bin
  }
  return null
}

const bin = findEsbuild()
if (!bin) {
  console.error('esbuild not found; run npm install or set ESBUILD_BIN')
  process.exit(1)
}
console.log('[bundle:host] using', bin)
const r = spawnSync(
  bin,
  ['src/index.ts', '--bundle', '--platform=node', '--format=esm', '--outfile=lib/index.js', '--packages=external'],
  { cwd: repo, stdio: 'inherit' },
)
process.exit(r.status ?? 1)
