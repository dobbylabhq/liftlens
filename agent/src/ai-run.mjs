// Coach review through the Vercel AI SDK (any runtime except the native Claude Code path).
// Same inputs as the Claude Code path, but everything is inlined into one request:
//   system  = coach SKILL.md + shared protocol + metric glossary + the coach's reference docs
//   user    = instructions + payload JSON + annotated key frames (images)
//   output  = JSON Schema (structured output); providers that can't enforce it get a
//             prompt-level schema + local parse/validate + one repair attempt.

import fs from 'node:fs'
import path from 'node:path'
import { APICallError, LoadAPIKeyError, generateText, jsonSchema, Output } from 'ai'
import { createModel } from './runtimes.mjs'

function readIf(p) {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

export function buildSystem(coachesDir, coachId) {
  const skillDir = path.join(coachesDir, coachId)
  const refs = fs.existsSync(path.join(skillDir, 'references'))
    ? fs
        .readdirSync(path.join(skillDir, 'references'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => `\n\n<reference file="${f}">\n${readIf(path.join(skillDir, 'references', f))}\n</reference>`)
        .join('')
    : ''
  return [
    readIf(path.join(skillDir, 'SKILL.md')),
    `\n\n<shared file="protocol.md">\n${readIf(path.join(coachesDir, '_shared', 'protocol.md'))}\n</shared>`,
    `\n\n<shared file="metrics.md">\n${readIf(path.join(coachesDir, '_shared', 'metrics.md'))}\n</shared>`,
    refs,
  ].join('')
}

/** minimal JSON-Schema check for the fallback path: required keys + enum values (top level and cues) */
export function looksValid(obj, schema) {
  if (!obj || typeof obj !== 'object') return false
  for (const k of schema.required ?? []) if (!(k in obj)) return false
  for (const [k, s] of Object.entries(schema.properties ?? {})) if (s.enum && k in obj && !s.enum.includes(obj[k])) return false
  return true
}
export function extractJson(text) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  return JSON.parse(s >= 0 && e > s ? t.slice(s, e + 1) : t)
}

/**
 * @param {{ runtimeId:string, coachesDir:string, coachId:string, kind:'session'|'progress', payload:object,
 *           images:{name:string, data:Buffer, mediaType:string}[], schema:object, sourceIds:string[],
 *           signal?:AbortSignal, onStatus:(text:string)=>void }} o
 */
export async function runWithAiSdk(o) {
  const { model, modelId, label, noImages } = await createModel(o.runtimeId, o.onStatus)
  o.onStatus(`${label} · ${modelId} 已就绪`)
  // text-only models (e.g. DeepSeek) reject image parts: review from the measurements alone
  if (noImages) o = { ...o, images: [] }
  const system = buildSystem(o.coachesDir, o.coachId)
  const instructions = [
    o.kind === 'session' ? '请以你的教练身份分析这次训练视频的动作质量。' : '请以你的教练身份分析这位用户一段时间的训练记录，评估能力变化并给出计划。',
    noImages
      ? '下面的 payload 是程序测量的指标、规则判定结果和用户信息。这个模型看不了图，本次没有关键帧，只基于数据分析，并在结论里说明没有看画面。'
      : '下面的 payload 是程序测量的指标、规则判定结果和用户信息；之后的图片是关键帧（已叠加骨架和杠铃轨迹），文件名依次为：' +
        (o.images.map((i) => i.name).join('、') || '（无）') + '。',
    '程序指标来自单目 2D 姿态估计，可能因遮挡失真：请用关键帧交叉核对，不一致的写进 metricDisagreements。',
    `引用依据时 sourceIds 只能使用以下 id：${o.sourceIds.join(', ')}。`,
    '全部用简体中文输出。',
    `\n<payload>\n${JSON.stringify(o.payload, null, 2)}\n</payload>`,
  ].join('\n')
  const content = [
    { type: 'text', text: instructions },
    ...o.images.map((img) => ({ type: 'file', mediaType: img.mediaType, data: img.data })),
  ]
  const started = Date.now()
  o.onStatus(`读取 ${o.images.length} 张关键帧与测量数据，教练分析中…`)

  try {
    const res = await generateText({
      model,
      system,
      messages: [{ role: 'user', content }],
      output: Output.object({ schema: jsonSchema(o.schema) }),
      abortSignal: o.signal,
    })
    return { output: res.output, durationMs: Date.now() - started, usage: res.totalUsage ?? res.usage ?? null, modelId, label }
  } catch (err) {
    if (o.signal?.aborted) throw err
    // auth / quota / server / network problems: report as-is, a schema-less retry won't help
    if (LoadAPIKeyError.isInstance(err)) throw new Error(`${label}：没有找到 API key`)
    if (APICallError.isInstance(err) && err.statusCode !== 400) {
      throw new Error(`${label} 调用失败（HTTP ${err.statusCode ?? '网络错误'}）：${err.message}`)
    }
    // Provider can't do native structured output (or returned something off-schema):
    // ask for raw JSON with the schema in the prompt, validate locally, repair once.
    o.onStatus('该模型不支持强制结构化输出，改用提示词约束 + 本地校验…')
    const schemaText = JSON.stringify(o.schema)
    let lastText = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await generateText({
        model,
        system: `${system}\n\n只输出一个 JSON 对象，不要任何解释或代码块标记。它必须符合这个 JSON Schema：\n${schemaText}`,
        messages: [
          { role: 'user', content },
          ...(attempt ? [{ role: 'assistant', content: lastText }, { role: 'user', content: '上面的输出不符合 JSON Schema（缺字段或枚举值不对）。请只输出修正后的完整 JSON。' }] : []),
        ],
        abortSignal: o.signal,
      })
      lastText = res.text
      try {
        const obj = extractJson(res.text)
        if (looksValid(obj, o.schema)) return { output: obj, durationMs: Date.now() - started, usage: res.totalUsage ?? res.usage ?? null, modelId, label }
      } catch {
        /* retry */
      }
    }
    throw new Error(`${label} 没有返回有效的结构化结果（${err.message}）`)
  }
}
