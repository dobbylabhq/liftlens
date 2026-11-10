import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import * as THREE from 'three'

/**
 * Procedural articulated mannequin (artist's-dummy style): ball joints, tapered limb segments and
 * ellipsoid torso / head / hands / feet, all generated in code — no third-party model files.
 * Driven directly by the solved joint positions, so what you see is exactly the pose we computed.
 */

type V = THREE.Vector3
export type Limb = 'shoulder' | 'elbow' | 'wrist' | 'hip' | 'knee' | 'ankle'
export interface MannequinPose {
  P: (j: Limb | 'head' | 'bar', side: -1 | 0 | 1) => V
  /** anterior direction of the torso */
  front: V
  /** toe direction along x (+1 / -1) */
  toe: number
  /** which side (+1 / -1 in z) is nearer the default camera — drawn a shade lighter */
  near: -1 | 1
}
export interface MannequinHandle {
  update: (p: MannequinPose) => void
}

const SIDES: (-1 | 1)[] = [-1, 1]
// segment radii (m): [proximal, distal]
const LIMBS: { a: Limb; b: Limb; r: [number, number] }[] = [
  { a: 'shoulder', b: 'elbow', r: [0.048, 0.04] },
  { a: 'elbow', b: 'wrist', r: [0.038, 0.029] },
  { a: 'hip', b: 'knee', r: [0.075, 0.055] },
  { a: 'knee', b: 'ankle', r: [0.05, 0.035] },
]
const BALLS: { j: Limb; r: number }[] = [
  { j: 'shoulder', r: 0.055 },
  { j: 'elbow', r: 0.042 },
  { j: 'wrist', r: 0.031 },
  { j: 'hip', r: 0.07 },
  { j: 'knee', r: 0.056 },
  { j: 'ankle', r: 0.038 },
]

const tmpM = new THREE.Matrix4()
/** place a unit primitive: local y along `dir`, local x along `n` (projected), scale (x, y, z) */
function orient(o: THREE.Object3D, c: V, dir: V, n: V, sx: number, sy: number, sz: number) {
  const y = dir.clone().normalize()
  const x = n.clone().addScaledVector(y, -n.dot(y))
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0).addScaledVector(y, -y.x)
  x.normalize()
  const z = x.clone().cross(y)
  tmpM.makeBasis(x, y, z)
  o.position.copy(c)
  o.quaternion.setFromRotationMatrix(tmpM)
  o.scale.set(sx, sy, sz)
}

export const Mannequin = forwardRef<MannequinHandle>(function Mannequin(_, ref) {
  const mats = useMemo(
    () => ({
      near: new THREE.MeshStandardMaterial({ color: '#c9b79c', roughness: 0.55, metalness: 0.02 }),
      far: new THREE.MeshStandardMaterial({ color: '#a8977e', roughness: 0.6, metalness: 0.02 }),
      joint: new THREE.MeshStandardMaterial({ color: '#8d7c64', roughness: 0.45, metalness: 0.05 }),
    }),
    [],
  )
  const geo = useMemo(
    () => ({
      sphere: new THREE.SphereGeometry(1, 28, 18),
      // unit-height tapered cylinders, one per limb type (radius baked in, length scaled per frame)
      limbs: LIMBS.map((l) => new THREE.CylinderGeometry(l.r[1], l.r[0], 1, 20, 1, true)),
    }),
    [],
  )
  const g = useRef<THREE.Group>(null)
  const limbRefs = useRef<(THREE.Mesh | null)[]>([])
  const ballRefs = useRef<(THREE.Mesh | null)[]>([])
  const part = useRef<Record<string, THREE.Mesh | null>>({})

  useImperativeHandle(ref, () => ({
    update(p) {
      const up = new THREE.Vector3(0, 1, 0)
      // limbs + ball joints, both sides
      SIDES.forEach((s, si) => {
        const mat = s === p.near ? mats.near : mats.far
        LIMBS.forEach((l, li) => {
          const m = limbRefs.current[si * LIMBS.length + li]
          if (!m) return
          const A = p.P(l.a, s)
          const B = p.P(l.b, s)
          const d = B.clone().sub(A)
          // cylinder's +y is the distal (narrow) end
          orient(m, A.clone().lerp(B, 0.5), d, p.front, 1, d.length(), 1)
          m.material = mat
        })
        BALLS.forEach((b, bi) => {
          const m = ballRefs.current[si * BALLS.length + bi]
          if (m) orient(m, p.P(b.j, s), up, p.front, b.r, b.r, b.r)
        })
        // hand: closed fist just past the wrist, toward the bar
        const hand = part.current[`hand${si}`]
        if (hand) {
          const E = p.P('elbow', s)
          const W = p.P('wrist', s)
          const d = W.clone().sub(E).normalize()
          orient(hand, W.clone().addScaledVector(d, 0.055), d, p.front, 0.034, 0.055, 0.045)
          hand.material = mat
        }
        // foot: from the ankle forward along the toes, sole on the floor
        const foot = part.current[`foot${si}`]
        if (foot) {
          const A = p.P('ankle', s)
          const fwd = new THREE.Vector3(p.toe, 0, 0)
          orient(foot, new THREE.Vector3(A.x + p.toe * 0.075, Math.max(0.035, A.y - 0.055), A.z), fwd, up, 0.04, 0.13, 0.05)
          foot.material = mat
        }
      })

      // torso: pelvis, abdomen, ribcage — ellipsoids along the spine, flattened front-to-back
      const H = p.P('hip', 1).add(p.P('hip', -1)).multiplyScalar(0.5)
      const S = p.P('shoulder', 1).add(p.P('shoulder', -1)).multiplyScalar(0.5)
      const spine = S.clone().sub(H)
      const len = spine.length()
      const dir = spine.clone().normalize()
      const at = (u: number) => H.clone().addScaledVector(dir, len * u)
      const place = (key: string, u: number, depth: number, half: number, width: number, fwd = 0) => {
        const m = part.current[key]
        if (m) orient(m, at(u).addScaledVector(p.front, fwd), dir, p.front, depth, half, width)
      }
      place('pelvis', 0.06, 0.1, 0.12, 0.155)
      place('abdomen', 0.4, 0.095, 0.2, 0.13)
      place('chest', 0.76, 0.115, 0.2, 0.175, 0.01)
      // neck + head
      const head = p.P('head', 0)
      const neckM = part.current.neck
      if (neckM) {
        const top = S.clone().lerp(head, 0.55)
        const d = top.clone().sub(S)
        orient(neckM, S.clone().lerp(top, 0.5), d, p.front, 1.3, d.length(), 1.3)
      }
      const hd = part.current.head
      if (hd) {
        const d = head.clone().sub(S).normalize()
        orient(hd, head.clone().addScaledVector(d, 0.05), d, p.front, 0.095, 0.115, 0.085)
      }
    },
  }))

  const cast = { castShadow: true, receiveShadow: true }
  return (
    <group ref={g}>
      {SIDES.flatMap((_, si) =>
        LIMBS.map((_l, li) => (
          <mesh key={`l${si}${li}`} ref={(m) => void (limbRefs.current[si * LIMBS.length + li] = m)} geometry={geo.limbs[li]} material={mats.near} {...cast} />
        )),
      )}
      {SIDES.flatMap((_, si) =>
        BALLS.map((_b, bi) => (
          <mesh key={`b${si}${bi}`} ref={(m) => void (ballRefs.current[si * BALLS.length + bi] = m)} geometry={geo.sphere} material={mats.joint} {...cast} />
        )),
      )}
      {['hand0', 'hand1', 'foot0', 'foot1', 'pelvis', 'abdomen', 'chest', 'neck', 'head'].map((k) => (
        <mesh key={k} ref={(m) => void (part.current[k] = m)} geometry={k === 'neck' ? geo.limbs[1] : geo.sphere} material={mats.near} {...cast} />
      ))}
    </group>
  )
})
