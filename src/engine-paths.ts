/** Single source of local-engine HTTP path literals for host + client. */
export const ENGINE_DEFAULT_BASE = 'http://127.0.0.1:18765'

export const ENGINE_PATH_HEALTH = '/api/health'
export const ENGINE_PATH_GRAPH = '/api/graph'
export const ENGINE_PATH_NETS = '/api/nets'
export const ENGINE_PATH_STRUCTURE = '/api/structure'
export const ENGINE_PATH_ACTIVATE = '/api/nets/activate'
export const ENGINE_PATH_LOAD_EXAMPLE = '/api/mcp/load_example'

export const ENGINE_READ_PATHS = [
  ENGINE_PATH_HEALTH,
  ENGINE_PATH_GRAPH,
  ENGINE_PATH_NETS,
  ENGINE_PATH_STRUCTURE,
] as const

export const ENGINE_ACTIVATE_PATH = ENGINE_PATH_ACTIVATE

/** @deprecated alias — prefer ENGINE_* */
export const LAB_DEFAULT_BASE = ENGINE_DEFAULT_BASE
export const LAB_PATH_HEALTH = ENGINE_PATH_HEALTH
export const LAB_PATH_GRAPH = ENGINE_PATH_GRAPH
export const LAB_PATH_NETS = ENGINE_PATH_NETS
export const LAB_PATH_STRUCTURE = ENGINE_PATH_STRUCTURE
export const LAB_PATH_ACTIVATE = ENGINE_PATH_ACTIVATE
export const LAB_READ_PATHS = ENGINE_READ_PATHS
export const LAB_ACTIVATE_PATH = ENGINE_ACTIVATE_PATH
