#!/usr/bin/env node
// omdsh: dsh-omp-tui 启动器（Node 实现，跨平台 bin 入口）。
// 只负责调用系统 PATH 中官方 dsh 的独立进程，并启动 tui profile。
// 本项目不下载、不缓存 dsh；首次运行时自动把本包安装进 tui profile，
// 之后检测到 profile 内版本低于启动器版本时自动更新。
//
// 环境变量：
//   DSH_REAL             显式指定 dsh 可执行文件
//   DSH_DEBUG=1          只打印将要执行的命令
//   OMDSH_NO_BOOTSTRAP=1 跳过首次运行/自动更新的 profile 引导

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'dsh-omp-tui'
const PROFILE = 'tui'
const ownPackageJson = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
)
const ownVersion = ownPackageJson.version

const launcherHelp = `omdsh — dsh-omp-tui 启动器

用法:
  omdsh [参数...]

说明:
  omdsh 会调用系统 PATH 中的官方 dsh，并启动 --profile tui。
  首次运行时自动把 dsh-omp-tui 安装到 tui profile；之后若 profile
  内版本低于启动器版本，也会自动更新（可通过 OMDSH_NO_BOOTSTRAP=1
  跳过）。所有参数原样透传给 dsh（例如 --resume <session>、
  --session <session>）。
  官方 dsh 命令（web/plugin/--profile/--patch 等）请直接使用 dsh。

环境变量:
  DSH_REAL             显式指定 dsh 可执行文件
  DSH_DEBUG=1          只打印将要执行的命令
  OMDSH_NO_BOOTSTRAP=1 跳过 profile 引导安装/自动更新
`

const args = process.argv.slice(2)
if (args[0] === '-h' || args[0] === '--help') {
  process.stdout.write(launcherHelp)
  process.exit(0)
}

const dsh = process.env.DSH_REAL || 'dsh'
const spawnArgs = ['--profile', PROFILE, ...args]
const isWin = process.platform === 'win32'

function fail(message, code = 1) {
  process.stderr.write(`omdsh: ${message}\n`)
  process.exit(code)
}

/** cmd.exe 以空格拼接参数；含空格/元字符的参数需要双引号包裹。 */
function shellQuote(arg) {
  return /[ \t"^&|<>()]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
}

/**
 * Windows：Node ≥18 的安全限制要求 .cmd 经 shell 启动；Node ≥22 对
 * `shell:true + 非空 args 数组` 会告警（DEP0190）。因此把转义后的命令
 * 拼成一个字符串传入，非 Windows 保持数组直传。
 */
function runSync(command, args, opts = {}) {
  if (isWin) {
    const line = [command, ...args].map(shellQuote).join(' ')
    return spawnSync(line, [], { ...opts, shell: true })
  }
  return spawnSync(command, args, opts)
}

function run(command, args) {
  if (isWin) {
    const line = [command, ...args].map(shellQuote).join(' ')
    return spawn(line, [], { stdio: 'inherit', shell: true })
  }
  return spawn(command, args, { stdio: 'inherit' })
}

function packageRoot() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  return root.replace(/\\/g, '/').replace(/\/+$/, '')
}

function dshHome() {
  return process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh')
}

function installedProfileVersion() {
  const pkgPath = path.join(dshHome(), 'profiles', PROFILE, 'node_modules', PACKAGE, 'package.json')
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version
  } catch {
    return undefined
  }
}

function compareVersions(a, b) {
  const aParts = a.split('-')[0].split('.').map(Number)
  const bParts = b.split('-')[0].split('.').map(Number)
  const length = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < length; i++) {
    const av = aParts[i] ?? 0
    const bv = bParts[i] ?? 0
    if (av !== bv) return av - bv
  }
  return 0
}

/**
 * 新版 dsh 的 credentials-local 只接受「凭据名 → 非空字符串」的扁平文档，
 * 而更早版本写入的是 `version: 1` + `refs:` 两层结构；旧文件会让新版 dsh
 * 在插件树加载阶段直接报错。启动前做一次只针对该旧形状的原地迁移。
 */
function migrateLegacyCredentials() {
  const file = path.join(dshHome(), '.credentials.yaml')
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return
  }

  const lines = text.split(/\r?\n/)
  if (!lines.some((line) => /^version:\s*\d+\s*$/.test(line))) return
  if (!lines.some((line) => /^refs:\s*$/.test(line))) return

  const migrated = lines
    .filter((line) => !/^version:\s*\d+\s*$/.test(line) && !/^refs:\s*$/.test(line))
    .map((line) => line.replace(/^\s{2}/, ''))
    .join('\n')
    .trimEnd() + '\n'

  fs.writeFileSync(file, migrated, 'utf-8')
  process.stderr.write('omdsh: 已把旧版 ~/.dsh/.credentials.yaml 迁移为新版扁平格式。\n')
}

/**
 * 新版 dsh-session-persistence-jsonl 默认使用 zstd；同一会话目录里若同时存在
 * `session.jsonl` 与 `session.jsonl.zstd`，会被新版后端判定为 encoding mismatch
 * 并拒绝加载，agent-loop 也会因此一直等待 sessionPersistence。这里只处理会
 * 直接阻断启动的两类旧布局，把旧文件重命名而不是删除。
 */
function migrateLegacySessionArtifacts() {
  const sessionsRoot = path.join(dshHome(), 'sessions')
  let projects
  try {
    projects = fs.readdirSync(sessionsRoot, { withFileTypes: true })
  } catch {
    return
  }

  for (const project of projects) {
    if (!project.isDirectory()) continue
    const projectDir = path.join(sessionsRoot, project.name)
    let entries
    try {
      entries = fs.readdirSync(projectDir, { withFileTypes: true })
    } catch {
      continue
    }

    // 旧版扁平布局：session.jsonl / session.jsonl.zstd 直接放在 project 目录下。
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (entry.name !== 'session.jsonl' && entry.name !== 'session.jsonl.zstd') continue
      const legacy = `${entry.name}.omdsh-legacy-${Date.now()}`
      fs.renameSync(path.join(projectDir, entry.name), path.join(projectDir, legacy))
      process.stderr.write(`omdsh: 已将旧版扁平会话文件 ${path.join(projectDir, entry.name)} 重命名为 ${legacy}\n`)
    }

    // 新旧编码混存：默认 zstd 后端会因反向编码文件直接报错。
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sessionDir = path.join(projectDir, entry.name)
      const plain = path.join(sessionDir, 'session.jsonl')
      const zstd = path.join(sessionDir, 'session.jsonl.zstd')
      if (!fs.existsSync(plain) || !fs.existsSync(zstd)) continue
      const legacy = `session.jsonl.omdsh-legacy-${Date.now()}`
      fs.renameSync(plain, path.join(sessionDir, legacy))
      process.stderr.write(`omdsh: 已将会话 ${entry.name} 的旧 plain 日志重命名为 ${legacy}，保留 zstd 版本。\n`)
    }
  }
}

/** 用 dsh plugin add 把当前启动器目录安装/更新到 tui profile。 */
function addToProfile() {
  const runAdd = extraArgs => runSync(
    dsh,
    ['plugin', '--profile', PROFILE, 'add', ...extraArgs, `file:${packageRoot()}`],
    { stdio: ['inherit', 'inherit', 'pipe'] },
  )
  let result = runAdd([])
  if (result.status !== 0 && String(result.stderr).includes('ERR_PNPM_ADDING_TO_ROOT')) {
    process.stderr.write('omdsh: pnpm 拒绝写入 workspace 根（ERR_PNPM_ADDING_TO_ROOT），带 -w 重试…\n')
    result = runAdd(['-w'])
  }
  return result
}

function ensureProfile() {
  if (process.env.OMDSH_NO_BOOTSTRAP === '1') {
    if (installedProfileVersion() === undefined) {
      fail('已跳过 profile 引导安装，但 tui profile 尚未安装 dsh-omp-tui。')
    }
    return
  }

  const installedVersion = installedProfileVersion()
  if (installedVersion === undefined) {
    // 先探测 dsh 和 pnpm，避免 add 执行到一半才报缺依赖。
    const dshProbe = runSync(dsh, ['--version'], { stdio: 'pipe' })
    if (dshProbe.error || dshProbe.status !== 0) {
      fail('未检测到 dsh CLI。请先安装官方客户端：npm install -g @deepseek-ai/dsh')
    }
    const pnpmProbe = runSync('pnpm', ['--version'], { stdio: 'pipe' })
    if (pnpmProbe.error || pnpmProbe.status !== 0) {
      fail('首次安装需要 pnpm。请先安装：npm install -g pnpm（或启用 corepack：corepack enable pnpm）')
    }

    process.stderr.write(`omdsh: 首次运行，正在初始化 ${PROFILE} profile（${PACKAGE}@${ownVersion}）…\n`)
    const result = addToProfile()
    if (result.status !== 0) {
      fail('插件安装失败。可稍后手工重试：dsh plugin --profile tui add <tgz 或 file:包路径>')
    }
    return
  }

  if (installedVersion === ownVersion) return

  if (compareVersions(installedVersion, ownVersion) > 0) {
    process.stderr.write(
      `omdsh: 提示：profile 内运行的是 v${installedVersion}，而启动器是 v${ownVersion}。` +
      `启动器较旧，跳过自动更新。\n`,
    )
    return
  }

  process.stderr.write(
    `omdsh: 检测到 profile 内 dsh-omp-tui 为 v${installedVersion}，正在自动更新到 v${ownVersion}…\n`,
  )
  const result = addToProfile()
  if (result.status !== 0) {
    fail(
      `自动更新失败。可稍后手工执行：dsh plugin --profile ${PROFILE} add file:${packageRoot()}`,
    )
  }
  process.stderr.write(`omdsh: profile 已更新为 v${installedProfileVersion() ?? ownVersion}。\n`)
}

migrateLegacyCredentials()
migrateLegacySessionArtifacts()

if (process.env.DSH_DEBUG === '1') {
  ensureProfile()
  process.stdout.write(`omdsh → ${dsh} ${spawnArgs.join(' ')}\n`)
  process.exit(0)
}

ensureProfile()

const child = run(dsh, spawnArgs)

child.on('error', (err) => {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
    process.stderr.write('omdsh: 未在 PATH 中找到官方 dsh。\n')
    process.stderr.write('omdsh: 请先安装 @deepseek-ai/dsh（例如: npm install -g @deepseek-ai/dsh）。\n')
    process.exitCode = 127
    return
  }
  process.stderr.write(`omdsh: 启动 dsh 失败: ${String(err)}\n`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
