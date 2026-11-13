import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, Copy, Loader2, Power, RefreshCw, ShieldCheck, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { AGENT_CMD, useAgent } from '../lib/agent'
import { CoachEnginePicker, type Mode } from '../components/RuntimePicker'
import { useCoachEngine } from '../lib/cloud'

const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

function Cmd({ cmd, hint }: { cmd: string; hint?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(cmd)
        setCopied(true)
        toast.success('已复制，粘贴到终端运行')
        setTimeout(() => setCopied(false), 1600)
      }}
      className="group flex w-full min-w-0 items-start gap-3 rounded-xl border border-line bg-ink-2 px-4 py-3 text-left font-mono text-sm transition-colors hover:border-acid/50"
    >
      <Terminal size={15} className="mt-0.5 shrink-0 text-dim" />
      <span className="min-w-0 flex-1 break-all leading-relaxed text-acid">{cmd}</span>
      {hint && <span className="hidden text-xs text-dim sm:inline">{hint}</span>}
      {copied ? <Check size={15} className="mt-0.5 shrink-0 text-good" /> : <Copy size={15} className="mt-0.5 shrink-0 text-dim group-hover:text-fg" />}
    </button>
  )
}

export default function AgentPage() {
  const { url, token, status, health, save, check } = useAgent()
  const engine = useCoachEngine()
  const [u, setU] = useState(url)
  const [t, setT] = useState(token)
  const [manual, setManual] = useState(false)
  const [modeSel, setModeSel] = useState<Mode | null>(null)
  useEffect(() => {
    setU(url)
    setT(token)
  }, [url, token])
  const ready = status === 'ready'
  // open on whatever is in use; with nothing set up yet, the cloud route is the shortest
  const mode: Mode = modeSel ?? (engine?.mode === 'cloud' ? 'cloud' : ready ? 'agent' : 'cloud')

  // while waiting for the user to run the command, poll so the page flips to "connected" by itself
  useEffect(() => {
    if (ready || mode !== 'agent' || TOUCH) return
    const id = setInterval(() => check(), 2000)
    return () => clearInterval(id)
  }, [ready, mode, check])

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="kicker">AI COACH</div>
      <h1 className="font-display mt-1 text-4xl font-bold tracking-tight">用你自己的 AI 当教练</h1>
      <p className="mt-3 text-mute">
        测量和动作检查在浏览器里完成，不需要任何设置。想要教练点评，选一种方式：
        <b className="font-medium text-fg">云端 API</b>（填你自己的 key，手机电脑都能用），或
        <b className="font-medium text-fg">本地 agent</b>（用电脑上已登录的 Claude Code、Codex 等，不需要 key）。随时可以切换。
      </p>

      <section id="runtimes" className="card mt-8 scroll-mt-20 p-5">
        <CoachEnginePicker mode={mode} onMode={setModeSel} />
      </section>

      {mode === 'cloud' ? (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-line p-4 text-xs text-mute">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-cyan" />
          <div>
            隐私：API key 和训练记录一样只存在这个浏览器里。每次点评只把测量数据和几张关键帧（已叠加骨架，不含原视频）从浏览器直接发给你选的厂商，费用按你自己的账户计。
          </div>
        </div>
      ) : TOUCH ? (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-line p-4 text-xs text-mute">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-cyan" />
          <div>
            本地 agent 运行在你的电脑上，只接受同一台电脑上浏览器的请求（127.0.0.1）。在手机上点评请改用云端 API；或者在电脑上打开这个页面。
          </div>
        </div>
      ) : (
        <>
          {/* agent connection */}
          <motion.div layout className={`card mt-6 flex items-center gap-4 p-5 ${ready ? 'border-good/40' : ''}`}>
            <span className="relative flex h-3 w-3">
              {ready && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />}
              <span className={`relative inline-flex h-3 w-3 rounded-full ${ready ? 'bg-good' : status === 'unpaired' ? 'bg-warn' : 'bg-dim'}`} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{ready ? '本地 agent 已连接' : status === 'unpaired' ? 'agent 在运行，但这个浏览器还没配对' : '等待本地 agent…'}</div>
              <div className="text-xs text-dim">
                {ready
                  ? `v${health?.version} · 教练 skills ${health?.skills?.source === 'synced' ? `已同步 ${health.skills.version}` : '安装包自带'}`
                  : status === 'unpaired'
                    ? `在终端运行 ${AGENT_CMD} pair，会自动打开配对链接`
                    : '在电脑终端运行上面的启动命令后，这里会自动变成「已连接」。需要 Node.js 20+。'}
              </div>
            </div>
            {!ready && <Loader2 size={16} className="animate-spin text-dim" />}
          </motion.div>

          <div className="card mt-4 p-5">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <Power size={14} className="text-acid" /> 可选：开机自动运行
            </div>
            <p className="mb-3 text-sm text-mute">注册为后台服务（macOS 登录项 / Linux systemd 用户服务），以后打开网页就能直接用。</p>
            <Cmd cmd={`${AGENT_CMD} install`} hint="后台 + 开机自启" />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Cmd cmd={`${AGENT_CMD} status`} />
              <Cmd cmd={`${AGENT_CMD} uninstall`} />
            </div>
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-line p-4 text-xs text-mute">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-cyan" />
            <div>
              安全：agent 只监听 127.0.0.1，只接受 LiftLens 网页的请求，并校验配对码。配对码通过链接的 <code className="font-mono">#</code> 片段传给浏览器，不会发到托管网页的服务器。
              每次点评只把测量数据和几张关键帧交给你选的 agent，结束后立即删除临时文件。
            </div>
          </div>

          <button onClick={() => setManual((m) => !m)} className="mt-6 flex items-center gap-1 text-sm text-dim hover:text-fg">
            <ChevronDown size={14} className={`transition-transform ${manual ? 'rotate-180' : ''}`} /> 手动配对 / 高级设置
          </button>
          <AnimatePresence>
            {manual && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="card mt-3 grid grid-cols-1 gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <input className="input font-mono" value={u} onChange={(e) => setU(e.target.value)} aria-label="agent 地址" />
                  <input className="input font-mono" placeholder="配对码（~/.liftlens/token）" value={t} onChange={(e) => setT(e.target.value.trim())} aria-label="配对码" />
                  <button className="btn-acid" onClick={() => save(u, t).then(() => toast(useAgent.getState().status === 'ready' ? '已连接' : '连接失败，请检查地址和配对码'))}>
                    连接
                  </button>
                  <button onClick={() => check()} className="flex items-center gap-1 text-xs text-dim hover:text-fg sm:col-span-3">
                    <RefreshCw size={12} /> 重新检测
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}
