import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Laptop, Link2, Loader2, Smartphone, Unlink } from 'lucide-react'
import { toast } from 'sonner'
import { fetchRelayInfo, useAgent, type RelayInfo } from '../lib/agent'
import { parseCode, relayAvailable } from '../lib/relay'

/** On the computer (agent connected locally): a QR code a phone scans to use this computer's agent. */
export function PhoneQR() {
  const [info, setInfo] = useState<RelayInfo | null>(null)
  const [svg, setSvg] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    const load = () =>
      fetchRelayInfo()
        .then(async (i) => {
          if (!alive) return
          setInfo(i)
          setSvg(await QRCode.toString(i.link, { type: 'svg', margin: 1, errorCorrectionLevel: 'L', color: { dark: '#0b0d0c', light: '#ffffff' } }))
        })
        .catch(() => alive && setErr('这个版本的 agent 还不支持手机连接，请重新运行一次启动命令更新'))
    load()
    const t = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  if (err) return <p className="text-xs text-warn">{err}</p>
  if (!info) return <Loader2 size={14} className="animate-spin text-dim" />
  if (!info.enabled) return <p className="text-xs text-mute">这个 agent 没有开启手机中继（LIFTLENS_RELAY=0 或没有配置站点地址）。</p>
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="h-40 w-40 shrink-0 overflow-hidden rounded-xl bg-white p-1.5" dangerouslySetInnerHTML={{ __html: svg }} aria-label="手机连接二维码" />
      <div className="min-w-0 space-y-2 text-sm">
        <p className="text-mute">
          用<b className="font-medium text-fg">手机相机</b>扫这个二维码，手机上的 LiftLens 就能用这台电脑上的 agent 点评。手机和电脑不需要在同一个网络。
        </p>
        <p className="flex items-center gap-1.5 text-xs">
          <span className={`h-1.5 w-1.5 rounded-full ${info.connected ? 'bg-good' : 'bg-warn'}`} />
          {info.connected ? `中继已连接${info.phones ? ` · ${info.phones} 台手机在线` : ''}` : '正在连接中继…'}
        </p>
        <p className="text-[11px] leading-relaxed text-dim">
          端到端加密：中继只转发看不懂的密文。二维码等同于密码，不要发给别人；想作废旧的，在终端运行 agent 命令加 <code className="font-mono">phone --rotate</code>。
        </p>
      </div>
    </div>
  )
}

/** On the phone: link to a computer by scanning its QR code (system camera) or pasting the code. */
export function ConnectComputer() {
  const { status, via, relayCode, relayAgentOffline, health, saveRelay, forgetRelay } = useAgent()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  if (!relayAvailable) return <p className="text-xs text-dim">本地开发环境没有配置中继地址（VITE_RELAY_ORIGIN）。</p>

  if (relayCode) {
    const online = via === 'relay' && status === 'ready'
    return (
      <div className="rounded-xl border border-line p-3">
        <div className="flex items-center gap-2 text-sm">
          <Laptop size={15} className={online ? 'text-good' : 'text-dim'} />
          <span className="font-semibold">{online ? '已连接电脑' : relayAgentOffline ? '电脑不在线' : '正在连接电脑…'}</span>
          {online && <Check size={13} className="text-good" />}
          <button onClick={() => forgetRelay().then(() => toast('已断开这台电脑'))} className="ml-auto flex items-center gap-1 text-xs text-dim hover:text-fg">
            <Unlink size={12} /> 断开
          </button>
        </div>
        <p className="mt-1 text-xs text-mute">
          {online
            ? `点评由电脑上的 agent 完成（v${health?.version ?? '?'}）。下面可以选用哪个 agent。`
            : '电脑可能睡眠了或 agent 没在运行。打开电脑、运行 agent（建议设置开机自启）后会自动连上。'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-line p-3 text-sm">
      <div className="flex items-center gap-2 font-semibold">
        <Smartphone size={15} className="text-acid" /> 连接你的电脑
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-mute">
        <li>在电脑上启动 LiftLens agent，并在电脑浏览器打开 LiftLens 的「AI 教练 › 本地 agent」</li>
        <li>用手机相机扫电脑上显示的二维码，会自动打开 LiftLens 并连好</li>
      </ol>
      <p className="text-xs text-dim">从主屏幕打开的 LiftLens 扫码会跳到 Safari，可以改为把连接码粘贴到这里：</p>
      <div className="flex gap-2">
        <input className="input min-w-0 flex-1 font-mono" placeholder="连接码" value={code} onChange={(e) => setCode(e.target.value.trim().replace(/^.*#relay=/, ''))} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <button
          className="btn-acid h-11 shrink-0 px-4"
          disabled={!parseCode(code) || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await saveRelay(code)
              const s = useAgent.getState()
              toast[s.status === 'ready' ? 'success' : 'message'](s.status === 'ready' ? '已连接电脑' : '已保存；电脑上线后会自动连上')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} 连接
        </button>
      </div>
    </div>
  )
}
