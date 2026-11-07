# 影响网 — 独立开源切片状态

asof: 2026-11-07 Asia/Shanghai

## 本切片已完成
- 新建 `/Users/ruska/projects/influence-net`，与 Influence Lab **运行时无关**
- 从 Lab / 旧插件 **复制并改名** 引擎 + dsh 插件
- 本地引擎：`~/.influence-net/nets/` + HTTP `:18765`
- `load_example`（工业富联脱敏 seed）+ 空库自动装示例
- `create_net` 空八维壳；MCP propose/apply/bulk_seed/reject 路径保留
- 插件 tools 前缀 `influence_net_*`；默认 `INFLUENCE_NET_URL` / `:18765`
- README + 本 STATUS；本地 git 可 init（未推远程）

## 上架 Plugin Hub / GitHub 前 TODO
- [ ] 选定 LICENSE（MIT/Apache）与中英文市场文案、截图
- [ ] 再扫一遍密钥/本机绝对路径/私有会话残留（cordis.yml 现含本机绝对路径，发布前改相对或安装说明）
- [ ] cordis / package 元数据对齐 [DSH Plugin Hub](https://dshpluginhub.ai/plugins) 规范
- [ ] 插件安装体验：一键启引擎（sidecar）或安装文档里的双进程说明打磨
- [ ] `lib/client.js` 发版构建产物策略（是否提交构建结果）
- [ ] CI：pytest + vitest；示例加载回归
- [ ] 证据档 / write_mode 对终端用户的说明页
- [ ] 去掉组件文件名里遗留的 `InfluenceLab*`（可选纯清理）
- [ ] 明确「与 Lab 无关」的对外 FAQ

## 明确不做（本切片）
- 不改 Lab 仓行为、不发布到 GitHub/Hub、不做视觉去 AI 味

## 测试（本切片）
- engine pytest: **5 passed** (`tests/engine`)
- plugin vitest (logic suite): **27 passed** / 6 files
- plugin vitest full (tsx/React): not required this slice; needs dsh react aliases + `bundle:client`
- HTTP smoke: health + abstract graph OK on :random with temp `INFLUENCE_NET_HOME`
