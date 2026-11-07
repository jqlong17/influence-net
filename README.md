# 影响网 / influence-net

面向 **A 股** 的影响分析 dsh 插件：用自然语言把调研不断累积进「影响网」（八维雷达 × 近中远），右侧栏看关系网 / 雷达维。

**本仓库与 Influence Lab 无关。** 引擎与 SQLite 都在本项目内；运行时数据落在本机 `~/.influence-net/`。

> 非投资建议。内置工业富联示例仅为产品演示。

## 架构

```
dsh 插件 (src/)  --HTTP-->  本地引擎 (engine/)  --SQLite-->  ~/.influence-net/nets/<net_id>/
                              ↑
                     data/examples/fii-601138/  (bundled demo seed)
```

- 插件：dsh tools + 右侧栏画布（不直写库）
- 引擎：stdlib Python HTTP（默认 `http://127.0.0.1:18765`）
- 用户数据：`INFLUENCE_NET_HOME` 可覆盖，默认 `~/.influence-net`

## 快速开始

### 1. 启引擎

```bash
cd /Users/ruska/projects/influence-net
./engine/run.sh
# 或: cd engine && PYTHONPATH=. python3 -m app.server --port 18765
```

空库时会自动装入 **工业富联（601138）** 示例网。

### 2. 在 dsh 里加载插件

```bash
cd /Users/ruska/projects/deepseek-harness
dsh --patch /Users/ruska/projects/influence-net/cordis.yml
```

改了 `src/client/**` 后需重建：

```bash
cd /Users/ruska/projects/influence-net
DSH_ROOT=/Users/ruska/projects/deepseek-harness npm run bundle:client
```

### 3. 使用

1. 打开会话右侧栏 → **影响网**
2. 切换 **关系网 / 雷达维**，点节点看详情
3. 对话里用工具写入：`influence_net_propose` → 确认后 `influence_net_apply`；新票 `influence_net_create_net`；重载示例 `influence_net_load_example`

可选环境变量：`INFLUENCE_NET_URL`（默认 `http://127.0.0.1:18765`）。

## 示例网

见 `data/examples/fii-601138/`。标记 `demo: true`，已脱敏（无本机路径/私有会话）。

## 测试

```bash
# 引擎（stdlib + pytest）
cd /Users/ruska/projects/influence-net/engine
PYTHONPATH=. python3 -m pytest ../tests/engine -q

# 插件单测（需能解析 dsh 侧 react；见 vitest.config.ts）
DSH_ROOT=/Users/ruska/projects/deepseek-harness npx vitest run
```

## License / 声明

开源上架前请补全 LICENSE。产品与示例 **不构成投资建议**。
