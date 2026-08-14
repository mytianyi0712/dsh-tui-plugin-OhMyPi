# 发布 dsh 插件到 GitHub

本项目通过标准 npm package manifest + `dsh.bundle.patch` 声明成为 dsh profile bundle。dsh 没有单独的插件市场提交步骤：用户把包安装到 profile 后，插件管理器会发现 `dsh.bundle.patch`，并自动把包加入 `dsh.profile.bundles`。

## 1. 创建空白仓库

在 GitHub 创建一个公开仓库，例如 `dsh-omp-tui`。建议创建时不要勾选 README、License 或 `.gitignore`，因为本地仓库已经包含这些文件。

仓库 URL 确定后，在本地执行：

```sh
git remote add origin https://github.com/mytianyi0712/dsh-tui-plugin-OhMyPi.git
git branch -M main
git push --set-upstream origin main
```

发布前必须把 `package.json` 中的以下字段补成真实仓库 URL；当前工作区没有 GitHub owner，因此不能安全地替你写入：

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/mytianyi0712/dsh-tui-plugin-OhMyPi.git"
  },
  "homepage": "https://github.com/mytianyi0712/dsh-tui-plugin-OhMyPi#readme",
  "bugs": {
    "url": "https://github.com/mytianyi0712/dsh-tui-plugin-OhMyPi/issues"
  }
}
```

仓库地址已确定；发布前请确认 `package.json` 使用上面的真实 URL。

## 2. GitHub About 与 Topics

DeepSeek Harness 官方 README 明确要求插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic。它是 **GitHub topic，不是 issue label，也不是 package.json 字段**；这是目前已确认的官方发现入口。

在 GitHub 仓库主页的 **About → Edit repository metadata → Topics** 中添加：

### 必须添加

```text
dsh-plugin
```

### 推荐添加

```text
deepseek-harness
deepseek
dsh
terminal-ui
tui
typescript
omp
```

GitHub topic 必须使用小写、数字和连字符，单个 topic 不超过 50 个字符，仓库最多 20 个 topic。不要添加 `oh-my-pi` 作为官方归属暗示；本项目是独立的 dsh bundle，仅采用 OMP 的终端视觉风格。

About 描述建议：

```text
OMP-styled terminal UI profile bundle for DeepSeek Harness (dsh)
```

## 3. 社区与安全设置

建议在仓库公开前完成：

- 开启 Issues；保留 Discussions 作为使用问题和设计讨论渠道。
- 在 **Settings → Security → Security policy** 启用 GitHub Private Vulnerability Reporting。
- 保持 Actions 可运行；本仓库的 release workflow 需要 `contents: write` 来创建 release 和上传 tarball。
- 默认分支使用 `main`，release tag 使用 `v<package.version>`，例如 `v0.1.0`。
- 保护 `main`，至少要求 CI 通过后再合并。

仓库已提供：

- `CONTRIBUTING.md`
- `SECURITY.md`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/pull_request_template.md`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

GitHub 官方建议将贡献指南放在根目录、`docs` 或 `.github`，将安全策略放在 `SECURITY.md` 或 Security 设置生成的位置。

## 4. 首次发布

在发布前确认版本号、兼容的 dsh 版本和 README URL 都已更新：

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run prepare
pnpm pack --dry-run
```

`pnpm pack --dry-run` 应包含：

- `lib/index.js`
- `lib/startup.js`
- `lib/prompt.js`
- `cordis.patch.yml`
- `patches/NOTICE.md`
- `docs/INSTALL.md`
- `LICENSE`

提交并推送版本 tag：

```sh
git add .
git commit -m "chore: prepare v0.1.0 release"
git push origin main
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

`release.yml` 会在 tag 推送后重新安装依赖、跑类型检查和测试、构建 bundle、生成 `dsh-omp-tui-0.1.0.tgz`，并将其作为 GitHub Release asset 上传。用户优先从该 tarball 安装，避免在用户机器执行 Git 依赖构建脚本。

## 5. 后续版本

每次发布都必须同时更新：

1. `package.json` 的 `version`；
2. `CHANGELOG.md`；
3. 需要时的 `docs/contracts.md` 和安装示例；
4. tag `v<version>`。

先在本地运行 `pnpm run check` 和 `pnpm run prepare`，再创建 tag。不要复用已经发布过的版本号；npm 和 GitHub release 都把 name + version 当作不可变发布标识。

## 6. 可选：发布到 npm

GitHub Release 已足够作为 dsh 插件分发渠道。若以后还要发布 npm 包：

```sh
npm login
npm publish --access public
```

`package.json` 已设置 `publishConfig.access = public`。发布前必须确认包名 `dsh-omp-tui` 仍可用、repository/homepage/bugs 已指向真实仓库，并检查 `pnpm pack --dry-run` 内容。

npm 发布不会替代 GitHub 的 `dsh-plugin` topic；topic 仍然是官方 README 指定的插件发现方式。
