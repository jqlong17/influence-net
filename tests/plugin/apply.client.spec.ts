// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '../../packages/client/ui-sidebar-right/src/client/tab-registry.ts'
import { apply, inject } from '../../src/client/index.ts'
import { GUIDE_TITLE, PLUGIN_ID, TAB_KIND, VIEW_RADAR, VIEW_RELATION } from '../../src/client/labels.ts'
import { InfluenceLabBody } from '../../src/client/InfluenceLabBody.tsx'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()))
})

interface Recorded {
  name: string
  key: string
  component: unknown
}

async function boot() {
  const ctx = new Context()
  contexts.push(ctx)
  const tabs = new SidebarRightTabRegistry(ctx)
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => {
        registered.splice(registered.indexOf(entry), 1)
      }
    }),
  }
  const sidebar = {
    openTabs: { getSnapshot: () => [] },
    openTab: vi.fn(),
    openTabFromTarget: vi.fn(),
    commandTarget: vi.fn(),
  }
  ctx.provide('sidebarRight', sidebar as never)
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { tabs, registered, fiber, slots }
}

describe('influence-lab client apply', () => {
  it('registers tab kind influence-lab with guide 影响网', async () => {
    const { tabs } = await boot()
    const definition = tabs.get(TAB_KIND)
    expect(definition).toMatchObject({ id: PLUGIN_ID, kind: TAB_KIND, priority: 'extension' })
    expect(definition?.title('sidebar://influence-net')).toBe(GUIDE_TITLE)
    expect(definition?.guide?.[0]?.title()).toBe(GUIDE_TITLE)
  })

  it('registers pane body keyed to plugin id', async () => {
    const { registered } = await boot()
    expect(registered.map((e) => [e.name, e.key, e.component])).toEqual([
      ['sidebar.right.pane.tab', PLUGIN_ID, InfluenceLabBody],
    ])
  })

  it('body export exposes 关系网 / 雷达维 labels', () => {
    expect(VIEW_RELATION).toBe('关系网')
    expect(VIEW_RADAR).toBe('雷达维')
  })

  it('removes registrations on dispose', async () => {
    const { tabs, registered, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get(TAB_KIND)).toBeUndefined()
    expect(registered).toEqual([])
  })
})
