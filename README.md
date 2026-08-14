# dsh-omp-tui

omp 风格的 DeepSeek Harness（dsh）终端界面——一个独立的 profile bundle（插件），
用 `@earendil-works/pi-tui` 实现，样式原生模仿本机 omp 的 titanium 暗色主题：
圆角边框 `╭╮╰╯`、per-status 工具卡背景、`#16161e` 状态行、思考块左竖线。

```
╭─ dsh HARNESS─────────────────────────────────────────────────────╮
│ tui-8f3a…                                                         │
╰───────────────────────────────────────────────────────────────────╯
╭───────────────────────────────────────────────────────────────────╮
│ User                                                              │
│ 用 pwsh 列出当前目录                                               │
╰───────────────────────────────────────────────────────────────────╯
╭─ ○ Tool / pwsh────────────────────────────────────────────────────╮
│ $ { "command": "Get-ChildItem …" }                                │
╰───────────────────────────────────────────────────────────────────╯
Plan
✓ 任务A
○ 任务B
D:\Projects\dsh  deepseek-v4-pro  ↑1.2k ↓300  1% context
 >
```

## 架构

- **定位**：与官方 turtle-ui 平级的"前门" bundle，骑在 `@deepseek-ai/dsh-base` 之上。
  harness 负责 agent/模型/工具/持久化/沙箱；本 bundle 只拥有终端呈现与输入。
- **渲染**：`@earendil-works/pi-tui@0.80.7`（含 vendored pnpm patch，见
  `patches/NOTICE.md`），打包进 `lib/`，消费者无需安装 pi-tui。
- **harness 合约**：`docs/contracts.md` 是唯一真相源（rc.6 逐字类型 + 服务签名 +
  配置行 schema）；上游接口变更时先改该表再改代码。
- **自持仓库**：本仓库无任何上游 remote（非 fork）。唯一 vendor 物是 pi-tui 的
  pnpm patch（BSD-3，attribution 见 `patches/NOTICE.md`）。

## 安装

要求：Node ≥ 22.19、pnpm（corepack）、`dsh` 可用（`npx @deepseek-ai/dsh`）。

```sh
cd /path/to/dsh-omp-tui
pnpm install
pnpm run prepare          # 构建 lib/（消费者构建，无类型检查）

# 本地开发：link 安装，改完 lib/ 立即生效
dsh plugin --profile tui add link:/path/to/dsh-omp-tui

# 或打包安装（拷贝形态，改完需重新 add）
dsh plugin --profile tui add file:/path/to/dsh-omp-tui
```

模型配置走 dsh 的 settings 文档（`~/.dsh/settings.yaml`，热加载）：

```yaml
llm-deepseek:
  baseURL: http://localhost:3000/v1   # 例：本地网关
```

## 使用

```sh
dsh --profile tui                      # 新会话
dsh --profile tui --session my-id      # 显式命名新会话
dsh --profile tui --resume <id>        # 恢复持久化会话
```

| 键 | 作用 |
|---|---|
| `Ctrl+C` | 中断当前回合（流式内容保留） |
| `Ctrl+O` | 工具卡折叠循环：collapsed → expanded → hidden |
| `Ctrl+R` | 显示/隐藏思考块 |
| `Tab` / `@` / 路径 | 斜杠命令、`@` 引用与文件路径补全 |

| 命令 | 作用 |
|---|---|
| `/model` | 选择 provider / model / reasoning effort（持久化到 settings） |
| `/resume [id]` | 进程内切换会话（无参列出持久化会话选择器） |
| `/details` | 会话诊断卡（标题/目录/模型/agent/tokens/context） |
| `/skills`、`/skill:<name>` | 技能列表与调用 |
| `/palette` | 当前角色调色板表 |
| `/help` | 快捷键与命令列表 |

`@[label](dsh-session:<id>)` 提及会把目标会话的模型可见快照注入当前会话
（`ctx.sessionReferenceResolver`），模型首步即可读到。

## 开发

```sh
pnpm install
npx tsc -p tsconfig.json --noEmit   # 类型门（devDeps 固定 rc.6 精确版本）
npm run test                        # node:test + 类型转换模式（Node ≥ 23.6）
pnpm run prepare                    # 消费者构建（tsdown，pi-tui 打入 lib/）
node --experimental-transform-types scripts/perf-probe.ts   # 长会话渲染成本探针
```

测试用 Node 原生 `node:test` 运行 `.ts`（`--experimental-transform-types`），
不依赖兄弟 harness checkout；vitest 4 在本机环境启动挂起，已弃用。

### 上游同步

dsh 处于 rc 阶段（0.1.0-rc.6），接口会变：

1. `docs/contracts.md` 是唯一真相源——服务签名变更先改表；
2. devDependencies 固定到实际安装版本（`0.1.0-rc.6`），升级时先 `pnpm install`
   对齐 npx 缓存里的真实版本，再按新类型修代码；
3. 每轮升级后跑 `npm run test` + 实机 smoke（`dsh --profile tui`）。

## 许可

BSD-3-Clause。`patches/@earendil-works__pi-tui@0.80.7.patch` vendored from
turtle1999/turtle-ui（BSD-3），完整声明见 `patches/NOTICE.md`。
