#!/usr/bin/env node
// LiftLens local agent — one-line setup:
//
//   npx liftlens-agent            start + open the web app, auto-paired
//   npx liftlens-agent install    run in the background, start at login (macOS launchd / Linux systemd --user)
//   npx liftlens-agent status     health + runtime check
//   npx liftlens-agent pair       re-open the pairing link (e.g. new browser)
//   npx liftlens-agent uninstall  remove the background service
//
// Everything stays on this machine: the bridge binds to 127.0.0.1, the web app keeps
// videos + logs in the browser, and coaching runs on the user's own Claude Code.

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENT_URL, BUILD, HOME, PORT, VERSION, WEB_URL, detectRuntimes, pairUrl, readToken, rotateToken } from './config.mjs'
import { coachesDir, syncCoaches, syncState } from './sync.mjs'
import { listRuntimes, readConfig, runtimeById, writeConfig } from './runtimes.mjs'
import { parseArgs } from 'node:util'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG_DIR = path.resolve(__dirname, '..')
const APP_DIR = path.join(HOME, 'app') // stable copy used by the background service
const LOG = path.join(HOME, 'agent.log')
const LABEL = 'com.liftlens.agent'
const PLIST = path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`)
const UNIT = path.join(os.homedir(), '.config/systemd/user/liftlens-agent.service')

const c = {
  acid: (s) => `\x1b[38;5;155m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}
const ok = (s) => console.log(`  ${c.acid('✓')} ${s}`)
const bad = (s) => console.log(`  ${c.red('✗')} ${s}`)
const info = (s) => console.log(`  ${c.dim('·')} ${s}`)

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]]
  try {
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref()
    return true
  } catch {
    return false
  }
}

async function health() {
  try {
    const r = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(1500) })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

function banner() {
  console.log(`\n  ${c.bold('LiftLens agent')} ${c.dim('v' + VERSION)}  ${c.dim('— 本地教练桥接，视频与记录不出本机')}\n`)
}

function checkRuntime() {
  const rt = detectRuntimes()
  if (rt.claude) ok(`Claude Code ${c.dim(rt.claude.version ?? '')}`)
  else {
    bad('没有找到 Claude Code（教练点评需要它）')
    info(`安装：${c.acid('npm i -g @anthropic-ai/claude-code')}，然后运行一次 ${c.acid('claude')} 完成登录`)
  }
  return rt
}

// ---------------------------------------------------------------- commands

async function start({ open = true } = {}) {
  banner()
  let running = await health()
  // The port is held by another version / a build for another site (e.g. a dev build): ask it to yield and replace it with this one
  if (running && (running.build !== BUILD || running.web !== WEB_URL)) {
    const what = `v${running.version ?? '?'}${running.build ? ` · ${running.build}` : ''}${running.web ? ` · ${running.web}` : ''}`
    if (fs.existsSync(PLIST) || fs.existsSync(UNIT)) {
      bad(`后台服务里是另一个版本（${what}）。运行本命令加上 ${c.acid('install')} 即可替换成当前版本`)
      process.exit(1)
    }
    info(`本机已有另一个 LiftLens agent（${what}），替换为当前版本…`)
    try {
      await fetch(`${AGENT_URL}/shutdown`, { method: 'POST', headers: { 'x-liftlens-token': readToken() }, signal: AbortSignal.timeout(1500) })
    } catch {
      /* older versions have no /shutdown */
    }
    for (let i = 0; i < 20 && running; i++) {
      await new Promise((r) => setTimeout(r, 150))
      running = await health()
    }
    if (running) {
      bad(`旧的 agent 没有退出。请在它所在的终端按 Ctrl+C（或结束占用 ${PORT} 端口的 node 进程），再运行本命令`)
      process.exit(1)
    }
  }
  if (running) {
    ok(`已经在后台运行 ${c.dim(AGENT_URL)}`)
    if (open) {
      openBrowser(pairUrl())
      ok('已在浏览器打开 LiftLens（自动配对）')
    }
    return
  }
  checkRuntime()
  const { startServer, loadCoaches } = await import('./server.mjs')
  try {
    await startServer()
  } catch (e) {
    bad(e.code === 'EADDRINUSE' ? `端口 ${PORT} 被占用，可用 LIFTLENS_PORT=xxxx 换一个` : e.message)
    process.exit(1)
  }
  ok(`监听 ${AGENT_URL} ${c.dim('（仅本机）')}`)
  ok(`教练 skills：${loadCoaches().map((x) => x.displayName ?? x.name).join(' / ')}`)
  const url = pairUrl()
  if (open && openBrowser(url)) ok('已在浏览器打开 LiftLens，自动完成配对')
  else info(`在浏览器打开以完成配对：\n    ${c.acid(url)}`)
  console.log(`\n  ${c.dim('想开机自动运行？在刚才的命令后面加上')} ${c.acid('install')} ${c.dim('再运行一次 · Ctrl+C 退出')}`)
  console.log(`  ${c.dim('想在手机上用？在命令后面加上')} ${c.acid('phone')} ${c.dim('显示二维码，或在电脑网页的「本地 agent」里扫码')}\n`)
}

function copyApp() {
  // npx runs from a temporary cache dir — install a stable copy for the background service
  fs.rmSync(APP_DIR, { recursive: true, force: true })
  fs.mkdirSync(APP_DIR, { recursive: true })
  fs.cpSync(path.join(PKG_DIR, 'package.json'), path.join(APP_DIR, 'package.json'))
  fs.cpSync(path.join(PKG_DIR, 'src'), path.join(APP_DIR, 'src'), { recursive: true })
  fs.cpSync(coachesDir(), path.join(APP_DIR, 'coaches'), { recursive: true, dereference: true })
  const npm = path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm')
  execFileSync(fs.existsSync(npm) ? npm : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: APP_DIR,
    stdio: 'inherit',
  })
}

function serviceEnv() {
  // launchd/systemd start with a minimal PATH — pin the runtime we found now
  const rt = detectRuntimes()
  const env = {
    PATH: [path.dirname(process.execPath), rt.claude ? path.dirname(rt.claude.path) : null, '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'].filter(Boolean).join(':'),
    LIFTLENS_WEB_URL: WEB_URL,
    LIFTLENS_PORT: String(PORT),
    HOME: os.homedir(),
  }
  if (rt.claude) env.LIFTLENS_CLAUDE = rt.claude.path
  for (const k of ['LIFTLENS_MODEL', 'LIFTLENS_ORIGINS']) if (process.env[k]) env[k] = process.env[k]
  return env
}

async function install({ open = true } = {}) {
  banner()
  checkRuntime()
  if (await health()) info('检测到正在运行的 agent，安装后台服务后它会被替换')
  copyApp()
  ok(`已复制到 ${c.dim(APP_DIR)}`)
  const entry = path.join(APP_DIR, 'src/cli.mjs')
  const env = serviceEnv()

  if (process.platform === 'darwin') {
    const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(entry)}</string><string>serve</string></array>
  <key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`).join('')}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG)}</string>
</dict></plist>`
    fs.mkdirSync(path.dirname(PLIST), { recursive: true })
    try {
      execFileSync('launchctl', ['bootout', `gui/${process.getuid()}`, PLIST], { stdio: 'ignore' })
    } catch {
      /* not loaded yet */
    }
    fs.writeFileSync(PLIST, plist)
    execFileSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, PLIST])
    ok(`已注册为登录项（launchd：${c.dim(LABEL)}）`)
  } else if (process.platform === 'linux') {
    const unit = `[Unit]
Description=LiftLens local agent
[Service]
ExecStart=${process.execPath} ${entry} serve
Restart=always
${Object.entries(env).map(([k, v]) => `Environment=${k}=${v}`).join('\n')}
StandardOutput=append:${LOG}
StandardError=append:${LOG}
[Install]
WantedBy=default.target
`
    fs.mkdirSync(path.dirname(UNIT), { recursive: true })
    fs.writeFileSync(UNIT, unit)
    execFileSync('systemctl', ['--user', 'daemon-reload'])
    execFileSync('systemctl', ['--user', 'enable', '--now', 'liftlens-agent.service'])
    ok('已注册为 systemd 用户服务（liftlens-agent.service）')
  } else {
    bad('暂不支持在 Windows 上自动注册后台服务，请用 `npx liftlens-agent` 前台运行')
    return
  }

  for (let i = 0; i < 20 && !(await health()); i++) await new Promise((r) => setTimeout(r, 300))
  if (await health()) {
    ok(`后台服务已启动 ${c.dim(AGENT_URL)}，日志：${c.dim(LOG)}`)
    if (open) {
      openBrowser(pairUrl())
      ok('已在浏览器打开 LiftLens，自动完成配对。以后开机即可直接使用。')
    } else info(`配对链接：${c.acid(pairUrl())}`)
  } else bad(`服务没有起来，请查看日志：${LOG}`)
  console.log()
}

function uninstall() {
  banner()
  if (process.platform === 'darwin' && fs.existsSync(PLIST)) {
    try {
      execFileSync('launchctl', ['bootout', `gui/${process.getuid()}`, PLIST], { stdio: 'ignore' })
    } catch {
      /* already stopped */
    }
    fs.rmSync(PLIST)
    ok('已移除登录项')
  }
  if (process.platform === 'linux' && fs.existsSync(UNIT)) {
    try {
      execFileSync('systemctl', ['--user', 'disable', '--now', 'liftlens-agent.service'], { stdio: 'ignore' })
    } catch {
      /* ignore */
    }
    fs.rmSync(UNIT)
    ok('已移除 systemd 用户服务')
  }
  fs.rmSync(APP_DIR, { recursive: true, force: true })
  ok(`已删除 ${APP_DIR}（配对码保留在 ${path.join(HOME, 'token')}）`)
  console.log()
}

async function status() {
  banner()
  const h = await health()
  if (h) ok(`运行中 ${c.dim(AGENT_URL)} · v${h.version}`)
  else bad('没有在运行。请到 LiftLens 网页「本地 Agent」页复制启动命令')
  const installed = (process.platform === 'darwin' && fs.existsSync(PLIST)) || (process.platform === 'linux' && fs.existsSync(UNIT))
  installed ? ok('已设置开机自启') : info('未设置开机自启（在启动命令后面加上 install 运行即可）')
  checkRuntime()
  info(`网页：${WEB_URL}`)
  const r = await syncCoaches({ force: true })
  const dir = coachesDir()
  if (r.error) info(`教练 skills：${syncState.source === 'synced' ? '已同步版本 ' + syncState.version : '安装包自带'}（检查更新失败：${r.error}）`)
  else ok(`教练 skills：版本 ${syncState.version}${r.updated ? '（刚刚更新）' : '（已是最新）'}`)
  info(c.dim(dir))
  console.log()
}

async function pair({ rotate = false } = {}) {
  banner()
  const token = rotate ? rotateToken() : readToken()
  if (rotate) info('已生成新的配对码；旧的浏览器配对立即失效（后台服务需要重启：install 一次即可）')
  const url = pairUrl(token)
  if (openBrowser(url)) ok('已在浏览器打开配对链接')
  info(c.acid(url))
  console.log()
}

/** QR code + link for connecting a phone to this computer through the encrypted relay */
async function phoneCmd({ rotate = false } = {}) {
  banner()
  const { relayCreds, relayEnabled, relayLink, RELAY_ORIGIN } = await import('./relay.mjs')
  if (!relayEnabled()) {
    bad(`中继未启用（LIFTLENS_RELAY=0 或没有站点地址 ${RELAY_ORIGIN || ''}）`)
    return
  }
  if (rotate) {
    relayCreds({ rotate: true })
    ok('已生成新的手机连接码；用旧码连接的手机全部失效')
    if (await health()) info(`正在运行的 agent 需要重启才会用新码：Ctrl+C 后重新运行，或后台服务运行一次 ${c.acid('install')}`)
  }
  const link = relayLink()
  const QR = (await import('qrcode')).default
  console.log(await QR.toString(link, { type: 'terminal', small: true, errorCorrectionLevel: 'L' }))
  ok('用手机相机扫上面的二维码，在 LiftLens 里就能用这台电脑上的 agent 点评')
  info(`或者在手机 LiftLens「本地 agent › 连接电脑」里粘贴连接码：\n    ${c.acid(link.split('#relay=')[1])}`)
  info(c.dim('经端到端加密的中继转发：不用开端口，手机和电脑不必在同一网络；连接码等同于密码，不要发给别人'))
  console.log()
}

async function runtimesCmd() {
  banner()
  const list = await listRuntimes()
  for (const group of ['local', 'cloud']) {
    console.log(`  ${c.bold(group === 'local' ? '本地 agent / 模型' : '云端模型 API')}`)
    for (const r of list.filter((x) => x.group === group)) {
      const mark = r.current ? c.acid('●') : r.available ? c.acid('○') : c.dim('·')
      const state = r.available ? `${r.model ?? ''}` : c.dim(r.reason ?? '')
      console.log(`  ${mark} ${r.id.padEnd(18)} ${r.label.padEnd(26)} ${state}`)
    }
    console.log()
  }
  info(`切换：${c.acid('<启动命令> use <id> [--model ...] [--key ...]')}，例如 use anthropic --key sk-ant-...`)
  console.log()
}

async function useCmd(args) {
  banner()
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      model: { type: 'string' },
      key: { type: 'string' },
      'base-url': { type: 'string' },
      region: { type: 'string' },
      project: { type: 'string' },
      location: { type: 'string' },
      path: { type: 'string' },
      name: { type: 'string' },
    },
  })
  const id = positionals[0]
  if (!id || !runtimeById(id)) {
    bad(`请指定运行时 id，可选：${(await listRuntimes()).map((r) => r.id).join(' / ')}`)
    return
  }
  const cfg = readConfig()
  const rc = { ...(cfg.runtimes?.[id] ?? {}) }
  const map = { model: 'model', key: 'apiKey', 'base-url': 'baseURL', region: 'region', project: 'project', location: 'location', path: 'path', name: 'name' }
  for (const [flag, field] of Object.entries(map)) if (values[flag] !== undefined) rc[field] = values[flag]
  writeConfig({ ...cfg, runtime: id, runtimes: { ...(cfg.runtimes ?? {}), [id]: rc } })
  const r = (await listRuntimes()).find((x) => x.id === id)
  ok(`默认运行时：${r.label}${values.key ? '（API key 已保存到本机 ~/.liftlens/config.json）' : ''}`)
  r.available ? ok(`可用 · 模型 ${r.model}`) : bad(`暂不可用：${r.reason}`)
  if (await health()) info('正在运行的 agent 下次点评时会自动使用新设置，无需重启')
  console.log()
}

function help() {
  banner()
  console.log(`  ${c.acid('npx liftlens-agent')}             启动并在浏览器自动配对
  ${c.acid('npx liftlens-agent install')}     后台运行 + 开机自启（macOS / Linux）
  ${c.acid('npx liftlens-agent status')}      查看运行状态
  ${c.acid('npx liftlens-agent pair')}        重新打开配对链接（--rotate 重新生成配对码）
  ${c.acid('npx liftlens-agent uninstall')}   移除后台服务
  ${c.acid('npx liftlens-agent phone')}       显示二维码，让手机连接这台电脑（--rotate 换一个连接码）
  ${c.acid('npx liftlens-agent runtimes')}    列出可用的 agent / 模型（本地 + 云端）
  ${c.acid('npx liftlens-agent use <id>')}    切换默认 agent，可带 --model --key --base-url --region --project

  环境变量：LIFTLENS_WEB_URL（网页地址，默认 ${WEB_URL}） · LIFTLENS_PORT（默认 4517） · LIFTLENS_MODEL（如 sonnet）
`)
}

const [cmd = 'start', ...rest] = process.argv.slice(2)
const flags = new Set(rest)
switch (cmd) {
  case 'start':
    await start({ open: !flags.has('--no-open') })
    break
  case 'serve': // used by the background service: no banner/browser
    await (await import('./server.mjs')).startServer()
    console.log(`[${new Date().toISOString()}] liftlens-agent v${VERSION} listening on ${AGENT_URL}`)
    break
  case 'install':
    await install({ open: !flags.has('--no-open') })
    break
  case 'uninstall':
    uninstall()
    break
  case 'status':
    await status()
    break
  case 'phone':
    await phoneCmd({ rotate: flags.has('--rotate') })
    break
  case 'runtimes':
    await runtimesCmd()
    break
  case 'use':
    await useCmd(rest)
    break
  case 'pair':
    await pair({ rotate: flags.has('--rotate') })
    break
  case '-v':
  case '--version':
    console.log(VERSION)
    break
  default:
    help()
}
