# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| `0.2.x` | Yes |
| Older versions | No |

该插件运行在 dsh profile 中，并可能接触 dsh 为当前 workspace 提供的文件、命令和模型服务。请将插件 release tag 视为需要审查和固定的供应链输入。

## Reporting a vulnerability

请使用 GitHub 仓库 **Security → Report a vulnerability** 的 Private Vulnerability Reporting，不要创建公开 issue 发布可利用细节。

报告应包含：

- 受影响的插件版本和 dsh 版本；
- 操作系统、Node.js 和 pnpm 版本；
- 最小复现步骤或概念验证；
- 影响范围，以及是否需要特定 profile 配置或权限。

在仓库设置中启用 GitHub Private Vulnerability Reporting 后，GitHub 会将报告限制在维护者和报告者之间。普通 UI 问题、崩溃和兼容性问题请使用公开 issue，并移除 API key、session 内容和用户目录中的敏感数据。
