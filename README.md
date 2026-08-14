# dsh-omp-tui

## 重要提示！
** 本项目尚处于早期开发测试阶段，目前项目文档由ai完成，后续功能开发完全后会重新编写readme以增强可读性 **

OMP 风格的 DeepSeek Harness（dsh）终端界面——一个独立的 profile bundle（插件）。
当前视觉基线是本机 `omp v17.2.15` 的实际配置：`dark-catppuccin`、Nerd Font
符号与 minimal/powerline 状态栏，而不是早期实现中误认的 Tokyo Night/titanium 配色。

已适配的主要结构：响应式双栏欢迎页、无边框全宽用户消息、带来源标题与独立边框的
注入上下文卡、无角色标题的助手正文、斜体弱化思考文本、OMP 三字符标题帽工具卡、
`Output` 分隔栏，以及嵌入编辑器横线的左右状态段。

```
╭─── dsh ─────────────────────────────────────────────────────────╮
│        Welcome back!        │ Tips                               │
│          D S H              │ / for commands                     │
│      deepseek-v4-pro        │ Session / Workspace                │
╰─────────────────────────────┴────────────────────────────────────╯
───  D:\Projects\dsh   main ─────── 󰚩 deepseek-v4-pro  ↑0 ↓0 ───

 Read: Reading theme implementation

╭─── • Read: Reading theme implementation ────────────────────────╮
├─── Output ───────────────────────────────────────────────────────┤
│ src/theme.ts                                                     │
╰──────────────────────────────────────────────────────────────────╯
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

发布版、GitHub tag、升级、卸载和本地开发的完整说明见
[`docs/INSTALL.md`](docs/INSTALL.md)。GitHub 发布前的仓库配置、`dsh-plugin` topic、
Release tarball 和 CI 说明见 [`docs/PUBLISHING.md`](docs/PUBLISHING.md)。

快速安装当前 GitHub Release tarball：

```sh
npm install --global pnpm@11.7.0
npx --yes @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile tui add \
  https://github.com/mytianyi0712/dsh-tui-plugin-OhMyPi/releases/download/v0.1.0/dsh-omp-tui-0.1.0.tgz
npx --yes @deepseek-ai/dsh@0.1.0-rc.6 --profile tui
```

从 GitHub tag 安装时，需要显式允许 Git 依赖执行构建：

```sh
npx --yes @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile tui add \
  --allow-build=dsh-omp-tui github:mytianyi0712/dsh-tui-plugin-OhMyPi#v0.1.0
```

本地开发仍可使用 `link:`；先运行 `pnpm install && pnpm run prepare`，再执行：

```sh
dsh plugin --profile tui add link:/path/to/dsh-omp-tui
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

### 让裸 `dsh` 默认进 TUI

dsh 启动器硬性要求 `--profile`（只有 `web`/`plugin` 是内建子命令），没有默认
profile 机制。仓库提供了包装脚本，把裸 `dsh`（或任何非 launcher 参数调用）
注入 `--profile tui`，`web`/`plugin`/`--profile`/`--patch`/`--dump*`/帮助/版本
原样透传：

```sh
# Git Bash / zsh
export PATH="$HOME/dsh-omp-tui/scripts:$PATH"   # 或 alias dsh=<仓库>/scripts/dsh
dsh                                   # → dsh --profile tui
dsh --resume <id>                     # → dsh --profile tui --resume <id>
dsh web --port 8080                   # 透传，照常启动官方 web

# cmd / PowerShell：把 scripts 目录加进 PATH，或直接用 scripts\dsh.cmd
```

后端解析顺序：`DSH_REAL`（显式可执行文件）→ PATH 上的全局 `dsh`（跳过包装器
自身目录）→ 全局安装的 `@deepseek-ai/dsh` → `npx --yes @deepseek-ai/dsh`。
可选加速：`npm i -g @deepseek-ai/dsh@0.1.0-rc.6`，之后包装器直连全局二进制。
排障：`DSH_DEBUG=1 dsh` 打印解析后的真实命令行。

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
