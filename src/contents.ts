import * as THREE from 'three';

// What rattles around inside the shell. These have to be OPAQUE materials:
// the renderer builds its transmission pass from the opaque scene, so anything
// marked transparent simply will not appear through the glass.
//
// The simulation runs entirely in the capsule's LOCAL frame, with world gravity
// rotated into that frame each step. That is what makes the pill feel like a
// container rather than a rigid prop — spin it and the contents pour along the
// new down, exactly as a handful of capsules would in a real glass one.

export type Fill = 'pills' | 'orbs' | 'mixed' | 'empty';
export const FILL_NAMES: Fill[] = ['pills', 'orbs', 'mixed', 'empty'];

const MAX = 120;

// straight off the reference frame: a hot coral red, a warm cream, an off-white
const PILL_COLORS = [0xe8452f, 0xf25c3d, 0xd93b28, 0xfaf3e4, 0xffffff, 0xf6e8d2, 0xef7a58];
// the Wabi orb palette
const ORB_COLORS = [0xff6b4a, 0xffc76b, 0x6bb8ff, 0x9d7bff, 0xff8fb8, 0x54d6a8, 0xf5f0e6, 0x2f2b33];

interface Item {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  spin: THREE.Vector3;
  r: number;
  scale: number;
  kind: 0 | 1; // 0 = capsule, 1 = sphere
  slot: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Contents {
  readonly group = new THREE.Group();

  private caps: THREE.InstancedMesh;
  private orbs: THREE.InstancedMesh;
  private items: Item[] = [];
  private capCount = 0;
  private orbCount = 0;

  private half: number;
  private innerR: number;
  private baseSize: number;

  /** local-space gravity, refreshed from the pill's world orientation */
  readonly gravity = new THREE.Vector3(0, -1, 0);
  gravityScale = 5.2;
  restitution = 0.36;
  damping = 0.988;

  constructor(half: number, innerR: number, size: number) {
    this.half = half;
    this.innerR = innerR;
    this.baseSize = size;

    const capGeo = new THREE.CapsuleGeometry(1, 2.0, 12, 24);
    const orbGeo = new THREE.SphereGeometry(1, 24, 16);

    const capMat = new THREE.MeshPhysicalMaterial({
      roughness: 0.34,
      metalness: 0,
      clearcoat: 0.85,
      clearcoatRoughness: 0.18,
      sheen: 0.4,
      sheenRoughness: 0.5,
      envMapIntensity: 1.0,
    });
    const orbMat = new THREE.MeshPhysicalMaterial({
      roughness: 0.16,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.1,
    });

    this.caps = new THREE.InstancedMesh(capGeo, capMat, MAX);
    this.orbs = new THREE.InstancedMesh(orbGeo, orbMat, MAX);
    this.caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.orbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.caps.frustumCulled = false;
    this.orbs.frustumCulled = false;
    this.caps.count = 0;
    this.orbs.count = 0;
    this.group.add(this.caps, this.orbs);
  }

  setEnv(env: THREE.Texture | null) {
    for (const m of [this.caps.material, this.orbs.material] as THREE.MeshPhysicalMaterial[]) {
      m.envMap = env;
      m.needsUpdate = true;
    }
  }

  resize(half: number, innerR: number, size: number) {
    this.half = half;
    this.innerR = innerR;
    this.baseSize = size;
    for (const it of this.items) {
      it.r = size * it.scale;
      this.contain(it, false);
    }
    this.writeMatrices();
  }

  /** (Re)seed the interior. Scatter-then-settle beats a neat grid — a lattice
   *  stays visible for a surprisingly long time once gravity takes over. */
  fill(kind: Fill, count: number, sizeMul = 1) {
    this.items.length = 0;
    this.capCount = 0;
    this.orbCount = 0;
    if (kind === 'empty' || count <= 0) {
      this.caps.count = 0;
      this.orbs.count = 0;
      return;
    }

    const size = this.baseSize * sizeMul;
    for (let i = 0; i < Math.min(count, MAX); i++) {
      let itemKind: 0 | 1;
      if (kind === 'pills') itemKind = 0;
      else if (kind === 'orbs') itemKind = 1;
      else itemKind = Math.random() < 0.55 ? 0 : 1;

      const scale = 0.72 + Math.random() * 0.56;
      const r = size * scale;
      const limit = Math.max(0.001, this.innerR - r);

      // uniform-ish inside the capsule volume
      const x = (Math.random() * 2 - 1) * (this.half + limit * 0.5);
      const rad = Math.sqrt(Math.random()) * limit * 0.92;
      const a = Math.random() * Math.PI * 2;

      const it: Item = {
        pos: new THREE.Vector3(x, Math.cos(a) * rad, Math.sin(a) * rad),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6),
        quat: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(Math.random() * 6.283, Math.random() * 6.283, Math.random() * 6.283)
        ),
        spin: new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2),
        r,
        scale,
        kind: itemKind,
        slot: 0,
      };
      it.slot = itemKind === 0 ? this.capCount++ : this.orbCount++;
      this.items.push(it);
      this.contain(it, false);
    }

    this.caps.count = this.capCount;
    this.orbs.count = this.orbCount;

    const c = new THREE.Color();
    for (const it of this.items) {
      if (it.kind === 0) {
        c.setHex(PILL_COLORS[(Math.random() * PILL_COLORS.length) | 0]);
        this.caps.setColorAt(it.slot, c);
      } else {
        c.setHex(ORB_COLORS[(Math.random() * ORB_COLORS.length) | 0]);
        this.orbs.setColorAt(it.slot, c);
      }
    }
    if (this.caps.instanceColor) this.caps.instanceColor.needsUpdate = true;
    if (this.orbs.instanceColor) this.orbs.instanceColor.needsUpdate = true;
    this.writeMatrices();
  }

  /** Clamp an item inside the capsule interior; optionally bounce it. */
  private contain(it: Item, bounce = true) {
    const limit = this.innerR - it.r;
    if (limit <= 0) {
      it.pos.set(THREE.MathUtils.clamp(it.pos.x, -this.half, this.half), 0, 0);
      return;
    }
    const cx = THREE.MathUtils.clamp(it.pos.x, -this.half, this.half);
    _v.set(it.pos.x - cx, it.pos.y, it.pos.z);
    const d = _v.length();
    if (d > limit) {
      _v.multiplyScalar(1 / (d || 1));
      it.pos.set(cx + _v.x * limit, _v.y * limit, _v.z * limit);
      if (bounce) {
        const vn = it.vel.dot(_v);
        if (vn > 0) {
          it.vel.addScaledVector(_v, -(1 + this.restitution) * vn);
          // scuff: a wall hit should set it tumbling, not just redirect it
          it.spin.addScaledVector(
            _axis.set(_v.y, -_v.x, _v.z * 0.4),
            vn * 1.4
          );
        }
      }
    }
  }

  step(dt: number) {
    const n = this.items.length;
    if (!n) return;

    const g = _v.copy(this.gravity).multiplyScalar(this.gravityScale * dt);

    for (let i = 0; i < n; i++) {
      const a = this.items[i];
      a.vel.add(g);
      a.vel.multiplyScalar(this.damping);
      a.pos.addScaledVector(a.vel, dt);
    }

    // pairwise separation — O(n²), but n tops out at 120 and the capsule is a
    // tight volume, so a broadphase would cost more than it saves
    for (let i = 0; i < n; i++) {
      const a = this.items[i];
      for (let j = i + 1; j < n; j++) {
        const b = this.items[j];
        const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y, dz = b.pos.z - a.pos.z;
        const min = a.r + b.r;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= min * min || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d, nz = dz / d;
        const pen = (min - d) * 0.5;
        a.pos.x -= nx * pen; a.pos.y -= ny * pen; a.pos.z -= nz * pen;
        b.pos.x += nx * pen; b.pos.y += ny * pen; b.pos.z += nz * pen;

        const rvn = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny + (b.vel.z - a.vel.z) * nz;
        if (rvn < 0) {
          const imp = -(1 + this.restitution) * rvn * 0.5;
          a.vel.x -= nx * imp; a.vel.y -= ny * imp; a.vel.z -= nz * imp;
          b.vel.x += nx * imp; b.vel.y += ny * imp; b.vel.z += nz * imp;
          a.spin.x += ny * imp * 0.8; a.spin.z -= nx * imp * 0.8;
          b.spin.x -= ny * imp * 0.8; b.spin.z += nx * imp * 0.8;
        }
      }
    }

    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      this.contain(it, true);
      it.spin.multiplyScalar(0.965);
      const s = it.spin.length();
      if (s > 1e-4) {
        _axis.copy(it.spin).multiplyScalar(1 / s);
        _dq.setFromAxisAngle(_axis, s * dt);
        it.quat.premultiply(_dq).normalize();
      }
    }

    this.writeMatrices();
  }

  /** One hard knock — used by the shake control and by a flick of the pointer. */
  impulse(strength = 3) {
    for (const it of this.items) {
      it.vel.x += (Math.random() - 0.5) * strength;
      it.vel.y += (Math.random() - 0.5) * strength;
      it.vel.z += (Math.random() - 0.5) * strength;
      it.spin.x += (Math.random() - 0.5) * strength;
      it.spin.y += (Math.random() - 0.5) * strength;
      it.spin.z += (Math.random() - 0.5) * strength;
    }
  }

  private writeMatrices() {
    for (const it of this.items) {
      const s = it.r;
      // the capsule geometry is r=1, cylinder length 2 → bounding radius 2, so
      // scale by r/2 to keep the collision sphere honest
      const gs = it.kind === 0 ? s * 0.5 : s;
      _q.copy(it.quat);
      _m.compose(it.pos, _q, _v.set(gs, gs, gs));
      if (it.kind === 0) this.caps.setMatrixAt(it.slot, _m);
      else this.orbs.setMatrixAt(it.slot, _m);
    }
    this.caps.instanceMatrix.needsUpdate = true;
    this.orbs.instanceMatrix.needsUpdate = true;
  }
}

export { _up };
