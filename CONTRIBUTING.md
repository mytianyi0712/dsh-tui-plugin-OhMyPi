# Contributing to dsh-omp-tui

感谢贡献。这个仓库是 DeepSeek Harness 的独立 profile bundle，修改应保持 dsh harness 合约边界，不直接修改上游 harness 或 turtle-ui。

## 本地环境

- Node.js `^22.19.0` 或 `>=24.0.0`
- pnpm 11
- 支持 truecolor 的终端；UI 调整最好使用 Nerd Font

```sh
pnpm install
pnpm run check
pnpm run prepare
```

`lib/` 是消费者构建产物，由 `prepare` 生成，开发时不直接编辑它。提交前应让源码、测试和 `cordis.patch.yml` 保持一致。

## UI 修改要求

- 先查看相邻组件和 `docs/contracts.md`，复用已有的 palette、`frameBlock` 和 pi-tui 模式。
- 每个可见行为都应有宽度、边界或状态转换测试。
- 完成源码修改后运行 `pnpm run check`、`pnpm run prepare`，再进行一次 `dsh --profile tui` 实机 smoke。
- 不要在同一个变更中顺手改动 dsh 上游接口、持久化格式或未涉及的主题系统。

## Pull request

PR 描述应包含：

1. 变更原因和用户可见行为；
2. 影响的 dsh 版本或合约；
3. 运行过的测试、构建和 smoke 命令；
4. 如果是 UI 变更，附终端截图或可复制的渲染场景。

不要在 issue、日志或截图中提交 API key、session 数据或本地路径以外的敏感信息。
