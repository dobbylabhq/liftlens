import type { PatternId } from './types'

/**
 * How each movement pattern counts reps and is judged.
 * The counting signal is a joint angle (degrees), independent of camera distance; calf raises use ankle height (% of shin length).
 *
 * rest: whether the signal is high or low at the start/relaxed position (squat standing tall has a large knee angle → high; press starts with bent elbows → low).
 * eccentric: whether the eccentric (lowering/return) happens "toward the peak" or "away from the peak".
 * peak / rest targets: whether each rep reaches full range and returns to the start position (lockout/extension).
 */
export type Joint = 'knee' | 'hip' | 'elbow' | 'shoulder' | 'ankleRise'
export type Check = 'tempo' | 'consistency' | 'fatigue' | 'swing' | 'elbowDrift' | 'bodyLine' | 'valgus' | 'asymmetry'

export interface Target {
  op: '<=' | '>='
  deg: number
  /** Standard description shown to the user */
  label: string
}

export interface PatternDef {
  id: PatternId
  zh: string
  joint: Joint
  rest: 'high' | 'low'
  eccentric: 'toPeak' | 'fromPeak'
  /** Typical start / peak values (used as thresholds by live counting before the user's own range is observed) */
  typical: { rest: number; peak: number }
  peakTarget?: Target
  restTarget?: Target
  checks: Check[]
  /** Pose prior: helps the pose model pick out the trainee in multi-person frames */
  posture: 'upright' | 'lying'
  /** Ballistic (kettlebell swings etc.): don't check eccentric tempo */
  ballistic?: boolean
  /** Recommended camera angle */
  camera: { angle: 'side' | 'front'; tip: string }
  /** Voice cue in live mode when range isn't reached */
  cue: { peak?: string; rest?: string; swing?: string; bodyLine?: string }
}

export const PATTERNS: Record<PatternId, PatternDef> = {
  squat: {
    id: 'squat',
    zh: '深蹲类',
    joint: 'knee',
    rest: 'high',
    eccentric: 'toPeak',
    typical: { rest: 170, peak: 75 },
    peakTarget: { op: '<=', deg: 95, label: '蹲到大腿接近水平（膝角 ≤ 95°）' },
    restTarget: { op: '>=', deg: 160, label: '每次站直（膝角 ≥ 160°）' },
    checks: ['tempo', 'consistency', 'fatigue', 'valgus'],
    posture: 'upright',
    camera: { angle: 'side', tip: '侧面、镜头与髋同高，拍到全身' },
    cue: { peak: '再蹲深一点', rest: '站直' },
  },
  hinge: {
    id: 'hinge',
    zh: '髋铰链',
    joint: 'hip',
    rest: 'high',
    eccentric: 'toPeak',
    typical: { rest: 170, peak: 95 },
    peakTarget: { op: '<=', deg: 125, label: '髋充分屈曲（髋角 ≤ 125°）' },
    restTarget: { op: '>=', deg: 165, label: '顶端髋完全伸展站直（髋角 ≥ 165°）' },
    checks: ['consistency', 'fatigue'],
    posture: 'upright',
    camera: { angle: 'side', tip: '侧面、镜头与髋同高，拍到全身' },
    cue: { rest: '顶端夹臀站直' },
  },
  lunge: {
    id: 'lunge',
    zh: '单腿蹲/箭步',
    joint: 'knee',
    rest: 'high',
    eccentric: 'toPeak',
    typical: { rest: 165, peak: 90 },
    peakTarget: { op: '<=', deg: 100, label: '前腿蹲到约 90°（膝角 ≤ 100°）' },
    restTarget: { op: '>=', deg: 150, label: '每次起身伸直' },
    checks: ['tempo', 'consistency', 'fatigue'],
    posture: 'upright',
    camera: { angle: 'side', tip: '侧面拍，前腿靠近镜头一侧' },
    cue: { peak: '再低一点' },
  },
  'hip-thrust': {
    id: 'hip-thrust',
    zh: '臀推/臀桥',
    joint: 'hip',
    rest: 'low',
    eccentric: 'fromPeak',
    typical: { rest: 115, peak: 175 },
    peakTarget: { op: '>=', deg: 165, label: '顶端髋完全伸展（髋角 ≥ 165°）' },
    checks: ['tempo', 'consistency', 'fatigue'],
    posture: 'lying',
    camera: { angle: 'side', tip: '侧面、镜头与凳面同高' },
    cue: { peak: '顶到最高，夹臀' },
  },
  'horizontal-push': {
    id: 'horizontal-push',
    zh: '推胸类',
    joint: 'elbow',
    rest: 'high',
    eccentric: 'toPeak',
    typical: { rest: 165, peak: 80 },
    // From the side the far arm is often hidden by the barbell/dumbbell, and 2D elbow angle at the bottom commonly reads 85–110°, so the standard is relaxed to 110°
    peakTarget: { op: '<=', deg: 110, label: '下放到上臂约与身体齐平（肘角 ≤ 110°）' },
    restTarget: { op: '>=', deg: 150, label: '推起到手臂接近伸直' },
    checks: ['tempo', 'consistency', 'fatigue', 'asymmetry'],
    posture: 'lying',
    camera: { angle: 'side', tip: '侧面、镜头与凳面同高' },
    cue: { peak: '放得再低一点', rest: '推到顶' },
  },
  'push-up': {
    id: 'push-up',
    zh: '俯卧撑类',
    joint: 'elbow',
    rest: 'high',
    eccentric: 'toPeak',
    typical: { rest: 165, peak: 80 },
    peakTarget: { op: '<=', deg: 95, label: '胸部下到肘约 90° 或更低' },
    restTarget: { op: '>=', deg: 150, label: '撑起到手臂伸直' },
    checks: ['tempo', 'consistency', 'fatigue', 'bodyLine'],
    posture: 'lying',
    camera: { angle: 'side', tip: '侧面贴地拍，拍到头到脚' },
    cue: { peak: '再低一点', bodyLine: '收紧核心，身体成一条线' },
  },
  'vertical-push': {
    id: 'vertical-push',
    zh: '推举类',
    joint: 'elbow',
    rest: 'low',
    eccentric: 'fromPeak',
    typical: { rest: 75, peak: 170 },
    peakTarget: { op: '>=', deg: 155, label: '推到头顶锁定（肘角 ≥ 155°）' },
    restTarget: { op: '<=', deg: 100, label: '下放到下巴/锁骨高度' },
    checks: ['tempo', 'consistency', 'fatigue', 'swing', 'asymmetry'],
    posture: 'upright',
    camera: { angle: 'side', tip: '侧面拍上半身和髋' },
    cue: { peak: '推到顶锁住', swing: '别往后仰' },
  },
  dip: {
    id: 'dip',
    zh: '臂屈伸',
    joint: 'elbow',
    rest: 'high',
    eccentric: 'toPeak',
    typical: { rest: 165, peak: 85 },
    peakTarget: { op: '<=', deg: 95, label: '下到上臂约与地面平行（肘角 ≤ 95°）' },
    restTarget: { op: '>=', deg: 150, label: '撑起到手臂伸直' },
    checks: ['tempo', 'consistency', 'fatigue'],
    posture: 'upright',
    camera: { angle: 'side', tip: '侧面拍全身' },
    cue: { peak: '再下深一点' },
  },
  'horizontal-pull': {
    id: 'horizontal-pull',
    zh: '划船类',
    joint: 'elbow',
    rest: 'high',
    eccentric: 'fromPeak',
    typical: { rest: 160, peak: 75 },
    peakTarget: { op: '<=', deg: 95, label: '拉到肘角 ≤ 95°（手接近躯干）' },
    restTarget: { op: '>=', deg: 140, label: '放回手臂伸直' },
    checks: ['tempo', 'consistency', 'fatigue', 'swing'],
    posture: 'upright',
    camera: { angle: 'side', tip: '侧面拍躯干和手臂' },
    cue: { peak: '拉到底，夹背', swing: '躯干别晃' },
  },
  'vertical-pull': {
    id: 'vertical-pull',
    zh: '引体/下拉',
    joint: 'elbow',
    rest: 'high',
    eccentric: 'fromPeak',
    typical: { rest: 165, peak: 60 },
    peakTarget: { op: '<=', deg: 80, label: '拉到肘角 ≤ 80°（下巴过杠 / 杆到上胸）' },
    restTarget: { op: '>=', deg: 145, label: '每次回到手臂伸直' },
    checks: ['tempo', 'consistency', 'fatigue', 'swing', 'asymmetry'],
    posture: 'upright',
    camera: { angle: 'side', tip: '侧面或正面拍，拍到手和髋' },
    cue: { peak: '再拉高一点', rest: '放到底伸直', swing: '别借力摆动' },
  },
  'elbow-flexion': {
    id: 'elbow-flexion',
    zh: '弯举类',
    joint: 'elbow',
    rest: 'high',
    eccentric: 'fromPeak',
    typical: { rest: 160, peak: 45 },
    peakTarget: { op: '<=', deg: 65, label: '弯到顶（肘角 ≤ 65°）' },
    restTarget: { op: '>=', deg: 145, label: '放下到手臂接近伸直' },
    checks: ['tempo', 'consistency', 'fatigue', 'swing', 'elbowDrift'],
    posture: 'upright',
    camera: { angle: 'side', tip: '侧面拍，训练的手臂朝向镜头' },
    cue: { peak: '弯到顶', rest: '放到底', swing: '别甩身体' },
  },
  'elbow-extension': {
    id: 'elbow-extension',
    zh: '臂屈伸/下压',
    joint: 'elbow',
    rest: 'low',
    eccentric: 'fromPeak',
    typical: { rest: 80, peak: 165 },
    peakTarget: { op: '>=', deg: 150, label: '伸到手臂接近伸直（肘角 ≥ 150°）' },
    checks: ['tempo', 'consistency', 'fatigue', 'elbowDrift'],
    posture: 'upright',
    camera: { angle: 'side', tip: '侧面拍，训练的手臂朝向镜头' },
    cue: { peak: '伸直锁住', swing: '大臂别动' },
  },
  'shoulder-raise': {
    id: 'shoulder-raise',
    zh: '平举类',
    joint: 'shoulder',
    rest: 'low',
    eccentric: 'fromPeak',
    typical: { rest: 15, peak: 85 },
    peakTarget: { op: '>=', deg: 70, label: '举到约与肩同高（≥ 70°）' },
    checks: ['tempo', 'consistency', 'fatigue', 'swing', 'asymmetry'],
    posture: 'upright',
    camera: { angle: 'front', tip: '侧平举正面拍、前平举侧面拍' },
    cue: { peak: '举到肩高', swing: '别借身体的力' },
  },
  'calf-raise': {
    id: 'calf-raise',
    zh: '提踵',
    joint: 'ankleRise',
    rest: 'low',
    eccentric: 'fromPeak',
    typical: { rest: 0, peak: 18 },
    checks: ['tempo', 'consistency', 'fatigue'],
    posture: 'upright',
    camera: { angle: 'side', tip: '侧面、镜头放低到小腿高度' },
    cue: { peak: '踮到最高停一下' },
  },
  'knee-flexion': {
    id: 'knee-flexion',
    zh: '腿弯举',
    joint: 'knee',
    rest: 'high',
    eccentric: 'fromPeak',
    typical: { rest: 165, peak: 70 },
    peakTarget: { op: '<=', deg: 85, label: '弯到膝角 ≤ 85°' },
    restTarget: { op: '>=', deg: 150, label: '放回腿接近伸直' },
    checks: ['tempo', 'consistency', 'fatigue'],
    posture: 'lying',
    camera: { angle: 'side', tip: '侧面拍，拍到髋到脚' },
    cue: { peak: '再弯一点', rest: '放到底' },
  },
  'knee-extension': {
    id: 'knee-extension',
    zh: '腿屈伸',
    joint: 'knee',
    rest: 'low',
    eccentric: 'fromPeak',
    typical: { rest: 90, peak: 170 },
    peakTarget: { op: '>=', deg: 160, label: '伸到腿接近伸直（膝角 ≥ 160°）' },
    checks: ['tempo', 'consistency', 'fatigue'],
    posture: 'upright',
    camera: { angle: 'side', tip: '侧面拍，拍到髋到脚' },
    cue: { peak: '伸直停一下' },
  },
  'core-flexion': {
    id: 'core-flexion',
    zh: '卷腹/举腿',
    joint: 'hip',
    rest: 'high',
    eccentric: 'fromPeak',
    typical: { rest: 160, peak: 95 },
    checks: ['tempo', 'consistency', 'fatigue'],
    posture: 'lying',
    camera: { angle: 'side', tip: '侧面贴地拍' },
    cue: {},
  },
  'isometric-hold': {
    id: 'isometric-hold',
    zh: '静态支撑',
    joint: 'hip',
    rest: 'high',
    eccentric: 'toPeak',
    typical: { rest: 175, peak: 175 },
    checks: ['bodyLine'],
    posture: 'lying',
    camera: { angle: 'side', tip: '侧面拍全身' },
    cue: { bodyLine: '臀部别塌也别撅' },
  },
}

/** Generic lower bound for the eccentric phase: shorter than this (seconds) counts as "lowering too fast" */
export const MIN_ECCENTRIC_S = 0.5
