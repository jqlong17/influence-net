import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const root = fileURLToPath(new URL('.', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))

function resolvePkg(name: string): string | null {
  try {
    return path.dirname(require.resolve(`${name}/package.json`))
  } catch {
    return null
  }
}

const siblingHarness = path.join(root, '../deepseek-harness')
const dshRoot = process.env.DSH_ROOT
  || (existsSync(path.join(siblingHarness, 'package.json')) ? siblingHarness : null)
const browserNm = dshRoot
  ? path.join(dshRoot, 'packages/client/ui-sidebar-browser/node_modules')
  : null

const localReact = resolvePkg('react')
const localReactDom = resolvePkg('react-dom')

const alias: Record<string, string> = {}
if (browserNm && existsSync(browserNm)) {
  alias.react = path.join(browserNm, 'react')
  alias['react/jsx-runtime'] = path.join(browserNm, 'react/jsx-runtime.js')
  alias['react-dom'] = path.join(browserNm, 'react-dom')
} else if (localReact && localReactDom) {
  alias.react = localReact
  alias['react/jsx-runtime'] = path.join(localReact, 'jsx-runtime.js')
  alias['react-dom'] = localReactDom
}

export default defineConfig({
  root,
  resolve: { alias },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    include: ['tests/plugin/**/*.spec.ts', 'tests/plugin/**/*.spec.tsx'],
  },
})
