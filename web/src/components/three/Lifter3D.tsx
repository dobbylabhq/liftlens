import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import { Mannequin, type MannequinHandle } from './mannequin'
import * as THREE from 'three'
import { BODY, rigPose, type J, type Rig } from '../figures/poses'
import type { AngleGuide, RegionId } from '../../lib/lifts'
import type { AngleId, LiftId } from '../../lib/types'

/**
 * Procedural 3D lifter (three.js via @react-three/fiber + drei).
 * Driven by the same key poses as the 2D figures (figures/poses.ts → rigPose), mapped into
 * metres: x = forward/back, y = up, z = left/right. Every muscle / joint region is a separate
 * glow shell so the camera-angle panel can light up exactly what that camera should watch.
 */

const ACID = new THREE.Color('#c8ff3d')
const S = 1 / 60 // svg px → metres (≈1.77 m tall lifter)
const BAR_HALF = 1.1

type V = THREE.Vector3
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

// lateral offsets (metres) of left/right joints, per lift. Elbows / wrists come from the rig
// (arms are solved in 3D from the grip width); shoulders match the model's own width.
const SHOULDER_Z = BODY.shoulderZ * S
const WIDTH: Record<LiftId, Record<'hip' | 'knee' | 'ankle', number>> = {
  bench: { hip: 0.12, knee: 0.2, ankle: 0.26 },
  squat: { hip: 0.13, knee: 0.2, ankle: 0.2 },
  deadlift: { hip: 0.13, knee: 0.15, ankle: 0.15 },
}
type Limb = 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle'

/** world-space joints for one frame */
interface Pose3 {
  rig: Rig
  P: (j: Limb | 'head' | 'bar', side: -1 | 0 | 1) => V
  front: V // anterior direction of the torso
  toe: number
}

function pose3(lift: LiftId, t: number): Pose3 {
  const rig = rigPose(lift, t)
  const g = rig.ground
  const to = ([x, y]: J) => v3((x - 100) * S, (g - y) * S, 0)
  const W = WIDTH[lift]
  return {
    rig,
    P: (j, side) => {
      const p = to(rig[j])
      if (!side) return p
      if (j === 'shoulder') p.z = side * SHOULDER_Z
      else if (j === 'elbow') p.z = side * rig.elbowZ * S
      else if (j === 'wrist') p.z = side * rig.wristZ * S
      else if (j in W) p.z = side * W[j as keyof typeof W]
      return p
    },
    front: v3(rig.front[0], -rig.front[1], 0).normalize(),
    toe: rig.toe,
  }
}

// ---------------------------------------------------------------- materials

function useMaterials() {
  return useMemo(
    () => ({
      metal: new THREE.MeshStandardMaterial({ color: '#9aa5a0', roughness: 0.25, metalness: 0.9 }),
      plate: new THREE.MeshStandardMaterial({ color: '#111513', roughness: 0.5, metalness: 0.3 }),
      bench: new THREE.MeshStandardMaterial({ color: '#161b18', roughness: 0.8 }),
    }),
    [],
  )
}

// ---------------------------------------------------------------- body segments

const UP = v3(0, 1, 0)

/** anterior unit normal of a segment: global "front" projected perpendicular to it */
function anterior(dir: V, front: V, toe: number) {
  const n = front.clone().addScaledVector(dir, -front.dot(dir))
  if (n.lengthSq() < 0.04) n.set(toe, 0, 0).addScaledVector(dir, -dir.x * toe)
  return n.normalize()
}

// ---------------------------------------------------------------- regions

interface RegionSpec {
  id: RegionId
  /** returns [centre, segment dir (for orientation), radii along (dir, normal, lateral)] per instance */
  place: (p: Pose3) => { c: V; dir: V; n: V; r: [number, number, number] }[]
}
const SIDES: (-1 | 1)[] = [-1, 1]

function seg(p: Pose3, a: 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle', b: typeof a, side: -1 | 1, u: number) {
  const A = p.P(a, side)
  const B = p.P(b, side)
  const dir = B.clone().sub(A).normalize()
  return { at: A.clone().lerp(B, u), dir, n: anterior(dir, p.front, p.toe) }
}
function torso(p: Pose3, u: number) {
  const H = p.P('hip', 1).add(p.P('hip', -1)).multiplyScalar(0.5)
  const Sh = p.P('shoulder', 1).add(p.P('shoulder', -1)).multiplyScalar(0.5)
  const dir = Sh.clone().sub(H).normalize()
  return { at: H.clone().lerp(Sh, u), dir, n: anterior(dir, p.front, p.toe) }
}
const joint = (j: 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle', r: number) => (p: Pose3) =>
  SIDES.map((s) => ({ c: p.P(j, s), dir: UP, n: v3(1, 0, 0), r: [r, r, r] as [number, number, number] }))

const REGIONS: RegionSpec[] = [
  {
    id: 'chest',
    place: (p) => SIDES.map((s) => { const t = torso(p, 0.78); return { c: t.at.clone().addScaledVector(t.n, 0.09).setZ(s * 0.08), dir: t.dir, n: t.n, r: [0.1, 0.045, 0.085] } }),
  },
  {
    id: 'core',
    place: (p) => { const t = torso(p, 0.35); return [{ c: t.at.clone().addScaledVector(t.n, 0.09), dir: t.dir, n: t.n, r: [0.14, 0.04, 0.09] }] },
  },
  {
    id: 'scapula',
    place: (p) => SIDES.map((s) => { const t = torso(p, 0.82); return { c: t.at.clone().addScaledVector(t.n, -0.1).setZ(s * 0.09), dir: t.dir, n: t.n, r: [0.09, 0.04, 0.07] } }),
  },
  {
    id: 'lats',
    place: (p) => SIDES.map((s) => { const t = torso(p, 0.6); return { c: t.at.clone().addScaledVector(t.n, -0.07).setZ(s * 0.15), dir: t.dir, n: t.n, r: [0.15, 0.045, 0.05] } }),
  },
  {
    id: 'erectors',
    place: (p) => SIDES.map((s) => { const t = torso(p, 0.38); return { c: t.at.clone().addScaledVector(t.n, -0.1).setZ(s * 0.045), dir: t.dir, n: t.n, r: [0.2, 0.035, 0.035] } }),
  },
  {
    id: 'glutes',
    place: (p) => SIDES.map((s) => { const t = torso(p, 0.0); return { c: t.at.clone().addScaledVector(t.n, -0.09).setZ(s * 0.08), dir: t.dir, n: t.n, r: [0.09, 0.06, 0.08] } }),
  },
  {
    id: 'frontDelt',
    place: (p) => SIDES.map((s) => { const q = seg(p, 'shoulder', 'elbow', s, 0.08); return { c: q.at.clone().addScaledVector(q.n, 0.045), dir: q.dir, n: q.n, r: [0.06, 0.04, 0.05] } }),
  },
  {
    id: 'triceps',
    place: (p) => SIDES.map((s) => { const q = seg(p, 'shoulder', 'elbow', s, 0.55); return { c: q.at.clone().addScaledVector(q.n, -0.04), dir: q.dir, n: q.n, r: [0.1, 0.03, 0.04] } }),
  },
  {
    id: 'quads',
    place: (p) => SIDES.map((s) => { const q = seg(p, 'hip', 'knee', s, 0.5); return { c: q.at.clone().addScaledVector(q.n, 0.06), dir: q.dir, n: q.n, r: [0.17, 0.04, 0.065] } }),
  },
  {
    id: 'hamstrings',
    place: (p) => SIDES.map((s) => { const q = seg(p, 'hip', 'knee', s, 0.5); return { c: q.at.clone().addScaledVector(q.n, -0.06), dir: q.dir, n: q.n, r: [0.16, 0.04, 0.06] } }),
  },
  {
    id: 'adductors',
    place: (p) => SIDES.map((s) => { const q = seg(p, 'hip', 'knee', s, 0.35); return { c: q.at.clone().setZ(q.at.z - s * 0.06), dir: q.dir, n: q.n, r: [0.13, 0.05, 0.03] } }),
  },
  { id: 'hips', place: joint('hip', 0.09) },
  { id: 'knees', place: joint('knee', 0.075) },
  { id: 'elbows', place: joint('elbow', 0.06) },
  { id: 'wrists', place: joint('wrist', 0.055) },
  {
    id: 'feet',
    place: (p) => SIDES.map((s) => { const a = p.P('ankle', s); return { c: v3(a.x + p.toe * 0.08, 0.03, a.z), dir: v3(1, 0, 0), n: UP, r: [0.13, 0.03, 0.05] } }),
  },
  {
    id: 'heels',
    place: (p) => SIDES.map((s) => { const a = p.P('ankle', s); return { c: v3(a.x - p.toe * 0.03, 0.03, a.z), dir: UP, n: v3(1, 0, 0), r: [0.045, 0.045, 0.045] } }),
  },
  {
    id: 'bar',
    place: (p) => { const b = p.P('bar', 0); return [{ c: b, dir: v3(0, 0, 1), n: UP, r: [BAR_HALF + 0.05, 0.035, 0.035] }] },
  },
]

// ---------------------------------------------------------------- scene

const tmpM = new THREE.Matrix4()
function orient(o: THREE.Object3D, c: V, dir: V, n: V, r: [number, number, number]) {
  const y = dir.clone().normalize()
  const x = n.clone().addScaledVector(y, -n.dot(y)).normalize()
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0)
  const z = x.clone().cross(y)
  tmpM.makeBasis(x, y, z)
  o.position.copy(c)
  o.quaternion.setFromRotationMatrix(tmpM)
  o.scale.set(r[1], r[0], r[2])
}

function repT(time: number, tempo: number) {
  // eccentric 50% → pause 8% → concentric 32% → lockout 10%
  const u = (time % tempo) / tempo
  const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x)
  if (u < 0.5) return ease(u / 0.5)
  if (u < 0.58) return 1
  if (u < 0.9) return 1 - Math.sin(((u - 0.58) / 0.32) * (Math.PI / 2))
  return 0
}

function Lifter({ lift, active, focus, reduced, fixedT }: { lift: LiftId; active: Set<RegionId>; focus: Set<RegionId>; reduced: boolean; fixedT?: number }) {
  const mats = useMaterials()
  const barRef = useRef<THREE.Group>(null)
  const regionRefs = useRef<Record<string, (THREE.Mesh | null)[]>>({})
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 24, 16), [])

  const body = useRef<MannequinHandle>(null)

  const regionMats = useMemo(
    () =>
      Object.fromEntries(
        REGIONS.map((r) => [
          r.id,
          new THREE.MeshBasicMaterial({ color: ACID, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
        ]),
      ) as Record<RegionId, THREE.MeshBasicMaterial>,
    [],
  )

  useFrame(({ clock }) => {
    const time = clock.getElapsedTime()
    const t = fixedT ?? (reduced ? 0.6 : repT(time, 2.8))
    const p = pose3(lift, t)
    body.current?.update({ ...p, near: 1 })
    if (barRef.current) barRef.current.position.copy(p.P('bar', 0))
    if (import.meta.env.DEV) Object.assign(window, { __pose: p, __regionMats: regionMats })

    // regions
    const pulse = reduced ? 0.8 : 0.55 + 0.35 * Math.sin(time * 4)
    for (const spec of REGIONS) {
      const mat = regionMats[spec.id]
      const on = active.has(spec.id)
      const hot = focus.size ? focus.has(spec.id) : on
      const goal = !on ? 0 : hot ? pulse : 0.32
      mat.opacity += (goal - mat.opacity) * 0.18
      // focused regions show through the body / bench (x-ray), so e.g. glutes on a bench stay visible
      mat.depthTest = !(hot && focus.size > 0)
      const inst = spec.place(p)
      const refs = regionRefs.current[spec.id] ?? []
      inst.forEach((q, i) => {
        const m = refs[i]
        if (!m) return
        m.visible = mat.opacity > 0.01
        const grow = hot ? 1.15 : 1
        orient(m, q.c, q.dir, q.n, [q.r[0] * grow, q.r[1] * grow, q.r[2] * grow])
      })
    }
  })

  // instance counts for refs
  const counts = Object.fromEntries(REGIONS.map((r) => [r.id, r.place(pose3(lift, 0)).length]))

  return (
    <group>
      <Mannequin ref={body} />

      {/* barbell along z */}
      <group ref={barRef}>
        <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.metal} castShadow>
          <cylinderGeometry args={[0.014, 0.014, BAR_HALF * 2, 12]} />
        </mesh>
        {[-1, 1].map((s) => (
          <group key={s}>
            {[0, 1].map((k) => (
              <mesh key={k} position={[0, 0, s * (0.82 + k * 0.055)]} rotation={[Math.PI / 2, 0, 0]} material={mats.plate} castShadow>
                <cylinderGeometry args={[k ? 0.17 : 0.225, k ? 0.17 : 0.225, 0.045, 40]} />
              </mesh>
            ))}
            <mesh position={[0, 0, s * 0.795]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.03, 0.03, 0.05, 16]} />
              <meshBasicMaterial color={ACID} />
            </mesh>
          </group>
        ))}
      </group>

      {/* glow shells */}
      {REGIONS.map((spec) =>
        Array.from({ length: counts[spec.id] }).map((_, i) => (
          <mesh
            key={`${spec.id}${i}`}
            ref={(m) => {
              regionRefs.current[spec.id] ??= []
              regionRefs.current[spec.id][i] = m
            }}
            geometry={sphere}
            material={regionMats[spec.id]}
            renderOrder={10}
          />
        )),
      )}

      {lift === 'bench' && (
        <group>
          {/* standard flat bench: pad top ≈ 0.33 m so the torso (≈0.1 m deep) rests on it */}
          <mesh position={[0.22, 0.3, 0]} material={mats.bench} receiveShadow castShadow>
            <boxGeometry args={[1.25, 0.07, 0.3]} />
          </mesh>
          {[-0.3, 0.72].map((x) => (
            <mesh key={x} position={[x, 0.135, 0]} material={mats.bench}>
              <boxGeometry args={[0.06, 0.27, 0.26]} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  )
}

// ---------------------------------------------------------------- cameras

/** lifter's right / front directions in world space (azimuth 0 = right side, 90 = front) */
function frame(lift: LiftId) {
  return lift === 'bench' ? { right: v3(0, 0, -1), front: v3(-1, 0, 0) } : { right: v3(0, 0, 1), front: v3(1, 0, 0) }
}
export function cameraPosition(lift: LiftId, g: AngleGuide, center: V) {
  const { right, front } = frame(lift)
  const a = (g.azimuth * Math.PI) / 180
  const d = right.clone().multiplyScalar(Math.cos(a)).addScaledVector(front, Math.sin(a))
  return center.clone().addScaledVector(d, g.distanceM).setY(g.heightM)
}

function RimLight({ center }: { center: V }) {
  const ref = useRef<THREE.DirectionalLight>(null)
  useFrame(({ camera }) => {
    const l = ref.current
    if (!l) return
    const away = center.clone().sub(camera.position).setY(0).normalize()
    l.position.copy(center).addScaledVector(away, 3).setY(2.6)
    l.target.position.copy(center)
    l.target.updateMatrixWorld()
  })
  return <directionalLight ref={ref} intensity={1.8} color="#c8ff3d" />
}

// ---------------------------------------------------------------- view control

function ViewController({ mode, camPos, center }: { mode: 'orbit' | 'camera'; camPos: V; center: V }) {
  const ref = useRef<CameraControls>(null)
  const idle = useRef(true)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    if (mode === 'camera') {
      idle.current = false
      c.setLookAt(camPos.x, camPos.y, camPos.z, center.x, center.y, center.z, true)
    } else {
      idle.current = true
      c.setLookAt(center.x + 3.3, 2.5, center.z + 3.8, center.x, center.y * 0.8, center.z, true)
    }
  }, [mode, camPos, center])
  useEffect(() => {
    // dev-only handle for visual checks (close-ups of hands etc.)
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__view = { controls: ref.current, idle }
  })
  useFrame((_, dt) => {
    // slow turntable while in overview and the user isn't dragging
    if (mode === 'orbit' && idle.current && ref.current) ref.current.azimuthAngle += dt * 0.18
  })
  return (
    <CameraControls
      ref={ref}
      minDistance={1.2}
      maxDistance={11}
      maxPolarAngle={Math.PI * 0.49}
      onStart={() => (idle.current = false)}
      onEnd={() => setTimeout(() => (idle.current = mode === 'orbit'), 2500)}
    />
  )
}

// ---------------------------------------------------------------- public component

export interface Lifter3DProps {
  lift: LiftId
  angles: AngleGuide[]
  selected: AngleId
  onSelect: (a: AngleId) => void
  /** regions relevant for the selected camera (soft glow) */
  active: RegionId[]
  /** regions the user is hovering in the list (strong pulse) */
  focus: RegionId[]
  mode: 'orbit' | 'camera'
  /** freeze the rep at this progress (0…1) instead of animating */
  t?: number
}

export default function Lifter3D({ lift, angles, selected, active, focus, mode, t }: Lifter3DProps) {
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const center = useMemo(() => {
    const p = pose3(lift, 0)
    const hip = p.P('hip', 0)
    return v3(lift === 'bench' ? 0.25 : hip.x, lift === 'bench' ? 0.45 : 0.85, 0)
  }, [lift])
  const cams = useMemo(() => angles.map((g) => ({ g, pos: cameraPosition(lift, g, center) })), [angles, lift, center])
  const sel = cams.find((c) => c.g.id === selected) ?? cams[0]
  const activeSet = useMemo(() => new Set(active), [active])
  const focusSet = useMemo(() => new Set(focus), [focus])


  return (
    <div className="relative h-full w-full">
    <Canvas shadows={{ type: THREE.PCFShadowMap }} dpr={[1, 2]} camera={{ position: [3.3, 2.5, 3.8], fov: 42 }} gl={{ antialias: true }}>
      <color attach="background" args={['#0d100e']} />
      <fog attach="fog" args={['#0d100e', 6, 13]} />
      <ambientLight intensity={0.7} />
      <hemisphereLight args={['#dfe8e2', '#0d100e', 0.6]} />
      <directionalLight position={[3, 5, 2]} intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} />
      {/* acid rim light, always behind the lifter relative to the viewer — matches the 2D silhouette style */}
      <RimLight center={center} />
      <pointLight position={[0, 0.3, 2.5]} intensity={0.6} color="#5eead4" />

      <group position={[0, 0, 0]}>
        <Suspense fallback={null}>
          <Lifter lift={lift} active={activeSet} focus={focusSet} reduced={reduced} fixedT={t} />
        </Suspense>
      </group>

      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[5.5, 64]} />
        <meshStandardMaterial color="#121614" roughness={1} />
      </mesh>
      <gridHelper args={[11, 22, '#252d29', '#1a201d']} position={[0, 0.001, 0]} />
      {/* platform */}
      <mesh position={[center.x, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[2.4, 2.4]} />
        <meshStandardMaterial color="#171c19" roughness={0.9} />
      </mesh>

      <ViewController mode={mode} camPos={sel.pos} center={center} />
    </Canvas>
    </div>
  )
}
