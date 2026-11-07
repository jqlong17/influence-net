import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  ENGINE_DEFAULT_BASE,
  ENGINE_PATH_ACTIVATE,
  ENGINE_PATH_GRAPH,
  ENGINE_PATH_HEALTH,
  ENGINE_PATH_NETS,
} from './engine-paths.ts'

export const name = 'influence-net'
export const inject = ['tools']

const ENGINE_BASE = process.env.INFLUENCE_NET_URL ?? ENGINE_DEFAULT_BASE

async function fetchJson(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const res = await fetch(`${ENGINE_BASE}${path}`, init)
    const text = await res.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      /* keep text */
    }
    return { ok: res.ok, status: res.status, body }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: {
        error: err instanceof Error ? err.message : String(err),
        hint: 'Start 影响网 engine on :18765 (engine/run.sh) or set INFLUENCE_NET_URL',
      },
    }
  }
}

function postJson(path: string, payload: Record<string, unknown>) {
  return fetchJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function apply(ctx: Context) {
  console.log('[influence-net] plugin loaded — 影响网')

  ctx.tools.register(
    defineTool({
      name: 'influence_net_status',
      description:
        'Ping the 影响网 (影响分析) plugin and local 影响网 engine. Confirms dsh plugin load + engineReachable.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute() {
        const health = await fetchJson(ENGINE_PATH_HEALTH)
        return {
          plugin: 'influence-net',
          product: '影响分析站 / 影响网',
          loaded: true,
          engineBase: ENGINE_BASE,
          engineReachable: health.ok,
          engine: health.body,
          note: 'Writes via MCP. Default write_mode=auto for low-risk narrative upserts; medium/high still need confirm→apply. Never invent strength.',
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'influence_net_get_graph',
      description:
        'Read 影响网 graph: view=instance (object instances) or view=abstract (dimension aggregation).',
      parameters: {
        view: {
          type: 'string',
          description: 'instance | abstract (default instance)',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const view = args.view === 'abstract' ? 'abstract' : 'instance'
        const res = await fetchJson(`${ENGINE_PATH_GRAPH}?view=${view}`)
        if (!res.ok) {
          return {
            plugin: 'influence-net',
            view,
            error: res.body,
            tip: 'Engine not reachable; start 影响网 engine on :18765 (./engine/run.sh).',
          }
        }
        const body = res.body as { nodes?: unknown[]; edges?: unknown[]; view?: string; net_id?: string }
        return {
          plugin: 'influence-net',
          view: body.view ?? view,
          net_id: body.net_id,
          nodeCount: Array.isArray(body.nodes) ? body.nodes.length : undefined,
          edgeCount: Array.isArray(body.edges) ? body.edges.length : undefined,
          graph: body,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'influence_net_propose',
      description:
        'Propose (and maybe auto-write) a graph patch from natural language. Default write_mode=auto: low-risk narrative-only updates apply immediately; medium/high stay pending until influence_net_apply after explicit confirm. NEVER invent strength (server preserves prior only). public needs issuer/mainstream evidence_urls (industry/aggregator alone → weak); refs stamped source_tier. Do not bash/sqlite-write — use this, influence_net_bulk_seed, or apply only.',
      parameters: {
        text: {
          type: 'string',
          description: 'User utterance / narrative (keep original wording as meat)',
        },
        evidence_urls: {
          type: 'array',
          description: 'Optional evidence URLs; public only if ≥1 issuer/mainstream host (else weak). Stamped source_tier.',
          items: { type: 'string' },
        },
        write_mode: {
          type: 'string',
          description: 'auto (default) | confirm | strict',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const text = String(args.text || '').trim()
        if (!text) return { error: 'text required' }
        const payload: Record<string, unknown> = { text }
        const urls = args.evidence_urls
        if (Array.isArray(urls) && urls.length) {
          payload.evidence_urls = urls.map((u) => String(u)).filter(Boolean)
        }
        const mode = String(args.write_mode || 'auto').trim().toLowerCase()
        payload.write_mode = mode === 'confirm' || mode === 'strict' ? mode : 'auto'
        const res = await postJson('/api/mcp/propose', payload)
        const body = res.body as { status?: string; risk?: string; auto_applied?: boolean; patch_id?: string }
        const applied = body?.status === 'applied' || body?.auto_applied === true
        return {
          plugin: 'influence-net',
          httpStatus: res.status,
          result: res.body,
          next: applied
            ? 'Auto-applied (low risk). Tell the user what was written; they can ask to undo via a follow-up if needed.'
            : 'Pending (needs confirm). Show the proposal. Only call influence_net_apply after explicit confirm; use influence_net_reject if they decline.',
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'influence_net_pending',
      description: 'List pending 影响网 patches awaiting user confirm/reject.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute() {
        const res = await fetchJson('/api/mcp/pending')
        return { plugin: 'influence-net', httpStatus: res.status, result: res.body }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'influence_net_apply',
      description:
        'Apply a pending patch_id ONLY after the user explicitly confirms in this turn (e.g. yes / 确认 / 写入). Never auto-apply. Writes SQLite via local engine MCP. If unsure, call influence_net_pending or ask the user.',
      parameters: {
        patch_id: {
          type: 'string',
          description: 'Pending patch id from influence_net_propose',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const patch_id = String(args.patch_id || '').trim()
        if (!patch_id) return { error: 'patch_id required' }
        const res = await postJson('/api/mcp/apply', { patch_id })
        return { plugin: 'influence-net', httpStatus: res.status, result: res.body }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'influence_net_reject',
      description: 'Reject a pending patch_id so it is not written.',
      parameters: {
        patch_id: {
          type: 'string',
          description: 'Pending patch id to reject',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const patch_id = String(args.patch_id || '').trim()
        if (!patch_id) return { error: 'patch_id required' }
        const res = await postJson('/api/mcp/reject', { patch_id })
        return { plugin: 'influence-net', httpStatus: res.status, result: res.body }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'influence_net_list_nets',
      description: 'List available influence nets (tickers) and the active net_id.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute() {
        const res = await fetchJson(ENGINE_PATH_NETS)
        return { plugin: 'influence-net', httpStatus: res.status, result: res.body }
      },
    }),
  )


  ctx.tools.register(
    defineTool({
      name: 'influence_net_bulk_seed',
      description:
        'Bulk-seed research structure (nodes/edges) into the active net via local engine MCP — not fake precision. NEVER invent strength (server strips it + warns). props.dimension must be one of: dim_upstream,dim_csp,dim_peers,dim_capacity,dim_product,dim_finance,dim_policy,dim_narrative (omit/null OK for center). public requires evidence_urls AND ≥1 issuer/mainstream URL (industry/aggregator/unverified alone → weak + warn); refs get source_tier. NEVER bash/sqlite-write instances. Default write_mode=confirm; auto applies intentional high-risk seed. replace_non_center=true clears non-center first.',
      parameters: {
        design: {
          type: 'object',
          description:
            'Design: {net_id, structure?: {title,purpose,asof}, nodes:[{id,type,name,props}], edges:[{id,rel,source,target,props,evidence_urls,attribution_tier}]}. Do not put strength in props. dimension ∈ 8 radar ids. public → issuer/mainstream evidence; server stamps source_tier on refs.',
          additionalProperties: true,
        },
        write_mode: {
          type: 'string',
          description: 'confirm (default) | auto | strict',
        },
        replace_non_center: {
          type: 'boolean',
          description: 'Clear links + non-center objects before upsert (default true)',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const design = args.design
        if (!design || typeof design !== 'object') return { error: 'design object required' }
        const payload: Record<string, unknown> = { design }
        const mode = String(args.write_mode || 'confirm').trim().toLowerCase()
        payload.write_mode =
          mode === 'auto' || mode === 'strict' || mode === 'confirm' ? mode : 'confirm'
        if (args.replace_non_center === false) payload.replace_non_center = false
        const res = await postJson('/api/mcp/bulk_seed', payload)
        const body = res.body as { status?: string; auto_applied?: boolean }
        const applied = body?.status === 'applied' || body?.auto_applied === true
        return {
          plugin: 'influence-net',
          httpStatus: res.status,
          result: res.body,
          next: applied
            ? 'Bulk seed auto-applied. Tell the user node/edge counts; do not re-seed via bash/sqlite.'
            : 'Pending bulk seed. Show summary; only call influence_net_apply after explicit confirm.',
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'influence_net_create_net',
      description:
        'Create a blank influence net for a new ticker from the structure template (8 radar dims + center only). Does NOT copy another stock\'s instances. Default activates the new net. Meat is filled later via propose or influence_net_bulk_seed. Do not write SQLite or graph files via bash.',
      parameters: {
        ticker: { type: 'string', description: 'Ticker e.g. 300750 or 300750.SZ' },
        name: { type: 'string', description: 'Optional company display name' },
        activate: { type: 'boolean', description: 'Activate after create (default true)' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const ticker = String(args.ticker || '').trim()
        if (!ticker) return { error: 'ticker required' }
        const payload: Record<string, unknown> = { ticker }
        if (args.name) payload.name = String(args.name)
        if (args.activate === false) payload.activate = false
        const res = await postJson('/api/mcp/create_net', payload)
        return { plugin: 'influence-net', httpStatus: res.status, result: res.body }
      },
    }),
  )


  ctx.tools.register(
    defineTool({
      name: 'influence_net_load_example',
      description:
        'Load bundled demo net into local engine (default: industrial FII 601138). Demo only / 非投资建议.',
      parameters: {
        example_id: {
          type: 'string',
          description: 'Example id (default fii)',
        },
        force: {
          type: 'boolean',
          description: 'Replace if already present',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const payload: Record<string, unknown> = {
          example_id: typeof args.example_id === 'string' && args.example_id ? args.example_id : 'fii',
          force: Boolean(args.force),
          activate: true,
        }
        const res = await postJson('/api/mcp/load_example', payload)
        return { plugin: 'influence-net', httpStatus: res.status, result: res.body }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'influence_net_activate_net',
      description: 'Switch the active influence net by net_id (e.g. net_300750).',
      parameters: {
        net_id: { type: 'string', description: 'net_id from influence_net_list_nets' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const net_id = String(args.net_id || '').trim()
        if (!net_id) return { error: 'net_id required' }
        const res = await postJson(ENGINE_PATH_ACTIVATE, { net_id })
        return { plugin: 'influence-net', httpStatus: res.status, result: res.body }
      },
    }),
  )

}
