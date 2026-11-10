import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { Bot, Copy, FileImage, FileText, Loader2, Square, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { COACHES } from '../lib/coaches'
import { AGENT_CMD, runAgent, useAgent, type AgentEvent } from '../lib/agent'
import { RuntimeSwitch } from './RuntimePicker'
import { isConfigured, providerById, runCloud, useCloudConfigs, useCoachEngine } from '../lib/cloud'
import { setSetting } from '../lib/db'

const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches


interface LogLine {
  id: number
  kind: 'status' | 'tool' | 'text'
  text: string
}

/** Pick a coach skill, stream the local agent run, hand the structured result to the parent. */
export function CoachPanel({
  kind,
  coachId,
  onCoach,
  build,
  onResult,
  cta = '请教练点评',
}: {
  kind: 'session' | 'progress'
  coachId: string
  onCoach: (id: string) => void
  build: () => Promise<{ payload: unknown; images: { name: string; dataUrl: string }[] }>
  onResult: (output: unknown, meta: { costUsd: number | null; durationMs: number | null; coachId: string }) => void
  cta?: string
}) {
  const status = useAgent((s) => s.status)
  const relayAgentOffline = useAgent((s) => s.relayAgentOffline)
  const engine = useCoachEngine()
  const configs = useCloudConfigs()
  const navigate = useNavigate()
  const cloud = engine?.mode === 'cloud' ? providerById(engine.provider) : undefined
  const cloudReady = !!cloud && isConfigured(cloud, configs[cloud.id])
  const canRun = cloud ? cloudReady : status === 'ready'
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<LogLine[]>([])
  const ac = useRef<AbortController | null>(null)
  const seq = useRef(0)

  const push = (e: AgentEvent) => {
    if (e.type === 'result' || e.type === 'error') return
    const text = e.type === 'tool' ? `读取 ${e.file}` : e.text
    setLog((l) => [...l.slice(-30), { id: seq.current++, kind: e.type, text }])
  }

  const start = async () => {
    setRunning(true)
    setLog([])
    ac.current = new AbortController()
    try {
      const req = await build()
      push({ type: 'status', stage: 'prep', text: `准备了 ${req.images.length} 张关键帧和测量数据` })
      const res = cloud ? await runCloud(cloud.id, { kind, coachId, ...req }, push, ac.current.signal) : await runAgent({ kind, coachId, ...req }, push, ac.current.signal)
      onResult(res.output, { costUsd: res.costUsd, durationMs: res.durationMs, coachId: res.coachId })
      toast.success('教练点评完成')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line p-4">
        <div className="kicker mb-3 flex items-center gap-1.5">
          <Bot size={12} /> 选择教练 skill
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {COACHES.map((c) => {
            const active = c.id === coachId
            return (
              <button
                key={c.id}
                onClick={() => {
                  onCoach(c.id)
                  setSetting('defaultCoach', c.id)
                }}
                disabled={running}
                className={`relative rounded-xl border p-2.5 text-left transition-colors ${active ? 'border-transparent' : 'border-line hover:border-line-2'}`}
              >
                {active && (
                  <motion.span
                    layoutId={`coach-${kind}`}
                    className="absolute inset-0 rounded-xl border"
                    style={{ borderColor: c.accent, background: `${c.accent}12` }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
                <span className="relative block text-sm font-semibold" style={{ color: active ? c.accent : undefined }}>
                  {c.flag} {c.displayName}
                </span>
                <span className="relative block truncate text-[11px] text-dim">{c.school}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-4">
        {cloud && !cloudReady ? (
          <div className="space-y-3 text-sm">
            <p className="text-mute">还没有填写 {cloud.label} 的 API key 和模型。</p>
            <Link to="/agent#runtimes" className="btn-acid h-10 w-full">
              去设置
            </Link>
          </div>
        ) : !canRun && (TOUCH || relayAgentOffline) ? (
          <div className="space-y-3 text-sm">
            <p className="text-mute">
              {relayAgentOffline ? '连接的电脑现在不在线（睡眠了或 agent 没在运行）。' : '在手机上点评：连接你电脑上的 agent，或填一个云端 API key。'}
            </p>
            <Link to="/agent#runtimes" className="btn-acid h-10 w-full">
              {relayAgentOffline ? '查看连接 / 改用云端 API' : '去设置'}
            </Link>
          </div>
        ) : !canRun ? (
          <div className="space-y-3 text-sm">
            <p className="text-mute">
              {status === 'unpaired'
                ? '本地 agent 在运行，但这个浏览器还没配对。'
                : '启动本地 agent 就能请教练点评（程序测量结果不受影响）。在电脑终端运行：'}
            </p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(status === 'unpaired' ? `${AGENT_CMD} pair` : AGENT_CMD)
                toast.success('已复制，粘贴到终端运行')
              }}
              className="flex w-full min-w-0 items-start gap-2 rounded-xl border border-line bg-ink-2 px-3 py-2.5 text-left font-mono text-xs leading-relaxed text-acid hover:border-acid/50"
            >
              <span className="shrink-0 text-dim">$</span>
              {/* Long URLs have no spaces to break on: break-all lets them wrap anywhere inside the box */}
              <span className="min-w-0 flex-1 break-all">{status === 'unpaired' ? `${AGENT_CMD} pair` : AGENT_CMD}</span>
              <Copy size={13} className="mt-0.5 shrink-0 text-dim" />
            </button>
            <Link to="/agent#runtimes" className={`block rounded-xl border px-3 py-2.5 text-xs hover:border-acid/50 ${TOUCH ? 'border-acid/40 text-fg' : 'border-line text-mute'}`}>
              {TOUCH ? '在手机上？' : '不想装本地 agent？'}改用<b className="font-medium text-acid">云端 API</b>：填你自己的 key（Claude、OpenAI、通义千问、DeepSeek 等）就能直接点评 →
            </Link>
          </div>
        ) : running ? (
          <button className="btn-ghost h-10 w-full" onClick={() => ac.current?.abort()}>
            <Square size={14} /> 停止
          </button>
        ) : (
          <>
            <button className="btn-acid h-11 w-full" onClick={start}>
              <Sparkles size={16} /> {cta}
            </button>
            <div className="mt-2 text-center text-[11px] text-dim">
              <RuntimeSwitch onManage={() => navigate('/agent#runtimes')} />
            </div>
          </>
        )}

        <AnimatePresence>
          {(running || log.length > 0) && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mt-4 overflow-hidden rounded-xl border border-line bg-ink-2"
            >
              <div className="max-h-56 space-y-1 overflow-y-auto p-3 font-mono text-[11.5px]">
                <AnimatePresence initial={false}>
                  {log.map((l) => (
                    <motion.div
                      key={l.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`flex gap-2 ${l.kind === 'tool' ? 'text-cyan' : l.kind === 'text' ? 'text-fg' : 'text-dim'}`}
                    >
                      {l.kind === 'tool' ? (
                        l.text.endsWith('.json') ? <FileText size={12} className="mt-0.5 shrink-0" /> : <FileImage size={12} className="mt-0.5 shrink-0" />
                      ) : (
                        <span className="shrink-0">›</span>
                      )}
                      <span className="whitespace-pre-wrap">{l.text}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {running && (
                  <div className="flex items-center gap-2 text-acid">
                    <Loader2 size={12} className="animate-spin" /> 教练分析中…（通常 30–90 秒）
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
