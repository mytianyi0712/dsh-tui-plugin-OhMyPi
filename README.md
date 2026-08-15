# dsh-omp-tui

## 重要提示！
- 本项目尚处于早期开发测试阶段，目前项目文档由ai完成，后续功能开发完全后会重新编写readme以增强可读性

OMP 风格的 DeepSeek Harness（dsh）终端界面——一个独立的 profile bundle（插件）。
当前视觉基线是本机 `omp v17.2.15` 的实际配置：`dark-catppuccin`、Nerd Font
符号与 minimal/powerline 状态栏，而不是早期实现中误认的 Tokyo Night/titanium 配色。

已适配的主要结构：响应式双栏欢迎页、无边框全宽用户消息、带来源标题与独立边框的
注入上下文卡、无角色标题的助手正文、斜体弱化思考文本、OMP 三字符标题帽工具卡、
`Output` 分隔栏，以及 Powerline「模式/目录/Git」顶栏 + 「模型 · 思考等级 · ctx
占用」底栏的输入框。

```
╭─── dsh ─────────────────────────────────────────────────────────╮
│        Welcome back!        │ Tips                               │
│          D S H              │ / for commands                     │
│      deepseek-v4-pro        │ Session / Workspace                │
╰─────────────────────────────┴────────────────────────────────────╯
 ─── 标准   D:\Projects\dsh   main ─────────────────────────────────── 

 ────────────────────────────────────────────────────────────────────────── 
  deepseek-v4-flash · max · ctx 100k/1m · workspace-write

 Read: Reading theme implementation

╭─── • Read: Reading theme implementation ────────────────────────╮
├─── Output ───────────────────────────────────────────────────────┤
│ src/theme.ts                                                     │
╰──────────────────────────────────────────────────────────────────╯
```

状态栏中的模型、思考等级和上下文用量均来自当前运行时与会话计量；上图数值仅用于
展示格式。新会话默认使用 `deepseek-v4-flash · max`；历史会话恢复最后一个真实
`request/header` 的模型与思考等级。上下文显示「预估已用/模型容量」，无法解析
模型容量或估算输入时回退为 `ctx 0/1m`。
窄终端会优先保留完整的模式、工作目录和 Git 段；空间不足时切换为紧凑模式名与目录名，
再按优先级隐藏目录或截短模式/分支，分隔符始终按完整状态段重建，不会留下孤立的 Powerline
箭头。页脚在空间不足时优先保留 `ctx` 与权限状态。

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
| `Ctrl+C` | 中断当前回合（流式内容保留）；再次按下（2 秒内）退出程序 |
| `Ctrl+O` | 工具卡折叠循环：collapsed → expanded → hidden |
| `Ctrl+R` | 显示/隐藏思考块 |
| `Tab` / `@` / 路径 / 命令空格 | 斜杠命令、参数选项、`@` 引用与文件路径补全 |

| 命令 | 作用 |
|---|---|
| `/model` | 选择 provider / model / reasoning effort（持久化到 settings） |
| `/think [level]` | 切换当前模型的思考等级；无参按模型声明顺序循环，输入空格后显示可用等级 |
| `/new` | 在当前项目、模型和工作模式下新建会话 |
| `/resume [id]` | 进程内切换会话（无参仅列出当前项目的持久化会话；显式 ID 也会校验项目归属） |
| `/details` | 会话诊断卡（标题/目录/模型/agent/tokens/context） |
| `/skills`、`/skill:<name>` | 技能列表与调用 |
| `/mode [preset]` | 切换后端 agent 组合（官方四预设 + `~/.dsh/.agent-presets` 下安装的预设）；无参循环，输入空格后显示选项 |
| `/permission [preset]` | 切换权限模式；输入空格后显示当前部署可用的权限预设与说明 |
| `/theme [name]` | 查看可用主题或切换主题 |
| `/settings` | 打开可视化设置（主题、标题模型） |
| `/help` | 快捷键与命令列表（随 locale 本地化） |

`@[label](dsh-session:<id>)` 提及会把目标会话的模型可见快照注入当前会话
（`ctx.sessionReferenceResolver`），模型首步即可读到。

新建但未产生用户消息、助手消息或工具调用的空白会话不会落库，也不会出现在
`/resume` 列表中。首次提交对话时才会物化会话日志。

## 主题、模式与本地化

所有外观设置都由 `tui` 行的配置驱动（在 profile 的 `cordis.patch.yml` 中按
`id: tui` 覆盖，或经 dsh settings 注入）。运行中可用 `/mode`、`/think`、`/theme`
临时切换；`/think` 与 `/model` 使用同一模型选择设置并在后续会话中保留，存在官方
settings provider 时，`/theme` 与 `/settings` 的主题选择会写入
`$DSH_HOME/settings.yaml`，重启后保留。

`/settings` 提供可扩展的选择器入口：当前包含主题和标题模型两项。标题模型
设置写入 `session-title` 分区；新会话首条用户消息会先生成确定性短标题，再在
后台用所选模型异步改写，模型失败时保留短标题。

```yaml
- id: tui
  config:
    mode: standard           # 任意已发现预设 id：官方四值或本地安装的预设
    locale: zh-CN            # zh-CN（默认）| en
    defaultReasoningEffort: max # 新会话默认思考强度
    theme:
      name: catppuccin       # catppuccin（默认）| tokyo-night
      custom:                # 可选：逐角色覆盖 truecolor
        accent: [255, 100, 100]
        userMessageBg: [24, 24, 37]
```

- **本地预设**：`/mode` 从 dsh 预设注册表动态发现预设——官方四个
  `standard`/`minimal`/`code`/`cordis` 之外，`$DSH_HOME/.agent-presets` 下安装的
  任意预设（目录名即 id，需含 `agent.cordis.yml` 与可选 `preset.yml`）都会自动
  进入 `/mode` 的无参循环与空格补全，并显示其元数据名称与描述。`mode` 配置项
  也可直接写本地预设 id 作为启动默认。损坏的预设不会进入循环与补全，但仍会
  在注册表中报告原因。
- **权限模式**：`/permission` 管理沙箱与审批策略组合。dsh 默认提供
  `read-only`（只读）、`workspace-write`（工作区写入）和
  `full-access`（完全访问，不请求审批）；进入该模式时启动会弹出提醒，并以当前主题
  的强调色显著标识。具体选项以当前部署的权限预设表为准，
  自定义 preset 也会自动出现在命令提示与补全中。

- **主题**：内置 `catppuccin`（OMP 17.2.15 当前主题）与 `tokyo-night`。
  `theme.custom` 可按角色名覆盖任意颜色（前景/背景均支持，值取 RGB 三元组）；
  非法角色名与畸形值会被静默忽略。`/theme` 列出主题，`/palette` 查看当前
  角色的实际颜色。
- **模式**：切换 **dsh 后端的 agent 组合**（官方 shipped presets），不改外观：
  - `standard` 标准模式：完整编码 Agent（文件编辑、Shell、网页检索、Skills、计划、目标、子代理、工作流）
  - `minimal` 极简模式：固定极简 system prompt，仅持久 bash + `str_replace_editor` 两个工具
  - `code` PTC 模式：标准全部能力 + Code Mode SDK（模型用 TypeScript 程序组合多步操作）
  - `cordis` 创造模式：标准全部能力 + 运行时检查与 preset 创作指导（用于创建自定义 Agent preset）
  
  切换仅对空白会话生效（官方规则：中途换组合会让已记录的工具调用失去对应 schema），
  切换结果以 `agent-preset/selected` 事件写入会话日志，恢复会话时自动沿用；
  `mode` 配置决定新会话的初始组合。`/mode` 无参时按顺序循环切换。
- **本地化**：`locale` 选择 UI 语言，当前内置 `zh-CN` 与 `en`；新增语言只需
  在 `src/i18n.ts` 的字典中添加同键集合的翻译（测试强制键集合一致）。

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
