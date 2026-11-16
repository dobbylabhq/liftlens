import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ShieldCheck } from 'lucide-react'

/** Updated whenever what LiftLens stores or sends changes. Keep README "Privacy" in sync. */
const UPDATED = '2026-11-13'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-mute [&_b]:font-medium [&_b]:text-fg [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">{children}</div>
    </section>
  )
}

export default function Privacy() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="kicker">PRIVACY</div>
      <h1 className="font-display mt-1 text-4xl font-bold tracking-tight">隐私说明</h1>
      <p className="mt-3 text-mute">更新于 {UPDATED}</p>

      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-line p-4 text-sm text-mute">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-cyan" />
        <div>
          一句话：LiftLens <b className="font-medium text-fg">没有账号、没有后端数据库</b>。你的训练数据和视频只存在你自己的浏览器里，我们（网站运营方）看不到，也不收集。
        </div>
      </div>

      <Section title="数据存在哪儿">
        <p>
          下面这些都保存在<b>当前这个浏览器</b>的本地数据库（IndexedDB）里，不会上传到 LiftLens 的服务器：
        </p>
        <ul>
          <li>训练计划和每组记录（重量、次数、时间）</li>
          <li>拍摄或选择的视频、关键帧截图、骨架数据和分析结果</li>
          <li>教练点评、能力报告</li>
          <li>个人资料（身高、体重、训练年限、目标、伤病史），只在你主动填写时才有</li>
          <li>设置，包括你填的云端 API key</li>
        </ul>
        <p>
          这意味着：<b>换手机、换浏览器、用无痕模式，或清除网站数据，记录就会丢失</b>，我们也无法帮你找回。请定期在
          <Link to="/journal" className="text-acid hover:underline">
            训练日志
          </Link>
          里导出备份（JSON 文件，不含视频和 API key），在新设备上导入即可。
        </p>
        <p>
          在 iPhone / iPad 上，<b>添加到主屏幕的 LiftLens 和 Safari 里打开的 LiftLens 也是两份独立的数据</b>，互相看不到。换着用之前，同样用导出 / 导入备份把记录带过去。
        </p>
      </Section>

      <Section title="什么时候数据会离开你的设备">
        <p>只有你请 AI 教练点评时，而且只发给你选的那一方：</p>
        <ul>
          <li>
            <b>云端 API</b>：浏览器直接把测量数据、几张叠加了骨架的关键帧和你填的个人资料，发给你选的厂商（如 Anthropic、OpenAI、通义千问等），用你自己的 API key。不经过 LiftLens 的服务器；这部分数据怎么处理，以该厂商的隐私政策为准。
          </li>
          <li>
            <b>本地 agent</b>：同样的内容发给你自己电脑上运行的 agent（只监听本机 127.0.0.1，需要配对码），再由它调用你电脑上已登录的 Claude Code、Codex 等工具。
          </li>
        </ul>
        <p>
          <b>原始视频永远不会被发送。</b>不请教练点评、或者用「只记录」模式时，没有任何训练数据离开你的设备。
        </p>
      </Section>

      <Section title="网站本身会接触到什么">
        <ul>
          <li>
            网站托管在 Cloudflare 上，只提供网页文件。和访问任何网站一样，Cloudflare 会处理你的 IP 地址等网络请求信息，用于传输和安全防护。
          </li>
          <li>为了让分析在浏览器里运行，页面会从这些公共服务下载模型和字体：Google（MediaPipe 姿态模型、Google Fonts）、jsDelivr、Hugging Face（RTMO 模型）。它们会看到一次普通的下载请求，但拿不到你的训练数据。</li>
          <li>没有统计分析脚本、没有广告、没有 Cookie 追踪。</li>
        </ul>
      </Section>

      <Section title="本地 agent 在你电脑上存了什么">
        <p>
          如果你用了本地 agent，它会在你电脑的 <code className="font-mono text-cyan">~/.liftlens/</code> 目录里保存：配对码、你设置的运行时和 API key（<code className="font-mono">config.json</code>，权限 0600）、教练 skills 缓存和运行日志。删除这个目录即可清除。
        </p>
      </Section>

      <Section title="怎么删除你的数据">
        <ul>
          <li>单条记录：在训练日志里删除。</li>
          <li>全部数据：在浏览器设置里清除本站的网站数据。</li>
          <li>本地 agent：运行 agent 命令加 <code className="font-mono">uninstall</code>，再删除 <code className="font-mono">~/.liftlens/</code>。</li>
        </ul>
      </Section>

      <Section title="开源与自行部署">
        <p>
          LiftLens 是开源软件，以上说法都可以在{' '}
          <a href="https://github.com/dobbylabhq/liftlens" target="_blank" rel="noreferrer" className="text-acid hover:underline">
            源代码
          </a>{' '}
          里核实。使用这个网站时，你在自己电脑上运行的 agent 安装包由本站提供；如果不想信任它，可以下载源代码自己运行或部署。
        </p>
        <p>LiftLens 提供的是训练参考，不构成医疗建议。</p>
      </Section>
    </div>
  )
}
