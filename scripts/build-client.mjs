/**
 * Build a dsh ModuleLoader client factory for influence-net.
 * Externals stay as require() calls answered by the browser module table.
 */
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdirSync } from 'node:fs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dshRoot = process.env.DSH_ROOT
  ? process.env.DSH_ROOT
  : (existsSync(join(root, '../deepseek-harness/package.json'))
      ? join(root, '../deepseek-harness')
      : join(root, '..'))
const pnpm = join(dshRoot, 'node_modules/.pnpm')

function findEsbuild() {
  for (const name of readdirSync(pnpm)) {
    if (!name.startsWith('esbuild@')) continue
    const candidate = join(pnpm, name, 'node_modules/esbuild')
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  throw new Error('esbuild not found under dsh node_modules/.pnpm')
}

const require = createRequire(join(findEsbuild(), 'package.json'))
const esbuild = require('.')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const id = pkg.name
const outDir = join(root, 'lib')
mkdirSync(outDir, { recursive: true })

const externals = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-sidebar-right',
  '@deepseek-ai/dsh-client-ui-sidebar-right/client',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const result = await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src/client/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  write: false,
  jsx: 'automatic',
  external: externals,
  logLevel: 'info',
})

const code = result.outputFiles[0].text
const wrapped =
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\n` +
  `var module = { exports: {} }; var exports = module.exports;\n` +
  `${code}\n` +
  `return module.exports;\n` +
  `} });\n`

writeFileSync(join(outDir, 'client.js'), wrapped)
console.log(`wrote ${join(outDir, 'client.js')} (${wrapped.length} bytes)`)
