// @vitest-environment jsdom
/**
 * Client apply contract against the real cordis Context + a host-faithful
 * sidebarRightTabs registry (register/get/dispose), matching
 * @deepseek-ai/dsh-client-ui-sidebar-right SidebarRightTabRegistry behaviour
 * without importing the browser ModuleLoader bundle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject } from '../../src/client/index.ts'
import { GUIDE_TITLE, PLUGIN_ID, TAB_KIND, VIEW_RADAR, VIEW_RELATION } from '../../src/client/labels.ts'
import { InfluenceLabBody } from '../../src/client/InfluenceLabBody.tsx'
import type { InfluenceNetTabDefinition } from '../../src/client/definition.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.fiber.dispose()))
})

interface Recorded {
  name: string
  key: string
  component: unknown
}

/**
 * Minimal SidebarRightTabRegistry stand-in that preserves the host contract used
 * by plugins: register() returns a disposer, get(kind) returns the in-force
 * definition, and cordis effect cleanup removes the registration.
 */
class SidebarRightTabRegistryStub {
  private readonly kinds = new Map<string, InfluenceNetTabDefinition>()
  private readonly ids = new Set<string>()

  constructor(private readonly ctx: Context) {}

  register(definition: InfluenceNetTabDefinition): () => void {
    const { id, kind } = definition
    if (this.ids.has(id)) {
      throw new Error(`sidebarRight: tab type id "${id}" is already registered`)
    }
    if (this.kinds.has(kind)) {
      throw new Error(`sidebarRight: tab kind "${kind}" is already registered`)
    }
    const dispose = this.ctx.effect(() => {
      this.ids.add(id)
      this.kinds.set(kind, definition)
      return () => {
        this.ids.delete(id)
        this.kinds.delete(kind)
      }
    }, `sidebarRight.tabs.register(${JSON.stringify(id)})`)
    return () => {
      dispose()
    }
  }

  get(kind: string): InfluenceNetTabDefinition | undefined {
    return this.kinds.get(kind)
  }
}

async function boot() {
  const ctx = new Context()
  contexts.push(ctx)
  const tabs = new SidebarRightTabRegistryStub(ctx)
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
