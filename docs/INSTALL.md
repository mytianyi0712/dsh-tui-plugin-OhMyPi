# dsh-omp-tui 安装与升级

本项目是 dsh profile bundle，不是独立的 dsh 实现；同时提供 `omdsh` 启动器。bundle 由 dsh profile 加载，启动器则调用系统 PATH 中的官方 `dsh`。

全局安装 tarball 只用于安装 `omdsh` 启动器；它不会单独提供 dsh runtime。

## 全局安装启动器
全局安装本地 tarball 时，包内的 dsh 宿主 peer 依赖已标记为 optional，npm 11 可以继续完成依赖解析，不会因该 peer 图在 Arborist 中触发 `null.children` 崩溃。

```sh
npm install --global ./dsh-omp-tui-0.2.3.tgz
```

随后安装官方 dsh（若尚未安装），再运行启动器：

```sh
npm install --global @deepseek-ai/dsh@0.1.0-rc.8
omdsh
```

如果只安装了 `dsh-omp-tui` 而没有官方 `dsh`，运行 `omdsh` 时出现 `dsh is not recognized` 是预期错误；请先安装上面的官方 dsh。插件实际运行仍推荐使用下方的 `dsh plugin ... add`，由 tui profile 提供宿主依赖。

## 兼容性

| 项目 | 要求 |
|---|---|
| Node.js | `^22.19.0` 或 `>=24.0.0` |
| pnpm | `11.7.0` 或兼容的 pnpm 11 |
| dsh | `0.1.0-rc.8` |
| 终端 | 支持 truecolor；Nerd Font 可获得完整图标显示 |

当前 dsh 仍处于 developer preview，升级 dsh 可能包含兼容性破坏变更。首次安装建议固定 dsh 版本和插件 release tag。

## 首选：安装 GitHub Release 资产

发布者会在 GitHub Release 中提供由 `pnpm pack` 生成的 tarball：

```sh
# 没有 pnpm 时，任选其一：
npm install --global pnpm@11.7.0
# 或：corepack enable

npx --yes @deepseek-ai/dsh@0.1.0-rc.8 plugin --profile tui add \
  https://github.com/mytianyi0712/dsh-tui-plugin-OhMyPi/releases/download/v0.2.3/dsh-omp-tui-0.2.3.tgz
```

tarball 已经包含构建后的 `lib/`，安装时不需要在用户机器上编译项目，也不会执行 Git 依赖的 `prepare` 构建流程。

## 直接从 GitHub tag 安装

Release 尚未创建或需要安装某个提交时，可以直接安装 Git 仓库。Git 依赖包含 `prepare` 构建脚本；pnpm 11 默认会阻止依赖构建脚本，因此必须显式允许本项目构建：

```sh
npx --yes @deepseek-ai/dsh@0.1.0-rc.8 plugin --profile tui add \
  --allow-build=dsh-omp-tui \
  github:mytianyi0712/dsh-tui-plugin-OhMyPi#v0.2.3
```

不要省略 `--allow-build=dsh-omp-tui`。如果 pnpm 已打印了 `allowBuilds` 建议，也可以按提示将该精确包名写入 `~/.config/pnpm/rc` 或 profile 的 `pnpm-workspace.yaml` 后重试。

固定 tag 比直接使用 `#main` 安全、可复现；开发测试才使用：

```sh
npx --yes @deepseek-ai/dsh@0.1.0-rc.8 plugin --profile tui add \
  --allow-build=dsh-omp-tui \
  github:mytianyi0712/dsh-tui-plugin-OhMyPi#main
```

## 启动

如果使用 `npx`：

```sh
npx --yes @deepseek-ai/dsh@0.1.0-rc.8 --profile tui
npx --yes @deepseek-ai/dsh@0.1.0-rc.8 --profile tui --resume <session-id>
```

也可以安装 dsh launcher 后直接使用 `dsh`：

```sh
npm install --global @deepseek-ai/dsh@0.1.0-rc.8
dsh --profile tui
```

或者使用本项目自带的 `omdsh` 启动器（它只从系统 PATH 中查找官方 `dsh`，不通过 npx 下载或缓存 dsh）。用 `dsh plugin add` 安装 tgz 后，`omdsh` 会出现在 profile 的 `.bin` 目录。`omdsh` 首次运行时会自动把 `dsh-omp-tui` 安装到 tui profile；之后检测到 profile 内版本低于启动器版本时也会自动更新（可用 `OMDSH_NO_BOOTSTRAP=1` 跳过）：

```sh
# 把 profile 的 .bin 目录加入 PATH（一次性）后：
export PATH="$HOME/.dsh/profiles/tui/node_modules/.bin:$PATH"   # Git Bash / zsh
omdsh
omdsh --resume <session-id>

# Windows PowerShell（一次性）：
$env:PATH = "$HOME\.dsh\profiles\tui\node_modules\.bin;$env:PATH"
omdsh
```

验证 profile 已组合成功：

```sh
dsh --profile tui --dump-config
```

输出中应包含 `dsh-omp-tui` bundle，以及 `dsh-omp-tui/startup`、`dsh-omp-tui/prompt` 和 `dsh-omp-tui` 行。

## 配置模型

官方 DeepSeek API：

```sh
# Git Bash / zsh
export DEEPSEEK_API_KEY='your-key'

# PowerShell
$env:DEEPSEEK_API_KEY = 'your-key'
```

本地 OpenAI-compatible 网关：

```sh
# Git Bash / zsh
export DEEPSEEK_BASE_URL='http://localhost:3000/v1'

# PowerShell
$env:DEEPSEEK_BASE_URL = 'http://localhost:3000/v1'
```

`cordis.patch.yml` 当前默认 agent 为 `deepseek-official/deepseek-v4-flash`。启动后可以用 `/model` 选择并持久化 provider、model 和 reasoning effort。

## 升级

推荐用新的 release tarball 明确切换版本：

```sh
dsh plugin --profile tui add \
  https://github.com/mytianyi0712/dsh-tui-plugin-OhMyPi/releases/download/v0.2.3/dsh-omp-tui-0.2.3.tgz
```

若当前依赖跟踪的是 `main`，可以更新 Git 依赖：

```sh
dsh plugin --profile tui update dsh-omp-tui
```

升级后重新检查：

```sh
dsh --profile tui --dump-config
dsh --profile tui
```

## 卸载

```sh
dsh plugin --profile tui remove dsh-omp-tui
```

这会从 profile 依赖和 `dsh.profile.bundles` 中同时移除该 bundle，不会删除已有 session 数据。

## 本地开发安装

```sh
git clone https://github.com/mytianyi0712/dsh-tui-plugin-OhMyPi.git
cd dsh-tui-plugin-OhMyPi
pnpm install
pnpm run check
pnpm run prepare

# dsh 会把相对路径按调用目录解析；link 适合持续开发
npx --yes @deepseek-ai/dsh@0.1.0-rc.8 plugin --profile tui add link:.
```

修改源码后运行 `pnpm run prepare`，link profile 会立即使用新的 `lib/`。需要模拟发布拷贝时使用：

```sh
npx --yes @deepseek-ai/dsh@0.1.0-rc.8 plugin --profile tui add file:.
```

## 微信桥（WeChat iLink）

本 bundle 同时安装微信桥服务。启动后使用：

```sh
/wechat-login      # 扫码登录
/wechat-pair <码>  # 批准微信配对码
/wechat-status     # 查看桥状态
/wechat-notify on  # 终端任务也推送微信
```

微信里以 `@dsh` 开头的消息为远程命令；普通消息会注入当前 dsh 会话。状态目录为
`~/.dsh/wechat-ilink/`（可用 `DSH_WECHAT_ILINK_STATE` 覆盖）。

## 常见问题

### `pnpm: command not found`

安装 `pnpm@11.7.0`，然后确认 `pnpm --version` 输出为 pnpm 11。

### Git 安装被阻止，提示 `allowBuilds`

重新运行安装命令，并保留：

```sh
--allow-build=dsh-omp-tui
```

Git 安装会从源码执行 `prepare`，这是 pnpm 的供应链保护行为，不是 dsh 运行时错误。

### API 请求失败

确认 `DEEPSEEK_API_KEY` 或 `DEEPSEEK_BASE_URL` 在启动 dsh 的同一个 shell 中可见；本地网关还必须提供兼容 `/v1` 的接口。

### 图标显示为方框

安装并启用 Nerd Font，然后重启终端。布局和功能不依赖 Nerd Font，但图标会回退为方框或普通字符。

### Windows 路径

PowerShell 使用上面的 `$env:...` 语法；Git Bash 可直接运行 `npx`、`pnpm` 和 dsh 命令。路径包含空格时用引号包住完整路径。


