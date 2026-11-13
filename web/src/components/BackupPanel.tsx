import { useEffect, useRef, useState } from 'react'
import { Download, HardDrive, Loader2, ShieldCheck, Upload } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { downloadBackup, importBackup, requestPersist, storageInfo } from '../lib/backup'

const fmt = (b: number | null) => (b == null ? '—' : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0.1, b / 1e6).toFixed(1)} MB`)

/** Data backup: export / import JSON (no videos), plus browser persistent-storage status */
export function BackupPanel() {
  const [info, setInfo] = useState<{ usage: number | null; persisted: boolean } | null>(null)
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const refresh = () => storageInfo().then(setInfo)
  useEffect(() => {
    refresh()
  }, [])

  return (
    <section className="card mt-12 p-5">
      <div className="kicker mb-1 flex items-center gap-1.5">
        <HardDrive size={12} /> 数据备份
      </div>
      <p className="text-sm text-mute">
        训练记录只存在这个浏览器里。换手机、换电脑或清理浏览器前，先导出一份备份，在新设备上导入即可。
        备份包含训练记录、测量结果、曲线和教练点评，<b className="font-medium text-fg">不含视频和 API key</b>，文件很小。{' '}
        <Link to="/privacy" className="text-acid hover:underline">
          数据存在哪儿？
        </Link>
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="btn-acid"
          disabled={!!busy}
          onClick={async () => {
            setBusy('export')
            try {
              const r = await downloadBackup()
              toast.success(`已导出 ${r.sessions} 条训练记录（${fmt(r.bytes)}）`)
            } catch (e) {
              toast.error(`导出失败：${(e as Error).message}`)
            } finally {
              setBusy(null)
            }
          }}
        >
          {busy === 'export' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} 导出备份
        </button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => input.current?.click()}>
          {busy === 'import' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} 从备份导入
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            setBusy('import')
            try {
              const r = await importBackup(f)
              await requestPersist()
              toast.success(
                r.added
                  ? `导入了 ${r.added} 条训练记录${r.skipped ? `，${r.skipped} 条已存在已跳过` : ''}${r.reports ? `，${r.reports} 份能力报告` : ''}`
                  : `没有新记录（${r.skipped} 条已存在）`,
              )
              refresh()
            } catch (err) {
              toast.error(`导入失败：${(err as Error).message}`)
            } finally {
              setBusy(null)
            }
          }}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-dim">
        <span>本机已用 {fmt(info?.usage ?? null)}（含视频）</span>
        {info &&
          (info.persisted ? (
            <span className="flex items-center gap-1 text-good">
              <ShieldCheck size={12} /> 已开启持久保存，浏览器不会自动清理
            </span>
          ) : (
            <button
              className="underline decoration-dotted underline-offset-2 hover:text-fg"
              onClick={async () => {
                const ok = await requestPersist()
                toast(ok ? '已开启持久保存' : '浏览器暂未同意（常用站点或安装到桌面后通常会同意），记得定期导出备份')
                refresh()
              }}
            >
              未开启持久保存，点此申请
            </button>
          ))}
        <span>导入会合并到现有记录，不会覆盖；agent 配对码不会导出。</span>
      </div>
    </section>
  )
}
