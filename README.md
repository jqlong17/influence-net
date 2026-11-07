# 影响网 / influence-net

面向 A 股的影响分析 [dsh](https://dshpluginhub.ai) 插件：用自然语言把调研累积进「影响网」（八维雷达 × 近中远），在右侧栏查看关系网与雷达维。

> 非投资建议。仓库内工业富联示例仅供演示。

## 它做什么

- 本地引擎保存影响网（SQLite，默认 `~/.influence-net/`）
- dsh 对话里用工具提出 / 确认写入（`influence_net_propose` → `influence_net_apply`）
- 右侧栏画布：关系网、雷达维、近中远筛选与节点详情

## 架构

```
dsh 插件 (src/)  --HTTP-->  本地引擎 (engine/)  --SQLite-->  ~/.influence-net/nets/<net_id>/
                              ↑
                     data/examples/fii-601138/
```

默认引擎地址：`http://127.0.0.1:18765`（可用 `INFLUENCE_NET_URL` / `INFLUENCE_NET_HOME` 覆盖）。

## 前置

已安装并可运行的 **dsh**。

## 快速开始

### 1. 克隆并启动引擎

```bash
git clone https://github.com/jqlong17/influence-net.git
cd influence-net
./engine/run.sh
```

首次空库会自动装入工业富联（601138）示例网。

### 2. 在 dsh 中加载插件

```bash
dsh --patch /path/to/influence-net/cordis.yml
```

若改动了 `src/client/**`，先重建前端包（`DSH_ROOT` 指向 dsh 安装根目录）：

```bash
DSH_ROOT=/path/to/deepseek-harness npm run bundle:client
```

### 3. 使用

1. 打开会话右侧栏 → **影响网**
2. 切换关系网 / 雷达维，点选节点查看详情
3. 常用工具：`influence_net_propose`、`influence_net_apply`、`influence_net_create_net`、`influence_net_load_example`

## 示例数据

`data/examples/fii-601138/` — 工业富联演示网，可用 `influence_net_load_example` 重新装入。

## 测试

```bash
# 引擎
cd engine && PYTHONPATH=. python3 -m pytest ../tests/engine -q

# 插件（需本机 dsh，设置 DSH_ROOT）
DSH_ROOT=/path/to/deepseek-harness npx vitest run
```

## License

MIT
