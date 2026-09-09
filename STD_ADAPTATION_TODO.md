# dsh-omp-tui 0.3.2 std 适配实施清单

> **执行顺序**: 阶段 1 → 阶段 2 → 阶段 3 → 测试 → 发布  
> **预计总工作量**: 6-8 小时  
> **优先级**: 阶段 1 必须完成，阶段 2-3 建议完成

---

## 阶段 1: 版本声明规范化 ✅ 简单迁移（30 分钟）

### 任务 M1: devDependencies 改为范围依赖

**文件**: `package.json`

**当前** (精确锁定):
```json
"@deepseek-ai/dsh-agent": "0.1.2-alpha.3",
"@deepseek-ai/dsh-llm": "0.1.2-alpha.3",
...
```

**目标** (范围依赖):
```json
"@deepseek-ai/dsh-agent": "^0.1.2-alpha.3",
"@deepseek-ai/dsh-llm": "^0.1.2-alpha.3",
...
```

**需要修改的包** (共 23 个):
- @deepseek-ai/cordis
- @deepseek-ai/dsh-agent
- @deepseek-ai/dsh-agent-default-model
- @deepseek-ai/dsh-agent-loop
- @deepseek-ai/dsh-agent-presets
- @deepseek-ai/dsh-cmdline
- @deepseek-ai/dsh-commands
- @deepseek-ai/dsh-compaction
- @deepseek-ai/dsh-goal
- @deepseek-ai/dsh-llm
- @deepseek-ai/dsh-permission-presets
- @deepseek-ai/dsh-session
- @deepseek-ai/dsh-session-persistence
- @deepseek-ai/dsh-session-projection
- @deepseek-ai/dsh-session-query
- @deepseek-ai/dsh-session-reference
- @deepseek-ai/dsh-session-title
- @deepseek-ai/dsh-session-title-llm
- @deepseek-ai/dsh-settings
- @deepseek-ai/dsh-skill
- @deepseek-ai/dsh-system-prompt
- @deepseek-ai/dsh-token-meter
- @deepseek-ai/dsh-tool-todo
- @deepseek-ai/dsh-tools
- @deepseek-ai/dsh-user-questions
- @deepseek-ai/schemastery
- @dsh-std/adapter-dsh

**验证命令**:
```bash
pnpm install
pnpm run build
```

---

### 任务 M2: peerDependencies 范围扩展

**文件**: `package.json`

**当前** (多个 OR 范围):
```json
"@deepseek-ai/dsh-session": "^0.1.0-rc.6 || ^0.1.1-rc.1 || ^0.1.2-alpha.2"
```

**目标** (统一范围):
```json
"@deepseek-ai/dsh-session": ">=0.1.0-rc.6 <0.1.3"
```

**需要修改的包** (共 23 个，与 M1 相同):
- 所有 `@deepseek-ai/dsh-*` peer 依赖
- `@deepseek-ai/cordis`: 保持 `^4.0.2`（框架包 MAJOR 锁定）
- `@deepseek-ai/schemastery`: 保持 `^3.18.1`（框架包 MAJOR 锁定）

**验证命令**:
```bash
npm pack
npm install -g ./dsh-omp-tui-0.3.2.tgz --dry-run
# 检查无 peer 冲突警告
```

---

### 任务 M3: adapter peer 范围更新

**文件**: `package.json`

**当前**:
```json
"@dsh-std/adapter-dsh": "^0.1.1-rc.2"
```

**目标**:
```json
"@dsh-std/adapter-dsh": ">=0.1.1-rc.2 <0.2.0"
```

**同步修改**: `src/std-contract.ts`

```typescript
// 第 27 行
export const STD_ADAPTER_PEER_RANGE = '>=0.1.1-rc.2 <0.2.0'
```

**验证命令**:
```bash
pnpm run verify:contract
```

---

### 任务 M4: UPSTREAM_VALIDATED_VERSIONS 准备数组扩展

**文件**: `src/std-contract.ts`

**当前**:
```typescript
export const UPSTREAM_VALIDATED_VERSIONS: readonly string[] = ['0.1.2-alpha.3']
export const UPSTREAM_VALIDATED_VERSION = '0.1.2-alpha.3'
```

**目标** (保持数组，标记单数为废弃):
```typescript
/** Versions this host has been type- and smoke-verified against. */
export const UPSTREAM_VALIDATED_VERSIONS: readonly string[] = [
  '0.1.2-alpha.2',
  '0.1.2-alpha.3',
]

/** @deprecated Use UPSTREAM_VALIDATED_VERSIONS array. Kept for compatibility. */
export const UPSTREAM_VALIDATED_VERSION = '0.1.2-alpha.3'
```

**验证**: 
- `/doctor` 仍能显示
- 未来新版本测试通过后追加到数组

---

### 任务 M5: std 协议包改为范围依赖

**文件**: `package.json`

**当前** (dependencies 部分):
```json
"@dsh-std/core": "^0.1.1-rc.1",
"@dsh-std/manifest": "^0.1.1-rc.2",
"@dsh-std/messages": "^0.1.1-rc.1",
"@dsh-std/command": "0.1.1-rc.1",    // ← 精确锁定
"@dsh-std/storage": "0.1.1-rc.1",    // ← 精确锁定
"@dsh-std/presentation": "0.1.1-rc.1" // ← 精确锁定
```

**目标**:
```json
"@dsh-std/command": "^0.1.1-rc.1",
"@dsh-std/storage": "^0.1.1-rc.1",
"@dsh-std/presentation": "^0.1.1-rc.1"
```

**验证命令**:
```bash
pnpm install
pnpm run verify:contract
```

---

### 阶段 1 完成检查

- [ ] `package.json` 中所有 27 个 devDep 包前缀 `^`
- [ ] `package.json` 中所有 23 个 peerDep 使用 `>=x.x.x <0.1.3` 范围
- [ ] adapter peer 改为 `>=0.1.1-rc.2 <0.2.0`
- [ ] std 协议包 3 个改为 `^` 前缀
- [ ] `src/std-contract.ts` 中 `STD_ADAPTER_PEER_RANGE` 同步更新
- [ ] `UPSTREAM_VALIDATED_VERSIONS` 标记单数为 `@deprecated`
- [ ] `pnpm install` 成功
- [ ] `pnpm run verify:contract` 通过
- [ ] `pnpm run build` 成功

---

## 阶段 2: 验证逻辑泛化 ⚠️ 中等复杂度（2 小时）

### 任务 R1: 移除单一验证版本依赖

**影响文件**:
- `src/std-contract.ts`
- `src/index.ts` (第 1286 行)

#### 子任务 R1.1: 修改 upstreamDriftWarnings()

**文件**: `src/std-contract.ts:171-180`

**当前逻辑**:
```typescript
export async function upstreamDriftWarnings(packageRoot: string): Promise<string[]> {
  const warnings: string[] = []
  for (const packageName of HARNESS_PACKAGES) {
    const found = await readInstalledVersion(packageRoot, packageName)
    if (found === undefined) continue
    if (found !== UPSTREAM_VALIDATED_VERSION) {  // ← 精确比较
      warnings.push(`${packageName}@${found} (verified: ${UPSTREAM_VALIDATED_VERSION})`)
    }
  }
  return warnings
}
```

**目标逻辑**:
```typescript
export async function upstreamDriftWarnings(packageRoot: string): Promise<string[]> {
  const warnings: string[] = []
  for (const packageName of HARNESS_PACKAGES) {
    const found = await readInstalledVersion(packageRoot, packageName)
    if (found === undefined) continue
    
    // Check if found version is in validated set
    const isValidated = UPSTREAM_VALIDATED_VERSIONS.includes(found)
    
    // Only warn if MAJOR version differs (0.2.x or 1.x.x)
    const foundMajorMinor = found.match(/^(\d+\.\d+)/)
    const expectedRange = '0.1'
    const isDifferentMajor = !foundMajorMinor || !foundMajorMinor[1].startsWith(expectedRange)
    
    if (isDifferentMajor) {
      warnings.push(`${packageName}@${found} (expected 0.1.x series)`)
    } else if (!isValidated) {
      // Info only: not explicitly tested but within compatible range
      warnings.push(`${packageName}@${found} (tested: ${UPSTREAM_VALIDATED_VERSIONS.join(', ')})`)
    }
  }
  return warnings
}
```

#### 子任务 R1.2: 更新 /doctor 显示

**文件**: `src/index.ts:1286`

**当前**:
```typescript
rows.push('verified dsh line: 0.1.2-alpha.3 (see verify:contract)')
```

**目标**:
```typescript
rows.push(`verified dsh lines: ${UPSTREAM_VALIDATED_VERSIONS.join(', ')} (see verify:contract)`)
```

#### 子任务 R1.3: 废弃单数常量导出

**文件**: `src/std-contract.ts:71`

**当前**:
```typescript
export const UPSTREAM_VALIDATED_VERSION = '0.1.2-alpha.3'
```

**目标**:
```typescript
/**
 * @deprecated Use UPSTREAM_VALIDATED_VERSIONS array instead.
 * Kept for backward compatibility only.
 */
export const UPSTREAM_VALIDATED_VERSION = UPSTREAM_VALIDATED_VERSIONS[UPSTREAM_VALIDATED_VERSIONS.length - 1]
```

### 阶段 2 完成检查

- [ ] `upstreamDriftWarnings()` 使用数组逻辑
- [ ] MAJOR 版本不匹配时发出错误级警告
- [ ] 同 MAJOR 但不在验证列表时发出信息级提示
- [ ] `/doctor` 显示所有已验证版本
- [ ] `UPSTREAM_VALIDATED_VERSION` 标记为废弃
- [ ] 所有引用该常量的代码已改用数组
- [ ] 回归测试通过

---

## 阶段 3: 运行时合约探针 ⚠️ 中等复杂度（3 小时）

### 任务 R3: 实现运行时漂移检测

#### 子任务 R3.1: 提取可调用版本检查函数

**文件**: `src/std-contract.ts`

**新增函数**:
```typescript
/**
 * Check runtime contract drift without throwing.
 * Returns drift details for display/logging.
 */
export interface RuntimeDriftReport {
  timestamp: number
  protocolDrift: ContractDrift[]
  harnessWarnings: string[]
  adapterVersion?: string
  adapterExpected: string
}

export async function checkRuntimeDrift(packageRoot: string): Promise<RuntimeDriftReport> {
  const protocolDrift = await verifyContract(packageRoot)
  const harnessWarnings = await upstreamDriftWarnings(packageRoot)
  const adapterVersion = await readInstalledVersion(packageRoot, STD_ADAPTER_PACKAGE)
  
  return {
    timestamp: Date.now(),
    protocolDrift,
    harnessWarnings,
    adapterVersion,
    adapterExpected: STD_ADAPTER_PEER_RANGE,
  }
}
```

#### 子任务 R3.2: /doctor check 子命令

**文件**: `src/index.ts` (commands 区域)

**新增命令**:
```typescript
commands.command('doctor check', 'check runtime contract drift')
  .execute(async () => {
    const packageRoot = process.cwd() // or profile root
    const report = await checkRuntimeDrift(packageRoot)
    
    const rows: string[] = []
    rows.push(`contract check @ ${new Date(report.timestamp).toISOString()}`)
    rows.push('')
    
    if (report.protocolDrift.length === 0) {
      rows.push('✓ std protocol packages: ok')
    } else {
      rows.push('✗ std protocol drift detected:')
      for (const line of formatContractDrift(report.protocolDrift)) {
        rows.push(`  ${line}`)
      }
    }
    
    rows.push('')
    if (report.adapterVersion) {
      const adapterOk = installedMeetsVersion(report.adapterVersion, STD_ADAPTER_MINIMUM)
      rows.push(`${adapterOk ? '✓' : '✗'} adapter: ${report.adapterVersion} (expected: ${report.adapterExpected})`)
    } else {
      rows.push('⚠ adapter: not installed')
    }
    
    rows.push('')
    if (report.harnessWarnings.length === 0) {
      rows.push('✓ harness packages: all within validated range')
    } else {
      rows.push('⚠ harness package notes:')
      for (const warning of report.harnessWarnings) {
        rows.push(`  ${warning}`)
      }
    }
    
    // Display in TUI
    const card = new StaticCardComponent(rows, palette)
    chat.addChild(card)
    ui.requestRender()
  })
```

#### 子任务 R3.3: 启动时非阻塞检查

**文件**: `src/index.ts` (启动逻辑区域)

**现有**: `verifyContract()` 有漂移时通过 `enqueueBootNotice` 警告

**增强**: 改为调用 `checkRuntimeDrift()` 并生成结构化通知

```typescript
// 启动时
const driftReport = await checkRuntimeDrift(packageRoot)
if (driftReport.protocolDrift.length > 0) {
  enqueueBootNotice(
    `std protocol drift: ${formatContractDrift(driftReport.protocolDrift).join('; ')}`,
    'warning'
  )
}
// 不阻断启动，仅记录
```

### 阶段 3 完成检查

- [ ] `checkRuntimeDrift()` 函数实现
- [ ] `/doctor check` 子命令可用
- [ ] 显示 protocol / adapter / harness 三层状态
- [ ] 启动时调用并生成 boot notice
- [ ] 不阻断启动流程
- [ ] 文档化使用场景

---

## 测试清单

### 单元测试

- [ ] `installedMeetsVersion()` 支持新范围格式
- [ ] `upstreamDriftWarnings()` 数组逻辑覆盖
  - [ ] 版本在数组中 → 无警告
  - [ ] 版本同 MAJOR 但不在数组 → 信息提示
  - [ ] 版本不同 MAJOR → 错误警告

### 集成测试

- [ ] `pnpm install` 后依赖图正确
- [ ] `verify:contract` 通过
- [ ] `verify:boundary` 通过
- [ ] `verify:plugin-spec` 通过
- [ ] `pnpm run build` 成功
- [ ] `pnpm test` 全部通过

### 烟雾测试

- [ ] `omdsh` 正常启动
- [ ] `/doctor` 显示正确
- [ ] `/doctor check` 输出合理
- [ ] `/help` 列出所有命令
- [ ] 创建新会话并发送消息
- [ ] 工具调用正常

### 兼容性测试

- [ ] 在 dsh 0.1.2-alpha.3 环境启动
- [ ] 在 dsh 0.1.2-alpha.2 环境启动（若可用）
- [ ] peer 范围在 npm/pnpm 中正确解析
- [ ] 全局安装无 peer 冲突

---

## 发布前检查

- [ ] `package.json` version 更新为 `0.3.2`
- [ ] `CHANGELOG.md` 补充发布日期
- [ ] `STD_ADAPTATION_REPORT.md` 归档到 `docs/`
- [ ] `STD_ADAPTATION_TODO.md` 删除（或归档）
- [ ] `README.md` 更新依赖说明（若有变化）
- [ ] Git tag `v0.3.2`
- [ ] GitHub Release notes
- [ ] npm publish

---

## 回滚计划

若发现重大问题：

1. **peer 范围过宽导致不兼容**:
   - 回滚到 `^0.1.0-rc.6 || ^0.1.1-rc.1 || ^0.1.2-alpha.2` 形式
   - 发布 0.3.2-hotfix.1

2. **验证逻辑变更导致误报**:
   - 恢复 `UPSTREAM_VALIDATED_VERSION` 精确比较
   - 暂时禁用 MAJOR 版本检查

3. **运行时探针性能问题**:
   - 移除启动时自动检查
   - 仅保留 `/doctor check` 手动调用

---

**文档版本**: v1.0  
**最后更新**: 2026-09-08  
**状态**: 待执行
