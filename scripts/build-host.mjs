import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)))
const repo = path.join(root, '..')
const candidates = [
  process.env.ESBUILD_BIN,
  path.join(repo, '../deepseek-harness/node_modules/.bin/esbuild'),
  path.join(repo, 'node_modules/.bin/esbuild'),
].filter(Boolean)

let bin = candidates.find((p) => p && existsSync(p))
if (!bin) {
  // last resort: npx
  bin = 'npx'
}

const args =
  bin === 'npx'
    ? ['esbuild', 'src/index.ts', '--bundle', '--platform=node', '--format=esm', '--outfile=lib/index.js', '--packages=external']
    : ['src/index.ts', '--bundle', '--platform=node', '--format=esm', '--outfile=lib/index.js', '--packages=external']

const r = spawnSync(bin, args, { cwd: repo, stdio: 'inherit', shell: bin === 'npx' })
process.exit(r.status ?? 1)
