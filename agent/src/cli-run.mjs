// Coach review through a coding-agent CLI the user is already logged into (Gemini CLI, Qwen Code,
// OpenCode…), run headless. These CLIs have no structured-output flag, so the coach skill, the
// payload and the JSON Schema all go into the prompt; key frames are attached as files; the JSON
// is extracted from whatever text comes back and validated locally (one repair round).

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildSystem, extractJson, looksValid } from './ai-run.mjs'
import { runtimeById } from './runtimes.mjs'

const TIMEOUT_MS = 6 * 60 * 1000

function run(bin, args, cwd, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: { ...process.env, NO_COLOR: '1', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), TIMEOUT_MS)
    signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true })
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`无法启动 ${bin}：${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out, err })
    })
  })
}

/** the last balanced {...} block in the text that parses — CLIs often print chatter around the answer */
function lastJson(text) {
  try {
    return extractJson(text)
  } catch {
    /* fall through */
  }
  for (let e = text.lastIndexOf('}'); e > 0; e = text.lastIndexOf('}', e - 1)) {
    let depth = 0
    for (let s = e; s >= 0; s--) {
      if (text[s] === '}') depth++
      else if (text[s] === '{' && --depth === 0) {
        try {
          return JSON.parse(text.slice(s, e + 1))
        } catch {
          break
        }
      }
    }
  }
  return null
}

/**
 * @param {{ runtimeId:string, coachesDir:string, coachId:string, kind:'session'|'progress', payload:object,
 *           images:{name:string, data:Buffer, mediaType:string}[], schema:object, sourceIds:string[],
 *           signal?:AbortSignal, onStatus:(text:string)=>void }} o
 */
export async function runWithCli(o) {
  const r = runtimeById(o.runtimeId)
  const d = await r.detect()
  if (!d.ok) throw new Error(`${r.label} 不可用：${d.reason}`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liftlens-'))
  try {
    const files = o.images.map((img, i) => {
      const f = path.join(dir, `${String(i + 1).padStart(2, '0')}-${img.name.replace(/[^\w.-]/g, '_')}.${img.mediaType.split('/')[1].replace('jpeg', 'jpg')}`)
      fs.writeFileSync(f, img.data)
      return f
    })
    const prompt = [
      buildSystem(o.coachesDir, o.coachId),
      '\n\n---\n',
      o.kind === 'session' ? '请以你的教练身份分析这次训练视频的动作质量。' : '请以你的教练身份分析这位用户一段时间的训练记录，评估能力变化并给出计划。',
      files.length ? `附带的图片是关键帧（已叠加骨架和杠铃轨迹），依次为：${o.images.map((i) => i.name).join('、')}。` : '本次没有关键帧，只基于数据分析。',
      '程序指标来自单目 2D 姿态估计，可能因遮挡失真：请用关键帧交叉核对，不一致的写进 metricDisagreements。',
      `引用依据时 sourceIds 只能使用以下 id：${o.sourceIds.join(', ')}。`,
      '全部用简体中文。不要修改或创建任何文件，不要运行命令。',
      `最后只输出一个 JSON 对象（不要代码块标记、不要解释），必须符合这个 JSON Schema：\n${JSON.stringify(o.schema)}`,
      `\n<payload>\n${JSON.stringify(o.payload, null, 2)}\n</payload>`,
    ].join('\n')
    const started = Date.now()
    let ask = prompt
    let last = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      o.onStatus(attempt ? '结果不符合格式，让它修正一次…' : `调用 ${r.label}（${files.length} 张关键帧），教练分析中…`)
      const res = await run(d.path, r.args({ prompt: ask, files, model: readModel(o.runtimeId, d) }), dir, o.signal)
      if (o.signal?.aborted) throw new Error('已取消')
      last = res.out
      const obj = lastJson(res.out)
      if (looksValid(obj, o.schema)) return { output: obj, durationMs: Date.now() - started, modelId: d.model, label: r.label }
      if (res.code !== 0 && !res.out.trim()) throw new Error(`${r.label} 退出码 ${res.code}：${res.err.slice(-500) || '没有输出'}`)
      ask = `${prompt}\n\n你上一次的输出不是符合 Schema 的 JSON（缺字段或枚举值不对）：\n${res.out.slice(-4000)}\n\n请只输出修正后的完整 JSON 对象。`
    }
    throw new Error(`${r.label} 没有返回有效的结构化结果：${last.slice(-300)}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** only pass --model when the user chose one (the detect() placeholder is just a label) */
function readModel(id, d) {
  return d.model && !d.model.endsWith('默认模型') ? d.model : null
}
