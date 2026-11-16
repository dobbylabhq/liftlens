import { useEffect, useState } from 'react'
import { Download, Share, SquarePlus, X } from 'lucide-react'

/**
 * Suggest "add to home screen" on phones still using the site in a browser tab. Installed, the app
 * runs full screen: no browser toolbar over the content (iOS 26 Safari's glass bars let the page
 * show through), and the camera / rest timer get the whole screen.
 * iOS can't be prompted programmatically, so it gets the Share → Add to Home Screen steps;
 * Chromium browsers fire `beforeinstallprompt`, which we turn into an Install button.
 */

const KEY = 'll-install-hint-dismissed'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const standalone = () =>
  (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches) ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

// iPadOS reports itself as a Mac: tell it apart by touch support
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

const touch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

function dismissed() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function InstallHint() {
  const [ios] = useState(isIOS)
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [hidden, setHidden] = useState(() => standalone() || !touch() || dismissed())

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setHidden(true)
    addEventListener('beforeinstallprompt', onPrompt)
    addEventListener('appinstalled', onInstalled)
    return () => {
      removeEventListener('beforeinstallprompt', onPrompt)
      removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const close = () => {
    setHidden(true)
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* private mode: just hide for this visit */
    }
  }

  // iOS always gets the manual steps; elsewhere only show once the browser offers installing
  if (hidden || (!ios && !prompt)) return null

  return (
    <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 rounded-2xl border border-line-2 bg-panel/95 p-4 shadow-lg backdrop-blur-xl sm:hidden" role="dialog" aria-label="添加到主屏幕">
      <button onClick={close} aria-label="不再提示" className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-dim hover:text-fg">
        <X size={16} />
      </button>
      <div className="pr-8 text-sm font-semibold">添加到主屏幕，像 App 一样用</div>
      {ios ? (
        <p className="mt-1.5 text-xs leading-relaxed text-mute">
          全屏打开，不再被浏览器工具栏挡住。点浏览器的
          <Share size={13} className="mx-1 inline -translate-y-px text-fg" />
          <b className="font-medium text-fg">分享</b>，再选
          <SquarePlus size={13} className="mx-1 inline -translate-y-px text-fg" />
          <b className="font-medium text-fg">添加到主屏幕</b>。
          <span className="mt-1.5 block text-[11px] text-dim">
            注意：主屏幕 App 和浏览器里的记录是分开存的。已经有记录的话，先在
            <a href="/journal" className="text-acid">
              训练日志
            </a>
            导出备份，再到 App 里导入。
          </span>
        </p>
      ) : (
        <div className="mt-2 flex items-center gap-3">
          <p className="flex-1 text-xs leading-relaxed text-mute">全屏打开，不再被浏览器工具栏挡住。数据还是只存在这台手机上。</p>
          <button
            className="btn-acid h-9 shrink-0 px-4"
            onClick={async () => {
              await prompt!.prompt()
              const { outcome } = await prompt!.userChoice
              setPrompt(null)
              if (outcome === 'accepted') setHidden(true)
            }}
          >
            <Download size={14} /> 安装
          </button>
        </div>
      )}
    </div>
  )
}
