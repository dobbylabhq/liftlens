// JSON Schemas passed to `claude -p --json-schema`, so the agent's reply is
// validated structured output instead of free text we would have to parse.

const cue = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '一句话问题或要点（中文，≤20字）' },
    detail: { type: 'string', description: '为什么 + 怎么改，具体到动作口令' },
    priority: { type: 'string', enum: ['high', 'medium', 'low'] },
    evidence: { type: 'string', description: '依据：引用的 metric 数值或关键帧文件名' },
    sourceIds: { type: 'array', items: { type: 'string' }, description: '引用的 source id（必须来自 SOURCES 列表）' },
  },
  required: ['title', 'detail', 'priority', 'sourceIds'],
  additionalProperties: false,
}

export const sessionSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['solid', 'needs_work', 'unsafe'] },
    score: { type: 'integer', minimum: 0, maximum: 100, description: '动作质量分' },
    summary: { type: 'string', description: '2～3 句总体评价' },
    cues: { type: 'array', items: cue, maxItems: 6 },
    metricDisagreements: {
      type: 'array',
      items: { type: 'string' },
      description: '你从关键帧看到、但与程序测量结果不一致的地方（例如遮挡导致的误判）',
    },
    cameraAdvice: { type: 'string', description: '下次拍摄需要补充/调整的机位，没有则空字符串' },
    nextSession: { type: 'string', description: '下次训练的具体建议（重量/次数/辅助练习）' },
  },
  required: ['verdict', 'score', 'summary', 'cues', 'metricDisagreements', 'cameraAdvice', 'nextSession'],
  additionalProperties: false,
}

export const progressSchema = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    trends: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lift: { type: 'string' },
          observation: { type: 'string' },
          direction: { type: 'string', enum: ['up', 'flat', 'down'] },
        },
        required: ['lift', 'observation', 'direction'],
        additionalProperties: false,
      },
    },
    plan: {
      type: 'array',
      description: '未来 2～4 周的建议，每条一句',
      items: { type: 'string' },
    },
    sourceIds: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'strengths', 'weaknesses', 'trends', 'plan', 'sourceIds'],
  additionalProperties: false,
}
