/** Host half: 影响网 local-engine tools for dsh. */
export { name, inject, apply } from './influence-net.ts'
export {
  ensureLocalEngine,
  isLocalEngineBase,
  isInfluenceEngineHealth,
  parseLocalEngineTarget,
  resolvePackageRoot,
  pingEngineHealth,
} from './ensure-engine.ts'
