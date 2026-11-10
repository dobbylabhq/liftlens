import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Check, CloudDownload, Cpu, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { POSE_MODELS, deleteModel, downloadModel, isModelCached, type PoseModelId } from '../lib/pose'
import { setSetting } from '../lib/db'

/** Choose the pose model; models download on demand and are cached locally. */
export function ModelPicker({ value, onChange }: { value: PoseModelId; onChange: (id: PoseModelId) => void }) {
  const [cached, setCached] = useState<Record<string, boolean>>({})
  const [progress, setProgress] = useState<Record<string, number>>({})

  const refresh = async () => {
    const entries = await Promise.all((Object.keys(POSE_MODELS) as PoseModelId[]).map(async (id) => [id, await isModelCached(id)] as const))
    setCached(Object.fromEntries(entries))
  }
  useEffect(() => {
    refresh()
  }, [])

  const pick = async (id: PoseModelId) => {
    onChange(id)
    setSetting('poseModel', id)
    if (cached[id]) return
    try {
      await downloadModel(id, (p) => setProgress((s) => ({ ...s, [id]: p })))
      toast.success(`${POSE_MODELS[id].label}模型已下载并缓存到本地`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setProgress((s) => ({ ...s, [id]: 0 }))
      refresh()
    }
  }

  return (
    <div className="card space-y-3 p-5">
      <div className="kicker flex items-center gap-1.5">
        <Cpu size={12} /> 识别模型 · 按需下载
      </div>
      {(Object.keys(POSE_MODELS) as PoseModelId[]).map((id) => {
        const m = POSE_MODELS[id]
        const p = progress[id] ?? 0
        const active = value === id
        return (
          <div
            key={id}
            role="button"
            tabIndex={0}
            onClick={() => pick(id)}
            onKeyDown={(e) => e.key === 'Enter' && pick(id)}
            className={`relative cursor-pointer overflow-hidden rounded-xl border p-3 transition-colors ${active ? 'border-acid/60 bg-acid/5' : 'border-line hover:border-line-2'}`}
          >
            {p > 0 && <motion.div className="absolute inset-y-0 left-0 bg-acid/15" animate={{ width: `${p * 100}%` }} />}
            <div className="relative flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className={`shrink-0 whitespace-nowrap font-semibold ${active ? 'text-acid' : ''}`}>{m.label}</span>
              <span className="order-last w-full font-mono text-[11px] text-dim sm:order-none sm:w-auto">{m.engine === 'rtmo' ? 'OpenMMLab' : 'MediaPipe'} · {m.sizeMB}MB · {m.license}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px]">
                {p > 0 ? (
                  <span className="font-mono text-acid">{Math.round(p * 100)}%</span>
                ) : cached[id] ? (
                  <>
                    <span className="flex items-center gap-1 text-good">
                      <Check size={12} /> 已缓存
                    </span>
                    <button
                      aria-label="删除缓存"
                      className="ml-1 text-dim hover:text-bad"
                      onClick={async (e) => {
                        e.stopPropagation()
                        await deleteModel(id)
                        refresh()
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                ) : (
                  <span className="flex items-center gap-1 text-mute">
                    <CloudDownload size={12} /> 点选后下载
                  </span>
                )}
              </span>
            </div>
            <div className="relative mt-1 text-xs text-mute">{m.note}</div>
          </div>
        )
      })}
      <p className="text-[11px] text-dim">MediaPipe 模型从 Google 官方存储下载，RTMO 从 Hugging Face（Xenova/RTMO-*）下载，都只在选中时下载，并缓存到浏览器 Cache Storage；视频本身不会上传。</p>
    </div>
  )
}
