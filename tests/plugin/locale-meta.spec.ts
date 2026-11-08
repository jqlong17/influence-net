import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8')
}

function metaOf(lang: string): { title?: string; description?: string } {
  const parsed = JSON.parse(read(`locale/${lang}.json`)) as {
    meta?: { title?: string; description?: string }
  }
  return parsed.meta ?? {}
}

function manifest(): { name: string; exports?: Record<string, unknown>; files?: string[] } {
  return JSON.parse(read('package.json'))
}

describe('locale meta (installed-plugin card)', () => {
  it('anchors discovery on locale/en.json and ships zh', () => {
    const names = readdirSync(join(root, 'locale')).filter((n) => n.endsWith('.json'))
    expect(names).toContain('en.json')
    expect(names).toContain('zh.json')
  })

  it('exports ./locale/*.json so the host can resolve meta', () => {
    const { exports } = manifest()
    expect(exports?.['./locale/*.json']).toBe('./locale/*.json')
  })

  it('includes locale in files so the npm tarball ships it', () => {
    expect(manifest().files ?? []).toContain('locale')
  })

  it('zh title is 影响网 with package id for search/display', () => {
    const zh = metaOf('zh')
    expect(zh.title).toBe('影响网 (influence-net)')
    expect(zh.description?.includes('影响')).toBe(true)
    const en = metaOf('en')
    expect(en.title?.includes('influence-net')).toBe(true)
    expect((en.description ?? '').length).toBeGreaterThan(0)
  })

  it('keywords include 影响网 for Hub/npm search', () => {
    const pkg = JSON.parse(read('package.json')) as { keywords?: string[]; description?: string }
    expect(pkg.keywords ?? []).toContain('影响网')
    expect(pkg.description ?? '').toMatch(/^影响网/)
  })
})
