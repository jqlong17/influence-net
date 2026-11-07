/** Lab HTTP helpers for the sidebar panel. Read graph/structure/nets; activate net only (no MCP write). */

import {
  ENGINE_ACTIVATE_PATH,
  ENGINE_PATH_GRAPH,
  ENGINE_PATH_HEALTH,
  ENGINE_PATH_NETS,
  ENGINE_PATH_STRUCTURE,
  ENGINE_READ_PATHS,
} from '../engine-paths.ts'

export {
  ENGINE_ACTIVATE_PATH,
  ENGINE_READ_PATHS,
  ENGINE_ACTIVATE_PATH as LAB_ACTIVATE_PATH,
  ENGINE_READ_PATHS as LAB_READ_PATHS,
}

export type EngineBase = string

export type EngineGraphView = 'instance' | 'abstract'

export interface GraphQuery {
  view: EngineGraphView
  dimension?: string | null
  horizon?: string | null
}

async function getJson(base: EngineBase, path: string): Promise<unknown> {
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, { method: 'GET' })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return { ok: res.ok, status: res.status, body: text }
  }
}

export function fetchGraph(base: EngineBase, view: EngineGraphView): Promise<unknown> {
  return getJson(base, `${ENGINE_PATH_GRAPH}?view=${view}`)
}

/** Graph with optional dimension / horizon filters (matches Lab wireframe). */
export function fetchGraphFiltered(base: EngineBase, q: GraphQuery): Promise<unknown> {
  const params = new URLSearchParams()
  params.set('view', q.view)
  if (q.dimension) params.set('dimension', q.dimension)
  if (q.horizon) params.set('horizon', q.horizon)
  return getJson(base, `${ENGINE_PATH_GRAPH}?${params.toString()}`)
}

export function fetchHealth(base: EngineBase): Promise<unknown> {
  return getJson(base, ENGINE_PATH_HEALTH)
}

export function fetchNets(base: EngineBase): Promise<unknown> {
  return getJson(base, ENGINE_PATH_NETS)
}

export function fetchStructure(base: EngineBase): Promise<unknown> {
  return getJson(base, ENGINE_PATH_STRUCTURE)
}

/** Switch Lab active net. POST only this path — never MCP apply/propose. */
export async function activateNet(base: EngineBase, netId: string): Promise<unknown> {
  const res = await fetch(`${base.replace(/\/$/, '')}${ENGINE_ACTIVATE_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ net_id: netId }),
  })
  const text = await res.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    data = { ok: res.ok, status: res.status, body: text }
  }
  if (!res.ok) {
    const err = new Error(
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error: unknown }).error)
        : `activate → ${res.status}`,
    )
    throw err
  }
  return data
}

export type LabBase = EngineBase
export type LabGraphView = EngineGraphView
