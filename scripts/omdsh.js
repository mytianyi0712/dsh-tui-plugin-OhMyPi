#!/usr/bin/env node
// omdsh: dsh-omp-tui 启动器（Node 实现，跨平台 bin 入口）。
// 只负责调用系统 PATH 中官方 dsh 的独立进程，并启动 tui profile。
// 本项目不下载、不缓存 dsh；首次运行时自动把本包安装进 tui profile。
//
// 环境变量：
//   DSH_REAL             显式指定 dsh 可执行文件
//   DSH_DEBUG=1          只打印将要执行的命令
//   OMDSH_NO_BOOTSTRAP=1 跳过首次运行的 profile 引导安装

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
  首次运行时自动把 dsh-omp-tui 安装到 tui profile（可通过
  OMDSH_NO_BOOTSTRAP=1 跳过）。所有参数原样透传给 dsh
  （例如 --resume <session>、--session <session>）。
  官方 dsh 命令（web/plugin/--profile/--patch 等）请直接使用 dsh。

环境变量:
  DSH_REAL             显式指定 dsh 可执行文件
  DSH_DEBUG=1          只打印将要执行的命令
  OMDSH_NO_BOOTSTRAP=1 跳过 profile 引导安装
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

function installedProfileVersion() {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const pkgPath = path.join(dshHome, 'profiles', PROFILE, 'node_modules', PACKAGE, 'package.json')
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version
  } catch {
    return undefined
  }
}

function majorMinor(version) {
  return version.split('-')[0].split('.').slice(0, 2).map(Number)
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
    if (result.status !== 0) {
      fail('插件安装失败。可稍后手工重试：dsh plugin --profile tui add <tgz 或 file:包路径>')
    }
    return
  }

  if (installedVersion !== ownVersion) {
    const [installedMajor, installedMinor] = majorMinor(installedVersion)
    const [ownMajor, ownMinor] = majorMinor(ownVersion)
    if (installedMajor < ownMajor || (installedMajor === ownMajor && installedMinor < ownMinor)) {
      fail(
        `无法启动：profile 内运行的是 v${installedVersion}，而启动器是 v${ownVersion}。` +
        `请先对齐：dsh plugin --profile ${PROFILE} add file:${packageRoot()}`,
      )
    }
    process.stderr.write(
      `omdsh: 提示：profile 内运行的是 v${installedVersion}，而启动器是 v${ownVersion}。` +
      `更新 profile：dsh plugin --profile ${PROFILE} add file:${packageRoot()}\n`,
    )
  }
}

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
