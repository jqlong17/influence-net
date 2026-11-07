import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync } from 'node:fs'

const root = fileURLToPath(new URL('.', import.meta.url))
const siblingHarness = path.join(root, '../deepseek-harness')
const dshRoot = process.env.DSH_ROOT
  || (existsSync(path.join(siblingHarness, 'package.json')) ? siblingHarness : path.join(root, '..'))
const browserNm = path.join(dshRoot, 'packages/client/ui-sidebar-browser/node_modules')

export default defineConfig({
  root,
  resolve: {
    alias: existsSync(browserNm)
      ? {
          react: path.join(browserNm, 'react'),
          'react/jsx-runtime': path.join(browserNm, 'react/jsx-runtime.js'),
          'react-dom': path.join(browserNm, 'react-dom'),
        }
      : {},
  },
  test: {
    environment: 'node',
    include: ['tests/plugin/**/*.spec.ts', 'tests/plugin/**/*.spec.tsx'],
  },
})
