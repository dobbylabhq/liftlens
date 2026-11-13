import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Cloud, Copy, Cpu, ExternalLink, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { AGENT_CMD, fetchRuntimes, setRuntime, useAgent, type RuntimeInfo } from '../lib/agent'
import {
  PROVIDERS,
  getCloudConfig,
  isConfigured,
  listModels,
  providerById,
  saveCloudConfig,
  setEngine,
  useCloudConfigs,
  useCoachEngine,
  type CloudConfig,
} from '../lib/cloud'

export type Mode = 'cloud' | 'agent'

/** phones / tablets: the local agent needs a computer with a terminal */
const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

/** Agents / local models that run through the LiftLens local agent on a computer. */
const LOCAL: { id: string; label: string; note: string; setup: string[] }[] = [
  { id: 'claude-code', label: 'Claude Code', note: '用你的 Claude 订阅', setup: ['npm i -g @anthropic-ai/claude-code', 'claude'] },
  { id: 'codex', label: 'Codex CLI', note: '用你的 ChatGPT 订阅', setup: ['npm i -g @openai/codex', 'codex login'] },
  { id: 'gemini-cli', label: 'Gemini CLI', note: 'Google 账号免费额度', setup: ['npm i -g @google/gemini-cli', 'gemini'] },
  { id: 'qwen-code', label: 'Qwen Code', note: '通义账号免费额度', setup: ['npm i -g @qwen-code/qwen-code', 'qwen'] },
  { id: 'opencode', label: 'OpenCode', note: '用它里面配置好的模型', setup: ['npm i -g opencode-ai', 'opencode auth login'] },
  { id: 'ollama', label: 'Ollama', note: '完全离线，需要能看图的模型', setup: ['ollama pull qwen2.5vl'] },
  { id: 'lmstudio', label: 'LM Studio', note: '完全离线：在 LM Studio 里启动服务器，选一个能看图的模型', setup: [`${AGENT_CMD} use lmstudio --model <模型名>`] },
  { id: 'glm', label: '智谱 GLM', note: '智谱的接口不允许浏览器直连，所以经本地 agent 调用', setup: [`${AGENT_CMD} use glm --key <API Key> --model <模型>`] },
]
const localLabel = (id: string) => LOCAL.find((l) => l.id === id)?.label ?? id

function CopyLine({ cmd }: { cmd: string }) {
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(cmd)
        toast.success('已复制，粘贴到终端运行')
      }}
      className="group flex w-full min-w-0 items-start gap-2 rounded-lg border border-line bg-ink-2 px-3 py-2 text-left font-mono text-xs leading-relaxed text-acid hover:border-acid/50"
    >
      <span className="shrink-0 text-dim">$</span>
      <span className="min-w-0 flex-1 break-all">{cmd}</span>
      <Copy size={12} className="mt-0.5 shrink-0 text-dim group-hover:text-fg" />
    </button>
  )
}

function Chips<T extends string>({ items, value, onPick, mark }: { items: { id: T; label: string }[]; value: T; onPick: (id: T) => void; mark: (id: T) => 'current' | 'ready' | null }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist">
      {items.map((it) => {
        const m = mark(it.id)
        const on = it.id === value
        return (
          <button
            key={it.id}
            role="tab"
            aria-selected={on}
            onClick={() => onPick(it.id)}
            className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
              on ? 'border-acid/60 bg-acid/10 text-fg' : 'border-line text-mute hover:border-line-2 hover:text-fg'
            }`}
          >
            {m && <span className={`h-1.5 w-1.5 rounded-full ${m === 'current' ? 'bg-acid' : 'bg-good/70'}`} />}
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

/** Who writes the coach review: a cloud API straight from this browser, or the local agent on a computer. */
export function CoachEnginePicker({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  const engine = useCoachEngine()
  const configs = useCloudConfigs()
  const status = useAgent((s) => s.status)
  const health = useAgent((s) => s.health)
  const check = useAgent((s) => s.check)
  const [live, setLive] = useState<RuntimeInfo[] | null>(null)
  const ready = status === 'ready'
  useEffect(() => {
    if (ready) fetchRuntimes().then(setLive).catch(() => setLive(null))
  }, [ready, health?.runtime])

  const currentCloud = engine?.mode === 'cloud' ? engine.provider : null
  const currentLocal = engine?.mode === 'agent' && ready ? (health?.runtime ?? 'claude-code') : null
  const [cloudSel, setCloudSel] = useState<string | null>(null)
  const [localSel, setLocalSel] = useState<string | null>(null)
  const cloudId = cloudSel ?? currentCloud ?? 'anthropic'
  const localId = localSel ?? currentLocal ?? 'claude-code'

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border border-line bg-ink-2 p-1" role="tablist">
        {(['cloud', 'agent'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => onMode(m)}
            className={`rounded-xl px-3 py-2 text-left transition-colors ${mode === m ? 'bg-panel-2' : 'hover:bg-panel/60'}`}
          >
            <span className={`flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold ${mode === m ? 'text-fg' : 'text-mute'}`}>
              {m === 'cloud' ? <Cloud size={14} /> : <Cpu size={14} />}
              {m === 'cloud' ? '云端 API' : '本地 agent'}
              {(m === 'cloud' ? currentCloud : currentLocal) && <span className="h-1.5 w-1.5 rounded-full bg-acid" />}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-dim">{m === 'cloud' ? '填 API key 就能用，手机也行' : TOUCH ? '需要在电脑上打开这个网页' : '用电脑上已登录的 Claude Code 等'}</span>
          </button>
        ))}
      </div>

      {mode === 'cloud' ? (
        <>
          <Chips
            items={PROVIDERS.map((p) => ({ id: p.id, label: p.label }))}
            value={cloudId}
            onPick={setCloudSel}
            mark={(id) => (id === currentCloud ? 'current' : isConfigured(providerById(id)!, configs[id]) ? 'ready' : null)}
          />
          <CloudForm key={cloudId} providerId={cloudId} current={cloudId === currentCloud} />
        </>
      ) : (
        <>
          {TOUCH && (
            <p className="mb-3 rounded-xl border border-warn/40 px-3 py-2.5 text-xs leading-relaxed text-mute">
              本地 agent 只能在<b className="font-medium text-fg">同一台电脑</b>的浏览器里使用（网页直接访问本机 127.0.0.1）。在手机上请改用<b className="font-medium text-fg">云端 API</b>。
            </p>
          )}
          <Chips
            items={LOCAL.map((l) => ({ id: l.id, label: l.label }))}
            value={localId}
            onPick={setLocalSel}
            mark={(id) => (id === currentLocal ? 'current' : live?.find((r) => r.id === id)?.available ? 'ready' : null)}
          />
          <LocalPanel
            key={localId}
            id={localId}
            info={live?.find((r) => r.id === localId)}
            ready={ready}
            current={localId === currentLocal}
            onUse={async () => {
              try {
                await setRuntime(localId)
                await setEngine({ mode: 'agent' })
                await check()
                toast.success(`以后由「${localLabel(localId)}」来点评`)
              } catch (e) {
                toast.error((e as Error).message)
              }
            }}
          />
        </>
      )}
    </div>
  )
}

function CloudForm({ providerId, current }: { providerId: string; current: boolean }) {
  const p = providerById(providerId)!
  const [cfg, setCfg] = useState<CloudConfig>({ apiKey: '', model: p.defaultModel ?? '', baseURL: p.baseURL })
  const [show, setShow] = useState(false)
  const [models, setModels] = useState<string[] | null>(null)
  const [busy, setBusy] = useState<'models' | 'save' | null>(null)
  useEffect(() => {
    getCloudConfig(p.id).then((c) => c && setCfg((x) => ({ ...x, ...c })))
  }, [p.id])
  const ok = isConfigured(p, cfg)
  const listId = `models-${p.id}`

  const loadModels = async () => {
    setBusy('models')
    try {
      const list = await listModels(p, cfg)
      setModels(list)
      toast.success(`key 有效，读到 ${list.length} 个模型`)
      if (!cfg.model && list.length) setCfg((c) => ({ ...c, model: list[0] }))
    } catch (e) {
      toast.error((e as Error).message === 'Failed to fetch' ? `连不上 ${p.label}（网络问题，或该服务不允许浏览器直接访问）` : (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-xl border border-line p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-semibold">{p.label}</span>
        {current && (
          <span className="chip h-5 border-acid/50 px-1.5 text-[10px] text-acid">
            <Check size={10} /> 正在使用
          </span>
        )}
        {p.note && <span className="text-xs text-mute">{p.note}</span>}
      </div>
      <div className="grid gap-3">
        {p.id === 'custom' && (
          <label>
            <span className="mb-1 block text-xs text-mute">接口地址（Base URL）</span>
            <input className="input font-mono" placeholder="https://.../v1" value={cfg.baseURL ?? ''} onChange={(e) => setCfg({ ...cfg, baseURL: e.target.value.trim() })} />
          </label>
        )}
        <label>
          <span className="mb-1 flex items-center justify-between text-xs text-mute">
            API Key
            {p.keyUrl && (
              <a href={p.keyUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-dim hover:text-fg">
                去 {p.label} 获取 <ExternalLink size={11} />
              </a>
            )}
          </span>
          <span className="relative block">
            {/* type=text + CSS masking: a password field makes Safari / password managers offer to save it as a login */}
            <input
              className="input pr-10 font-mono"
              type="text"
              style={show ? undefined : ({ WebkitTextSecurity: 'disc' } as React.CSSProperties)}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              data-1p-ignore
              data-lpignore="true"
              spellCheck={false}
              placeholder={p.keyPlaceholder}
              value={cfg.apiKey}
              onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value.trim() })}
            />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-dim hover:text-fg" aria-label={show ? '隐藏' : '显示'}>
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </span>
        </label>
        <label>
          <span className="mb-1 block text-xs text-mute">模型{p.noImages ? '' : '（要能看图）'}</span>
          <span className="flex gap-2">
            <input className="input min-w-0 flex-1 font-mono" list={listId} placeholder="填写或从列表选择" value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value.trim() })} />
            <button className="btn-ghost h-11 shrink-0 px-3 text-sm" disabled={!cfg.apiKey || busy !== null} onClick={loadModels}>
              {busy === 'models' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 读取列表
            </button>
          </span>
          <datalist id={listId}>{models?.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <button
          className="btn-acid h-11"
          disabled={!ok || busy !== null}
          onClick={async () => {
            setBusy('save')
            try {
              await saveCloudConfig(p.id, cfg)
              await setEngine({ mode: 'cloud', provider: p.id })
              toast.success(`以后由「${p.label} · ${cfg.model}」来点评`)
            } finally {
              setBusy(null)
            }
          }}
        >
          {current ? '保存' : '保存并使用'}
        </button>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-dim">
        key 只保存在这个浏览器里（和训练记录在一起），点评时由浏览器直接发给 {p.label}，不经过 LiftLens 的服务器。换设备或换浏览器需要重新填写。
      </p>
    </motion.div>
  )
}

function LocalPanel({ id, info, ready, current, onUse }: { id: string; info?: RuntimeInfo; ready: boolean; current: boolean; onUse: () => void }) {
  const l = LOCAL.find((x) => x.id === id)!
  const usable = !!info?.available
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-xl border border-line p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-semibold">{l.label}</span>
        {current && (
          <span className="chip h-5 border-acid/50 px-1.5 text-[10px] text-acid">
            <Check size={10} /> 正在使用
          </span>
        )}
        {info && !info.verified && info.available && <span className="chip h-5 px-1.5 text-[10px]">未实测</span>}
        <span className="text-xs text-mute">{l.note}</span>
      </div>
      <ol className="space-y-3 text-sm">
        <li>
          <div className="mb-1.5 text-xs text-mute">1. 在电脑终端里装好并登录（已经装过可以跳过）</div>
          <div className="space-y-1.5">
            {l.setup.map((c) => (
              <CopyLine key={c} cmd={c} />
            ))}
          </div>
        </li>
        <li>
          <div className="mb-1.5 text-xs text-mute">
            2. 在电脑上启动 LiftLens 本地 agent{ready ? '（已连接 ✓）' : '，它会自动和这个页面配对'}
          </div>
          {!ready && <CopyLine cmd={AGENT_CMD} />}
        </li>
      </ol>
      <AnimatePresence>
        {ready && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-acid h-10" disabled={!usable || current} onClick={onUse}>
              {current ? '正在使用' : `使用 ${l.label}`}
            </button>
            {info && !usable && <span className="text-xs text-warn">{info.reason}</span>}
            {info?.available && <span className="font-mono text-[11px] text-dim">{info.model}</span>}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/** Compact switcher next to the "ask the coach" button: everything that's ready right now. */
export function RuntimeSwitch({ onManage }: { onManage: () => void }) {
  const engine = useCoachEngine()
  const configs = useCloudConfigs()
  const status = useAgent((s) => s.status)
  const runtime = useAgent((s) => s.health?.runtime)
  const check = useAgent((s) => s.check)
  const [live, setLive] = useState<RuntimeInfo[] | null>(null)
  useEffect(() => {
    if (status === 'ready') fetchRuntimes().then(setLive).catch(() => setLive(null))
  }, [status, runtime])
  const cloud = useMemo(() => PROVIDERS.filter((p) => isConfigured(p, configs[p.id])), [configs])
  const local = (live ?? []).filter((r) => r.available && LOCAL.some((l) => l.id === r.id))
  const value = engine?.mode === 'cloud' ? `cloud:${engine.provider}` : `agent:${runtime ?? 'claude-code'}`
  const label = (v: string) => (v.startsWith('cloud:') ? (providerById(v.slice(6))?.label ?? v) : localLabel(v.slice(6)))

  return (
    <label className="inline-flex items-center gap-1">
      由
      <select
        className="max-w-[12rem] truncate rounded-md border border-line bg-ink-2 px-1.5 py-0.5 text-[11px] text-fg focus:border-acid focus:outline-none"
        value={value}
        aria-label="由谁来点评"
        onChange={async (e) => {
          const v = e.target.value
          if (v === '__more') return onManage()
          try {
            if (v.startsWith('cloud:')) await setEngine({ mode: 'cloud', provider: v.slice(6) })
            else {
              await setRuntime(v.slice(6))
              await setEngine({ mode: 'agent' })
              await check()
            }
            toast.success(`以后由「${label(v)}」来点评`)
          } catch (err) {
            toast.error((err as Error).message)
          }
        }}
      >
        {![...cloud.map((p) => `cloud:${p.id}`), ...local.map((r) => `agent:${r.id}`)].includes(value) && <option value={value}>{label(value)}</option>}
        {cloud.length > 0 && (
          <optgroup label="云端 API">
            {cloud.map((p) => (
              <option key={p.id} value={`cloud:${p.id}`}>
                {p.label} · {configs[p.id]?.model}
              </option>
            ))}
          </optgroup>
        )}
        {local.length > 0 && (
          <optgroup label="本地 agent">
            {local.map((r) => (
              <option key={r.id} value={`agent:${r.id}`}>
                {localLabel(r.id)}
              </option>
            ))}
          </optgroup>
        )}
        <option value="__more">添加 / 管理…</option>
      </select>
      点评
    </label>
  )
}
