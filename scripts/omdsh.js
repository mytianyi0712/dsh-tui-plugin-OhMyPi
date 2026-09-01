#!/usr/bin/env node
// omdsh: dsh-omp-tui 启动器（Node 实现，跨平台 bin 入口）。
// 只负责调用系统 PATH 中官方 dsh 的独立进程，并启动 tui profile。
// 本项目不下载、不缓存 dsh。正常启动不迁移配置、不自动升级。
// `omdsh update` 从 GitHub Release 安装最新包，并做新版本适配。
//
// 环境变量：
//   DSH_REAL             显式指定 dsh 可执行文件
//   DSH_DEBUG=1          只打印将要执行的命令
//   OMDSH_NO_BOOTSTRAP=1 跳过首次运行的 profile 引导

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'dsh-omp-tui'
const PROFILE = 'tui'
const STD_ADAPTER = '@dsh-std/adapter-dsh'
const GITHUB_REPO = 'mytianyi0712/dsh-tui-plugin-OhMyPi'
const ownPackageJson = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
)
const ownVersion = ownPackageJson.version

const launcherHelp = `omdsh — dsh-omp-tui 启动器

用法:
  omdsh [参数...]
  omdsh update

说明:
  omdsh 会调用系统 PATH 中的官方 dsh，并启动 --profile tui。
  每次启动都会同步 tui profile 中的 dsh-omp-tui：版本与全局不一致、
  或 profile 中残留旧版链接安装时，会用当前全局包重新安装。
  首次尚无 tui profile 时会自动引导安装。
  omdsh update 从 GitHub Release 安装最新包，并针对新版本做适配
  （凭据扁平化、旧会话编码、社区 std adapter）。
  所有其它参数原样透传给 dsh（例如 --resume <session>）。
  官方 dsh 命令（web/plugin/--profile/--patch 等）请直接使用 dsh。

环境变量:
  DSH_REAL             显式指定 dsh 可执行文件
  DSH_DEBUG=1          只打印将要执行的命令
  OMDSH_NO_BOOTSTRAP=1 跳过首次 profile 引导安装
`

const args = process.argv.slice(2)
if (args[0] === '-h' || args[0] === '--help') {
  process.stdout.write(launcherHelp)
  process.exit(0)
}

const dsh = process.env.DSH_REAL || 'dsh'
const isWin = process.platform === 'win32'

function fail(message, code = 1) {
  process.stderr.write(`omdsh: ${message}\n`)
  process.exit(code)
}

function say(message) {
  process.stderr.write(`omdsh: ${message}\n`)
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

function profilePackageDir() {
  return path.join(dshHome(), 'profiles', PROFILE, 'node_modules', PACKAGE)
}

function installedProfileVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(profilePackageDir(), 'package.json'), 'utf8')).version
  } catch {
    return undefined
  }
}

/** profile 中的 dsh-omp-tui 是否是指向别处的链接安装（pnpm file: 目录常见）。 */
function profilePackageIsLink() {
  const dir = profilePackageDir()
  try {
    return fs.realpathSync(dir) !== path.resolve(dir)
  } catch {
    return false
  }
}

/**
 * 旧版本（0.2.x 及更早的 pnpm 安装）会在包目录内留下嵌套的
 * `node_modules/.pnpm`，其中的 @deepseek-ai 依赖可能与新版 dsh 不兼容。
 * 干净安装（nodeLinker: hoisted）不会在包目录内嵌套 node_modules。
 */
function profileInstallIsHealthy() {
  if (profilePackageIsLink()) return false
  if (fs.existsSync(path.join(profilePackageDir(), 'node_modules', '.pnpm'))) return false
  return true
}

/** 把全局包目录打包成临时 tarball，避免 pnpm 把 file: 目录安装成链接。 */
function packSelfTarball() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omdsh-pack-'))
  const output = path.join(tempDir, `${PACKAGE}-${ownVersion}.tgz`)
  const result = runSync('npm', ['pack', packageRoot(), '--ignore-scripts', '--pack-destination', tempDir], { stdio: 'pipe' })
  if (result.status !== 0) {
    throw new Error(`npm pack 失败：${String(result.stderr ?? '').trim() || '未知错误'}`)
  }
  const tarball = path.join(tempDir, `${PACKAGE}-${ownVersion}.tgz`)
  if (!fs.existsSync(tarball)) {
    const files = fs.readdirSync(tempDir).filter(name => name.endsWith('.tgz'))
    if (files.length === 0) throw new Error(`npm pack 未生成 tarball：${String(result.stdout ?? '').trim()}`)
    return path.join(tempDir, files[0])
  }
  return tarball
}

function removeProfilePackage() {
  fs.rmSync(profilePackageDir(), { recursive: true, force: true })
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
 * 在插件树加载阶段直接报错。仅在 `omdsh update` 时迁移。
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
  say('已把旧版 ~/.dsh/.credentials.yaml 迁移为新版扁平格式。')
}

/**
 * 新版 dsh-session-persistence-jsonl 默认使用 zstd；同一会话目录里若同时存在
 * `session.jsonl` 与 `session.jsonl.zstd`，会被新版后端判定为 encoding mismatch
 * 并拒绝加载。仅在 `omdsh update` 时处理会阻断启动的两类旧布局。
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

    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (entry.name !== 'session.jsonl' && entry.name !== 'session.jsonl.zstd') continue
      const legacy = `${entry.name}.omdsh-legacy-${Date.now()}`
      fs.renameSync(path.join(projectDir, entry.name), path.join(projectDir, legacy))
      say(`已将旧版扁平会话文件 ${path.join(projectDir, entry.name)} 重命名为 ${legacy}`)
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sessionDir = path.join(projectDir, entry.name)
      const plain = path.join(sessionDir, 'session.jsonl')
      const zstd = path.join(sessionDir, 'session.jsonl.zstd')
      if (!fs.existsSync(plain) || !fs.existsSync(zstd)) continue
      const legacy = `session.jsonl.omdsh-legacy-${Date.now()}`
      fs.renameSync(plain, path.join(sessionDir, legacy))
      say(`已将会话 ${entry.name} 的旧 plain 日志重命名为 ${legacy}，保留 zstd 版本。`)
    }
  }
}

/** 用 dsh plugin add 把指定源安装到 tui profile。 */
function addToProfile(source, silent) {
  const stdio = silent ? ['ignore', 'pipe', 'pipe'] : ['inherit', 'inherit', 'pipe']
  const runAdd = extraArgs => runSync(
    dsh,
    ['plugin', '--profile', PROFILE, 'add', ...extraArgs, source],
    { stdio },
  )
  let result = runAdd([])
  if (result.status !== 0 && String(result.stderr).includes('ERR_PNPM_ADDING_TO_ROOT')) {
    if (!silent) say('pnpm 拒绝写入 workspace 根（ERR_PNPM_ADDING_TO_ROOT），带 -w 重试…')
    result = runAdd(['-w'])
  }
  return result
}

function pnpmAvailable() {
  const probe = runSync('pnpm', ['--version'], { stdio: 'pipe' })
  return probe.error === undefined && probe.status === 0
}

/**
 * dsh plugin add 依赖系统 pnpm；没有 pnpm 时用 npm 直接安装 tarball 到
 * profile（不写 package.json，只补 node_modules）。dsh 的 bundle 解析走
 * profile/node_modules，因此该回退只要求用户安装了 Node 和 npm。
 */
function npmInstallToProfile(tarball, silent) {
  const stdio = silent ? ['ignore', 'pipe', 'pipe'] : ['inherit', 'inherit', 'pipe']
  return runSync(
    'npm',
    ['install', '--prefix', path.join(dshHome(), 'profiles', PROFILE), '--no-save', '--legacy-peer-deps', tarball],
    { stdio },
  )
}

function addResultError(result) {
  const stderr = String(result.stderr ?? '').trim()
  return stderr === '' ? '插件安装失败。' : stderr
}

/**
 * 同步 tui profile 中的 dsh-omp-tui：
 * - 首次安装：静默引导安装当前全局包；
 * - 旧版本或链接安装：用当前全局包重新打包安装，支持从旧版本更新。
 * 安装优先走 dsh 官方 plugin add（pnpm），没有 pnpm 时回退 npm。
 */
function ensureProfile() {
  const installed = installedProfileVersion()
  const needsInstall = installed !== ownVersion || !profileInstallIsHealthy()

  if (!needsInstall) return

  if (process.env.OMDSH_NO_BOOTSTRAP === '1') {
    if (installed === undefined) {
      fail('已跳过 profile 引导安装，但 tui profile 尚未安装 dsh-omp-tui。')
    }
    say(`OMDSH_NO_BOOTSTRAP=1：profile 中 dsh-omp-tui 需要重装（版本 ${installed ?? '未知'}），但本次不重装。`)
    return
  }

  const dshProbe = runSync(dsh, ['--version'], { stdio: 'pipe' })
  if (dshProbe.error || dshProbe.status !== 0) {
    fail('未检测到 dsh CLI。请先安装官方客户端：npm install -g @deepseek-ai/dsh')
  }

  removeProfilePackage()
  if (installed !== undefined) {
    say(`正在把 tui profile 的 dsh-omp-tui 同步为 ${ownVersion}（原 ${installed}）…`)
  }

  let tarball
  try {
    tarball = packSelfTarball()
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }

  const addResult = pnpmAvailable()
    ? addToProfile(tarball, false)
    : npmInstallToProfile(tarball, false)
  if (addResult.status !== 0) {
    fail(`插件安装失败。可稍后手工重试：dsh plugin --profile tui add <tgz 或 file:包路径>\n${addResultError(addResult)}`)
  }
}

function stdAdapterInstalled() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dshHome(), 'profiles', PROFILE, 'node_modules', '@dsh-std', 'adapter-dsh', 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : undefined
  } catch {
    return undefined
  }
}

function ensureStdAdapter() {
  if (stdAdapterInstalled() !== undefined) return
  say(`正在安装社区 std adapter ${STD_ADAPTER}…`)
  const result = runSync(dsh, ['plugin', '--profile', PROFILE, 'add', STD_ADAPTER], { stdio: ['inherit', 'inherit', 'pipe'] })
  if (result.status !== 0) {
    say('std adapter 安装失败（TUI 仍可启动；社区插件不会自动加载）。')
  }
}

function adaptForNewVersion() {
  migrateLegacyCredentials()
  migrateLegacySessionArtifacts()
  ensureStdAdapter()
}

async function githubLatestRelease() {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: {
      'User-Agent': 'omdsh',
      Accept: 'application/vnd.github+json',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub 发布查询失败（HTTP ${response.status}）`)
  }
  const release = await response.json()
  const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
  if (tag === '') throw new Error('GitHub 发布缺少 tag_name')
  const version = tag.replace(/^v/, '')
  const assets = Array.isArray(release.assets) ? release.assets : []
  const tgz = assets.find(asset => (
    typeof asset === 'object' && asset !== null
    && typeof asset.browser_download_url === 'string'
    && String(asset.name ?? '').endsWith('.tgz')
  ))
  const url = typeof tgz?.browser_download_url === 'string'
    ? tgz.browser_download_url
    : `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${PACKAGE}-${version}.tgz`
  return { tag, version, url }
}

async function runUpdate() {
  const dshProbe = runSync(dsh, ['--version'], { stdio: 'pipe' })
  if (dshProbe.error || dshProbe.status !== 0) {
    fail('未检测到 dsh CLI。请先安装官方客户端：npm install -g @deepseek-ai/dsh')
  }

  say('正在查询 GitHub 最新发布…')
  let latest
  try {
    latest = await githubLatestRelease()
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }

  const installed = installedProfileVersion()
  if (installed === latest.version) {
    say(`已是最新版本 v${latest.version}，执行新版本适配…`)
  } else {
    if (installed !== undefined) say(`profile 内为 v${installed}，正在安装 GitHub ${latest.tag}…`)
    else say(`正在安装 GitHub ${latest.tag}…`)
    const result = addToProfile(latest.url, false)
    if (result.status !== 0) {
      fail(`从 GitHub 安装失败。\n${addResultError(result)}`)
    }
    say(`profile 已更新为 v${installedProfileVersion() ?? latest.version}。`)
  }

  adaptForNewVersion()
  say('适配完成。')
}

function startTui(passthrough) {
  const spawnArgs = ['--profile', PROFILE, ...passthrough]
  if (process.env.DSH_DEBUG === '1') {
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
}

if (args[0] === 'update') {
  void runUpdate().catch(error => fail(error instanceof Error ? error.message : String(error)))
} else {
  startTui(args)
}
