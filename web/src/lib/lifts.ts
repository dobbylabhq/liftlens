import type { AngleId, LiftId } from './types'

/** Body regions that can be highlighted on the 3D lifter. */
export type RegionId =
  | 'chest' | 'frontDelt' | 'triceps' | 'scapula' | 'lats' | 'erectors' | 'core'
  | 'glutes' | 'quads' | 'hamstrings' | 'adductors'
  | 'hips' | 'knees' | 'elbows' | 'wrists' | 'feet' | 'heels' | 'bar'

export const REGION_LABEL: Record<RegionId, string> = {
  chest: '胸大肌', frontDelt: '三角肌前束', triceps: '肱三头肌', scapula: '肩胛 / 上背', lats: '背阔肌',
  erectors: '竖脊肌 / 下背', core: '核心', glutes: '臀大肌', quads: '股四头肌', hamstrings: '腘绳肌',
  adductors: '内收肌', hips: '髋关节', knees: '膝关节', elbows: '肘关节', wrists: '手腕 / 握距', feet: '脚 / 站距',
  heels: '脚跟', bar: '杠铃',
}

/** One thing to watch from a camera angle, and where it is on the body. */
export interface Focus {
  text: string
  regions: RegionId[]
}

export interface AngleGuide {
  id: AngleId
  label: string
  /** camera lens height above the floor, metres (drives the 3D camera) */
  heightM: number
  /** horizontal distance to the lifter, metres */
  distanceM: number
  /** azimuth in degrees around the lifter, 0 = lifter's right side, 90 = in front (facing), 180 = left, 270 = behind */
  azimuth: number
  priority: 'primary' | 'secondary' | 'optional'
  height: string
  distance: string
  reveals: Focus[]
}

export interface LiftDef {
  id: LiftId
  name: string
  en: string
  tagline: string
  angles: AngleGuide[]
  shootingTips: string[]
}

const COMMON_TIPS = [
  '横屏、固定三脚架，镜头不要跟拍或变焦',
  '全身 + 两侧杠铃片都要完整入画，头顶脚底各留一点余量',
  '尽量 60fps；光线从正面或侧面来，避免背后是窗户（逆光会让骨架识别变差）',
  '穿和背景反差明显、贴身一点的衣服，宽松格子衫会降低关节识别精度',
  '如果杠铃片中心有彩色标记（红点/贴纸），选中它可以获得更准的杠铃轨迹',
]

export const LIFTS: Record<LiftId, LiftDef> = {
  bench: {
    id: 'bench',
    name: '卧推',
    en: 'Bench Press',
    tagline: '触胸位置 · 下放深度 · 臀部离凳 · 握距',
    angles: [
      {
        id: 'side',
        label: '正侧面',
        heightM: 0.45,
        distanceM: 3.0,
        azimuth: 0,
        priority: 'primary',
        height: '与卧推凳面同高（约 45cm）',
        distance: '距凳子 2.5–3.5m',
        reveals: [
          { text: '触胸点（杠铃落在胸骨哪里）', regions: ['chest', 'bar'] },
          { text: '每次是否下放到位', regions: ['elbows', 'chest'] },
          { text: '臀部是否离凳', regions: ['glutes'] },
          { text: '脚的位置与腿驱动', regions: ['feet', 'quads'] },
          { text: '下放/推起节奏', regions: ['bar', 'triceps'] },
        ],
      },
      {
        id: 'front',
        label: '脚端正面',
        heightM: 0.9,
        distanceM: 2.5,
        azimuth: 90,
        priority: 'secondary',
        height: '略高于胸口（约 90cm），从脚的方向拍',
        distance: '距凳尾 2–3m',
        reveals: [
          { text: '握距 / 肩宽比', regions: ['wrists', 'frontDelt'] },
          { text: '杠铃左右是否倾斜', regions: ['bar', 'wrists'] },
          { text: '左右手推起是否同步', regions: ['triceps', 'elbows'] },
        ],
      },
      {
        id: 'front45',
        label: '45° 斜前方',
        heightM: 0.9,
        distanceM: 2.5,
        azimuth: 45,
        priority: 'optional',
        height: '与胸口同高',
        distance: '2–3m',
        reveals: [
          { text: '肘部外展角度（是否 90° 打开）', regions: ['elbows', 'frontDelt'] },
          { text: '肩胛是否后收下沉', regions: ['scapula'] },
        ],
      },
    ],
    shootingTips: COMMON_TIPS,
  },
  squat: {
    id: 'squat',
    name: '深蹲',
    en: 'Back Squat',
    tagline: '深度 · 杠铃轨迹 · 躯干角度 · 膝内扣',
    angles: [
      {
        id: 'side',
        label: '正侧面',
        heightM: 0.9,
        distanceM: 3.5,
        azimuth: 0,
        priority: 'primary',
        height: '髋部高度（约 90cm）',
        distance: '3–4m',
        reveals: [
          { text: '蹲的深度（髋是否低于膝）', regions: ['hips', 'knees'] },
          { text: '杠铃是否在脚中线上方', regions: ['bar', 'feet'] },
          { text: '躯干前倾角', regions: ['erectors', 'core'] },
          { text: '脚跟是否抬起', regions: ['heels'] },
        ],
      },
      {
        id: 'front',
        label: '正前方',
        heightM: 0.7,
        distanceM: 3.0,
        azimuth: 90,
        priority: 'secondary',
        height: '膝盖到髋部之间',
        distance: '3m',
        reveals: [
          { text: '膝内扣（valgus）', regions: ['knees', 'adductors'] },
          { text: '髋左右偏移', regions: ['hips', 'glutes'] },
          { text: '站距与脚尖角度', regions: ['feet'] },
        ],
      },
      {
        id: 'rear45',
        label: '45° 斜后方',
        heightM: 1.4,
        distanceM: 3.0,
        azimuth: 225,
        priority: 'optional',
        height: '肩部高度',
        distance: '3m',
        reveals: [
          { text: '上背是否塌', regions: ['scapula', 'erectors'] },
          { text: '杠铃位置（高杠/低杠）', regions: ['bar', 'scapula'] },
        ],
      },
    ],
    shootingTips: COMMON_TIPS,
  },
  deadlift: {
    id: 'deadlift',
    name: '硬拉',
    en: 'Deadlift',
    tagline: '起杠顺序 · 杠铃贴身 · 锁定 · 背部',
    angles: [
      {
        id: 'side',
        label: '正侧面',
        heightM: 0.6,
        distanceM: 3.0,
        azimuth: 0,
        priority: 'primary',
        height: '膝盖到髋部之间（约 60cm）',
        distance: '3m',
        reveals: [
          { text: '臀是否先起（变成早安式）', regions: ['glutes', 'hamstrings', 'hips'] },
          { text: '杠铃是否贴腿走直线', regions: ['bar', 'knees'] },
          { text: '锁定是否完全、是否过度后仰', regions: ['glutes', 'erectors'] },
          { text: '下背是否弯曲（交给 agent 看关键帧）', regions: ['erectors'] },
        ],
      },
      {
        id: 'front45',
        label: '45° 斜前方',
        heightM: 0.9,
        distanceM: 3.0,
        azimuth: 45,
        priority: 'secondary',
        height: '髋部高度',
        distance: '3m',
        reveals: [
          { text: '背部弧度（比正侧面更容易看出圆背）', regions: ['erectors', 'lats'] },
          { text: '肩胛位置', regions: ['scapula', 'lats'] },
        ],
      },
      {
        id: 'front',
        label: '正前方',
        heightM: 0.9,
        distanceM: 3.0,
        azimuth: 90,
        priority: 'optional',
        height: '髋部高度',
        distance: '3m',
        reveals: [
          { text: '左右对称', regions: ['hips', 'scapula'] },
          { text: '握距', regions: ['wrists'] },
          { text: '膝是否内扣', regions: ['knees'] },
        ],
      },
    ],
    shootingTips: COMMON_TIPS,
  },
}

export const ANGLE_LABEL: Record<AngleId, string> = {
  side: '正侧面',
  front45: '45° 斜前',
  front: '正前方',
  rear45: '45° 斜后',
}

/** Epley estimated 1RM */
export function e1rm(weight: number | null, reps: number) {
  if (!weight || reps <= 0) return null
  if (reps === 1) return weight
  return Math.round(weight * (1 + reps / 30) * 10) / 10
}
