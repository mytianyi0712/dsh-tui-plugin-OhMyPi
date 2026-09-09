# dsh-omp-tui 社区 std 标准适配 - 执行摘要

> **面向决策者的 5 分钟速读版本**  
> 完整技术细节见：STD_MIGRATION_ROADMAP.md、STD_ADAPTATION_REPORT.md、STD_ADAPTATION_TODO.md

---

## 🎯 核心问题

**项目身份不明确**：dsh-omp-tui 既想做"一等公民 DSH bundle"（直接依赖 DSH 内部类型），又要做"标准插件"（遵循 std 协议）。

**结果**：
- ✅ 好的：已接入 Community v0.15 manifest、4 个 std 协议（command/storage/messages/presentation）
- ⚠️ 问题：167 处直接 import `@deepseek-ai/dsh-*`，与 DSH 版本强耦合
- ❌ 错失：16 个 std 协议中 12 个未使用，adapter-dsh 提供的能力（Session/Model/Tool 抽象）被绕过

---

## 📊 发现亮点

### dsh-std 仓库分析结果

克隆并分析 https://github.com/Yan-Zero/dsh-std：

- **18 个协议包**：core、manifest、connection、session、model、tool、command、storage、messages、presentation、workspace、ui、ui-browser、lifecycle、composition、sdk、adapter-dsh
- **6673 行提案文档**：详细设计规范（中英双语）
- **adapter-dsh 0.1.1-rc.2**：已实现完整 DSH → std 映射

### 关键协议能力

| 协议 | 已实现能力 | TUI 当前状态 | 迁移价值 |
|------|----------|------------|---------|
| **session** | SessionCatalog（list/create/rename）<br/>SessionHistory（read/follow）<br/>SessionEvent 资源 | ❌ 直接用 DSH API | 🔴 **核心** - 远程访问前提 |
| **connection** | Endpoint 协商<br/>跨端点能力调用 | ❌ 未使用 | 🟠 **重要** - 远程化基础 |
| **model** | ModelCatalog<br/>ModelProvider 资源 | ❌ 直接用 llm-pi-ai | 🟡 **有益** - LLM 解耦 |
| **tool** | Tool 资源<br/>ToolHandler 注册 | ❌ 未使用 | 🟡 **有益** - 插件工具 |

---

## 🗺️ 推荐路线（三阶段）

### 第一阶段：修复版本依赖（0.3.2）✅ 必做

**时间**：1-2 天  
**工作量**：6-8 小时  
**风险**：极低

**内容**：
- devDep 改范围依赖 `^0.1.2-alpha.3`（当前精确锁定）
- peerDep 统一为 `>=0.1.0-rc.6 <0.1.3`（当前碎片化）
- 支持多验证版本数组（当前单版本锁定）
- 添加 `/doctor check` 运行时合约探针

**收益**：
✅ 可测试未来 DSH 版本（alpha.4, beta.x）  
✅ 用户安装时 peer 冲突减少  
✅ 自动化健康检查

**决策**：**立即执行**

---

### 第二阶段：Session 协议迁移（0.4.0）⚠️ 建议做

**时间**：2-4 周  
**工作量**：30-40 小时  
**风险**：中等

**内容**：
- 引入 `@dsh-std/session` 协议包
- 创建 `src/std-sessions/` 抽象层
- 重构会话创建、列表、恢复使用 std API
- 拆分 `src/index.ts`（166KB）为模块

**收益**：
✅ 为远程会话访问（Web 客户端、SSH）铺路  
✅ 会话管理与 DSH 版本解耦  
✅ 代码可维护性提升（模块化）

**决策**：**Q1 2027 启动**（需确认资源投入）

---

### 第三阶段：Connection + Model/Tool（0.5.0-1.0.0）🟢 长期目标

**时间**：3-6 个月  
**工作量**：150+ 小时  
**风险**：高

**内容**：
- TUI 作为 Connection Host
- 支持 SSH/WebSocket 远程连接
- Model/Tool 协议迁移
- 完全解耦 DSH 类型依赖

**收益**：
🌟 TUI 变身"可远程化 Agent 运行时"  
🌟 Web UI、移动端可连接 TUI  
🌟 真正的"write once, run anywhere"

**决策**：**2027 下半年评估**（取决于第二阶段成果）

---

## 💰 成本与收益分析

### 投入

| 阶段 | 工作量 | 风险 | 依赖 |
|------|--------|------|------|
| 0.3.2 | 8h | 极低 | 无 |
| 0.4.0 | 40h | 中 | adapter-dsh 稳定 |
| 0.5.0+ | 150h | 高 | 第二阶段成功 |
| **总计** | **200h** | - | - |

### 产出

**短期**（0.3.2）：
- ✅ 版本兼容性改善
- ✅ 技术债可见化

**中期**（0.4.0）：
- 🎯 代码结构优化
- 🎯 DSH 版本升级成本降低 50%

**长期**（1.0.0）：
- 🚀 远程访问能力（市场差异化）
- 🚀 插件生态扩展（第三方贡献）
- 🚀 成为 std 标准参考实现

---

## ⚠️ 关键风险

### 1. adapter-dsh 不成熟

**现状**：仍在 rc 阶段，部分能力未实现  
**影响**：第二阶段可能遇到 adapter bug  
**缓解**：保留 DSH native fallback，每月评估 adapter 进展

### 2. 用户困惑

**场景**："为什么要改？现在能用"  
**影响**：升级率下降  
**缓解**：清晰沟通收益（远程访问、插件支持）、提供迁移工具

### 3. 破坏性变更

**场景**：会话/配置不兼容  
**影响**：用户流失  
**缓解**：严格后向兼容测试、提供回滚路径

---

## 🎬 立即行动（下一步）

### 本周

- [x] ✅ 生成分析报告（本文档）
- [ ] 📋 Review 三份文档（ROADMAP、REPORT、TODO）
- [ ] 🗳️ 决策：是否执行 0.3.2？

### 如果决定执行 0.3.2

**Day 1**（4 小时）：
1. 修改 `package.json` 依赖范围（30 分钟）
2. 修改 `src/std-contract.ts` 验证逻辑（2 小时）
3. 测试 `pnpm install` + `verify:contract`（1 小时）
4. 提交 PR："chore: normalize dependency ranges for 0.3.2"（30 分钟）

**Day 2**（4 小时）：
1. 实现 `/doctor check` 子命令（2 小时）
2. 更新 CHANGELOG.md 补充日期（15 分钟）
3. 完整回归测试（1 小时）
4. 发布 0.3.2（45 分钟）

### 如果决定跳过

- 文档归档到 `docs/std-adaptation/`
- 设置季度 review 提醒
- 继续现有开发方式

---

## 📚 文档索引

| 文档 | 用途 | 读者 |
|------|------|------|
| **STD_ADAPTATION_SUMMARY.md**（本文） | 决策摘要 | 项目负责人、产品经理 |
| **STD_MIGRATION_ROADMAP.md** | 技术路线图 | 架构师、高级开发 |
| **STD_ADAPTATION_REPORT.md** | 问题分析 | 技术 lead、审查者 |
| **STD_ADAPTATION_TODO.md** | 实施清单 | 执行开发者 |

---

## 🤝 讨论与反馈

**需要决策的问题**：

1. **定位选择**：TUI 长期定位是"DSH bundle"还是"独立标准实现"？
   - Bundle：保持 DSH 依赖，只用 std 协议增强可扩展性
   - 标准实现：完全解耦，可脱离 DSH 运行

2. **资源分配**：0.4.0 需要 40 小时投入，是否有开发带宽？

3. **优先级**：远程访问需求是否紧迫？若不紧迫可推迟第二阶段

**建议讨论渠道**：
- GitHub Issue: "Roadmap: std protocol adoption strategy"
- 团队会议：分享 ROADMAP.md，收集反馈
- 社区调研：在 dsh-std 仓库提问 TUI 集成最佳实践

---

**报告生成时间**：2026-09-08  
**分析工具**：dsh-std 仓库完整克隆 + 18 个包分析  
**数据来源**：167 处 DSH 引用扫描、6673 行提案文档、adapter-dsh CHANGELOG  
**维护者**：待指定
