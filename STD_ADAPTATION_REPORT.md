# dsh-omp-tui 0.3.2 社区 std 标准适配报告

## 概述

本报告系统性评估 dsh-omp-tui 项目与社区 std 标准的兼容性，识别所有不符合项，区分简单迁移与复杂重构，并检查硬编码版本依赖。

### 当前状态

- **项目版本**: 0.3.1
- **目标版本**: 0.3.2
- **std 规范**: Community v0.15 (dsh-ecosystem-spec)
- **dsh harness**: 0.1.2-alpha.3 (devDep pinned)
- **std adapter**: @dsh-std/adapter-dsh 0.1.1-rc.2
- **std 协议包**: @dsh-std/core, manifest, messages, command, storage, presentation (0.1.1-rc.1/rc.2)

---

## 一、硬编码版本依赖清单

### 1.1 已识别的硬编码版本引用

| 位置 | 版本字面量 | 类型 | 风险 |
|------|-----------|------|------|
| `src/std-contract.ts:18-20` | `0.1.1-rc.1`, `0.1.1-rc.2` | std 协议包最低版本 | ✅ 低 - 合约门禁使用 |
| `src/std-contract.ts:24` | `0.1.1-rc.2` | adapter 最低版本 | ✅ 低 - 合约门禁使用 |
| `src/std-contract.ts:27` | `^0.1.1-rc.2` | adapter peer 范围 | ⚠️ 中 - 需随 adapter 更新 |
| `src/std-contract.ts:69,71` | `0.1.2-alpha.3` | 验证过的 harness 版本 | ⚠️ 中 - 单版本锁定 |
| `src/index.ts:1286` | `0.1.2-alpha.3` | `/doctor` 显示字符串 | ✅ 低 - 仅展示 |
| `src/session-preset.ts:2,4` | `0.1.1-rc.2`, `0.1.2-alpha.x` | 代码注释 | ✅ 低 - 文档性质 |
| `src/dsh-host/llm.ts:13` | `0.1.1-rc.2`, `alpha.3` | 类型兼容注释 | ✅ 低 - 文档性质 |
| `src/dsh-host/product.ts:22-23` | `alpha.3`, `rc.2` | API 桥接注释 | ✅ 低 - 文档性质 |
| `src/wechat/core/api.ts:15` | `0.1.0` | 微信桥版本号 | ✅ 低 - 独立协议 |
| `package.json:81-106` | 多版本范围 | peer 依赖声明 | ⚠️ 中 - 见下节 |
| `package.json:203-235` | `0.1.2-alpha.3` | devDep 精确锁定 | 🔴 高 - 阻止版本漂移测试 |

### 1.2 package.json 依赖问题

#### 问题 1: devDependencies 全部锁死 alpha.3
```json
"@deepseek-ai/dsh-agent": "0.1.2-alpha.3",
"@deepseek-ai/dsh-llm": "0.1.2-alpha.3",
// ... 所有 23 个 harness 包
```
**影响**: 无法测试对未来 alpha.4/beta/rc 的前向兼容性，无法及时发现破坏性变更。

#### 问题 2: peerDependencies 范围保守
```json
"@deepseek-ai/dsh-session": "^0.1.0-rc.6 || ^0.1.1-rc.1 || ^0.1.2-alpha.2"
```
**问题**: 
- 不支持未来的 `0.1.2-beta.x` / `0.1.2-rc.x`（语义化版本中 beta > alpha）
- 不支持 `0.1.3-alpha.x`（adapter 声明支持 `<0.1.3`）
- 每个新预发布通道都需手动扩展范围

#### 问题 3: @dsh-std/adapter-dsh peer 范围过窄
```json
"@dsh-std/adapter-dsh": "^0.1.1-rc.2"
```
**问题**: 只接受 `0.1.1-rc.2` 到 `<0.1.2.0`，无法使用未来的 `0.1.2-rc.x` adapter。

---

## 二、std 标准不符合项清单

### 2.1 ✅ 简单迁移项（可在 0.3.2 快速完成）

#### M1: devDependencies 版本策略调整
- **当前**: 所有 harness 包锁死 `0.1.2-alpha.3`
- **目标**: 改为范围 `^0.1.2-alpha.3` 允许同通道补丁更新
- **工作量**: 5 分钟
- **风险**: 低 - 仍在 alpha 通道内

#### M2: peerDependencies 范围扩展
- **当前**: `^0.1.0-rc.6 || ^0.1.1-rc.1 || ^0.1.2-alpha.2`
- **目标**: `>=0.1.0-rc.6 <0.1.3` 覆盖所有中间版本
- **工作量**: 10 分钟
- **风险**: 低 - 后向兼容承诺

#### M3: adapter peer 范围更新
- **当前**: `^0.1.1-rc.2`
- **目标**: `>=0.1.1-rc.2 <0.2.0` 接纳 0.1.x 系列所有版本
- **工作量**: 5 分钟
- **风险**: 低 - adapter 承诺 0.1.x 兼容

#### M4: UPSTREAM_VALIDATED_VERSIONS 扩展为数组语义
- **当前**: `['0.1.2-alpha.3']` 单版本，但代码已是数组
- **目标**: 增加 `0.1.2-alpha.2` / 未来 `alpha.4` / `beta.1` 等已验证版本
- **工作量**: 每次新版本验证后追加
- **风险**: 无 - 纯信息性质

#### M5: std 协议包版本声明更新
- **当前**: `@dsh-std/command`, `storage`, `presentation` 在 dependencies 中固定 `0.1.1-rc.1`
- **目标**: 改为范围 `^0.1.1-rc.1` 接受补丁更新
- **工作量**: 5 分钟
- **风险**: 低 - 协议包承诺后向兼容

### 2.2 ⚠️ 中等复杂度项（需要代码重构但逻辑清晰）

#### R1: 版本验证逻辑泛化
- **当前**: `UPSTREAM_VALIDATED_VERSION` 单数形式在多处硬编码使用
- **位置**: `src/std-contract.ts:71`, `src/index.ts:1286`
- **问题**: 代码逻辑未使用 `UPSTREAM_VALIDATED_VERSIONS` 数组
- **工作量**: 2 小时
- **任务**:
  1. 废弃 `UPSTREAM_VALIDATED_VERSION` 单数导出
  2. 修改 `upstreamDriftWarnings()` 检查 `installedVersion` 是否在数组中
  3. `/doctor` 显示格式改为 "verified lines: 0.1.2-alpha.3, 0.1.2-beta.1"
- **风险**: 低 - 纯内部逻辑

#### R2: 跨版本 API 桥接层规范化
- **当前**: `src/dsh-host/product.ts` 手写 rc.2/alpha.3 桥接
- **位置**: `currentPermissionPreset()` 运行时类型检测
- **问题**: 每个 API 破坏性变更都需手写桥接
- **工作量**: 4 小时
- **任务**:
  1. 抽取桥接模式到 `src/dsh-host/version-bridge.ts`
  2. 提供 `detectApiVersion()` / `adaptCall()` 工具函数
  3. 文档化桥接添加流程
- **风险**: 中 - 需覆盖现有场景

#### R3: 协议包运行时合约探针
- **当前**: `verifyContract()` 只在启动时校验，无运行时漂移检测
- **问题**: profile 手动升级协议包后 TUI 未感知
- **工作量**: 3 小时
- **任务**:
  1. `std-contract.ts` 增加 `checkRuntimeDrift()` 可调用版本
  2. `/doctor check` 子命令实时探测当前 node_modules
  3. 启动时 boot notice 仅警告，不阻断
- **风险**: 低 - 纯诊断功能

### 2.3 🔴 复杂重构项（需要架构调整或大规模改动）

#### C1: 移除对 @deepseek-ai/* 类型的直接依赖
- **当前状态**: 
  - `src/dsh-host/*.ts` 大量 import `@deepseek-ai/dsh-session`, `dsh-agent`, `dsh-llm`
  - 类型定义编译时绑定，与 harness 包强耦合
- **std 标准要求**: 
  - 插件应通过 std adapter 消费协议，而非直接依赖 harness 实现
  - `@deepseek-ai/*` 应只在 devDep（类型校验）和 optionalPeer（运行时发现）
- **问题**:
  - TUI 作为 "profile bundle"（一等公民集成）vs "std plugin"（第三方扩展）身份混淆
  - 167 个 harness 类型引用遍布 `src/index.ts` (165KB 巨文件)
- **工作量**: 40+ 小时
- **任务**:
  1. 明确 TUI 定位：是 "std-aware native bundle" 还是 "完全 std plugin"
  2. 若选后者：将 `src/dsh-host/` 改为基于 adapter 导出的抽象接口
  3. 拆分 `src/index.ts` 为模块（UI/Rendering/Commands/Events）
  4. 协议层与 harness 类型解耦
- **风险**: 高 - 触及架构根基，需完整回归测试
- **建议**: **0.3.x 暂不实施**，列入 0.4.0 规划

#### C2: std adapter 版本协商协议
- **当前**: `STD_ADAPTER_MINIMUM` / `STD_ADAPTER_PEER_RANGE` 硬编码在 TUI
- **问题**: 
  - adapter 自己声明 `peerDependencies: {"@deepseek-ai/dsh-*": ">=0.1.2-alpha.2 <0.1.3"}`
  - TUI 重复声明形成双重约束，不一致时用户困惑
  - std 标准未定义 host ↔ adapter 版本协商协议
- **工作量**: 8 小时（需等 std 规范补充）
- **任务**:
  1. 向 dsh-ecosystem-spec 提交 "Adapter-Host Capability Negotiation" 提案
  2. adapter 通过导出 `supportedHarnessRange` / `requiredProtocolVersions` 声明
  3. TUI 启动时读取并校验，降级/拒绝启动
- **风险**: 高 - 需跨项目协调
- **建议**: **0.3.x 不实施**，提交提案后等待规范收敛

#### C3: 彻底移除 UPSTREAM_VALIDATED_VERSION 概念
- **当前**: 单一验证版本 + 漂移警告
- **std 哲学**: 语义化版本承诺 + CI 矩阵测试，不需 "blessed version"
- **问题**: 
  - 社区贡献者用 alpha.4 测试 TUI，看到 "only verified on alpha.3" 警告后放弃
  - 限制了 TUI 在 dsh 各版本线的普及
- **工作量**: 6 小时
- **任务**:
  1. 移除所有 `UPSTREAM_VALIDATED_VERSION*` 常量
  2. `upstreamDriftWarnings()` 改为范围检查：`>=0.1.0-rc.6 <0.1.3`
  3. boot notice 只在 MAJOR 版本不匹配时警告（0.2.x / 1.0.0）
- **风险**: 中 - 语义变化需文档宣传
- **建议**: **0.3.2 可选实施**，配合 M4 一起做

---

## 三、0.3.2 版本实施建议

### 3.1 本次必须完成（简单迁移 M1-M5）

| 任务 | 工作量 | 测试需求 |
|------|--------|----------|
| M1: devDep 改范围 | 5 min | `pnpm install` 无报错 |
| M2: peerDep 范围扩展 | 10 min | 本地 `npm pack` + 全局安装无 peer 冲突 |
| M3: adapter peer 更新 | 5 min | `verify:contract` 通过 |
| M4: VALIDATED_VERSIONS 追加 | 5 min | `/doctor` 正确显示 |
| M5: std 协议包范围 | 5 min | `verify:contract` 通过 |

**总计**: 30 分钟编码 + 15 分钟测试

### 3.2 建议完成（中等复杂度 R1-R3）

| 任务 | 工作量 | 优先级 | 理由 |
|------|--------|--------|------|
| R1: 版本验证泛化 | 2h | P0 | 解除单版本锁定，未来可持续 |
| R3: 运行时合约探针 | 3h | P1 | 增强诊断能力，用户可自查 |
| R2: API 桥接规范化 | 4h | P2 | 技术债，可推迟到首次新增桥接时 |

### 3.3 明确不做（复杂重构 C1-C3）

- **C1**: 需架构重审，放入 0.4.0 Roadmap
- **C2**: 需标准补充，跟踪 dsh-ecosystem-spec 进展
- **C3**: 哲学性变更，需社区讨论

---

## 四、CHANGELOG 草稿（0.3.2）

```markdown
## [0.3.2] - TBD

### 社区 std 标准适配改进

- 依赖版本策略调整：`devDependencies` 中 harness 包改为范围依赖 `^0.1.2-alpha.3` 允许同通道补丁更新，`peerDependencies` 扩展为 `>=0.1.0-rc.6 <0.1.3` 覆盖所有已知兼容版本线
- std adapter peer 范围更新为 `>=0.1.1-rc.2 <0.2.0`，支持未来 0.1.x 系列所有兼容更新
- std 协议包（`@dsh-std/command`, `storage`, `messages`, `presentation`）改为范围依赖 `^0.1.1-rc.1` 接受补丁更新
- 验证版本改为数组支持多版本线：`UPSTREAM_VALIDATED_VERSIONS` 记录所有经过烟雾测试的 harness 版本，`/doctor` 显示完整已验证清单
- 运行时合约探针：`/doctor check` 子命令实时检测当前 profile 中协议包/adapter 版本漂移，启动时仅警告不阻断
- 移除硬编码的 `UPSTREAM_VALIDATED_VERSION` 单版本锁定：合约检查改为范围验证，仅在 MAJOR 版本不匹配时发出警告

### Breaking Changes

无运行时破坏性变更；peer 范围扩展为**放宽约束**。

### 已知限制

- TUI 仍直接依赖 `@deepseek-ai/dsh-*` harness 类型（devDep），未通过 std adapter 抽象接口消费；完全解耦需架构级重构，列入 0.4.0 规划
- adapter 版本协商协议需 dsh-ecosystem-spec 规范补充，当前为手动声明 `STD_ADAPTER_MINIMUM`
```

---

## 五、执行计划

### 阶段 1: 版本声明规范化（30 分钟）

1. 修改 `package.json`:
   - devDependencies: `"@deepseek-ai/dsh-*": "0.1.2-alpha.3"` → `"^0.1.2-alpha.3"`
   - peerDependencies: 统一改为 `">=0.1.0-rc.6 <0.1.3"`
   - `@dsh-std/adapter-dsh` peer: `">=0.1.1-rc.2 <0.2.0"`
   - dependencies: `@dsh-std/*` 改为 `^0.1.1-rc.1` / `^0.1.1-rc.2`

2. 修改 `src/std-contract.ts`:
   - `STD_ADAPTER_PEER_RANGE = '>=0.1.1-rc.2 <0.2.0'`
   - `UPSTREAM_VALIDATED_VERSIONS` 追加已测试版本（若有）

3. 测试:
   ```bash
   pnpm install
   pnpm run verify:contract
   pnpm run build
   ```

### 阶段 2: 验证逻辑泛化（2 小时）

1. 废弃 `UPSTREAM_VALIDATED_VERSION` 导出
2. 修改 `upstreamDriftWarnings()` 使用数组逻辑
3. 更新 `/doctor` 显示多版本
4. 回归测试 `tests/` 中涉及版本检查的用例

### 阶段 3: 运行时探针（3 小时）

1. 实现 `checkRuntimeDrift()`
2. `/doctor check` 集成
3. 文档化使用场景

### 阶段 4: CHANGELOG 定稿 + 发布准备

1. 补充发布日期
2. 回归测试完整 smoke test
3. 更新 README 中依赖说明

---

## 六、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| peer 范围过宽导致未测试版本静默失败 | 中 | 高 | CI 增加 `0.1.2-beta.1` / `0.1.3-alpha.1` 矩阵测试 |
| adapter 0.1.2+ 引入破坏性变更 | 低 | 中 | 监听 adapter 更新日志，发现时追加桥接 |
| 社区用户混淆 TUI 身份（bundle vs plugin） | 中 | 低 | README 明确声明 "std-aware native bundle" |

---

## 七、后续版本规划

### 0.4.0: 架构解耦
- `src/index.ts` 拆分为模块
- 探索基于 adapter 接口的 harness 类型消费
- 完整 ESM 迁移

### 0.5.0: 完全 std 插件化（可选）
- 评估作为纯 std plugin 的可行性
- 若实施：移除所有 `@deepseek-ai/*` 直接依赖

---

**报告生成时间**: 2026-09-08  
**负责人**: TBD  
**审核人**: TBD
