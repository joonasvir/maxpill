import * as THREE from 'three';

// The Wabi mark, taken from the source SVG (`wabi-logo-mark.svg`) rather than
// traced by eye. Five circles of r=28 at:
//
//   (28, 65.2)  (83.87, 65.26)  (139.81, 65.2)
//        (55.93, 113.53)  (111.81, 113.62)
//
// Normalised by the radius and re-centred, that is exactly five UNIT circles in
// hexagonal close packing: a top row of three at y = +√3/2 spaced 2 apart, and
// a bottom row of two at y = −√3/2 offset by 1. The row offset is √3 to four
// decimal places, which means the circles genuinely touch — the mark is a
// packing, not an arrangement, and building it from the exact constants keeps
// it that way at any scale.

const R3_2 = Math.sqrt(3) / 2;

export const LOGO_UNITS: Array<[number, number]> = [
  [-2, R3_2],
  [0, R3_2],
  [2, R3_2],
  [-1, -R3_2],
  [1, -R3_2],
];

/** half-extent of the mark in unit-radius space, including the circle radius */
export const LOGO_HALF_W = 3; // 2 + r
export const LOGO_HALF_H = R3_2 + 1;

export class WabiLogo {
  readonly group = new THREE.Group();
  readonly orbs: THREE.Mesh[] = [];
  private geo: THREE.SphereGeometry;

  /** radius of one orb in world units */
  radius: number;

  constructor(radius: number, material: THREE.Material) {
    this.radius = radius;
    this.geo = new THREE.SphereGeometry(radius, 96, 64);
    for (let i = 0; i < LOGO_UNITS.length; i++) {
      const m = new THREE.Mesh(this.geo, material);
      this.orbs.push(m);
      this.group.add(m);
    }
    this.spread(1);
  }

  setMaterial(mat: THREE.Material) {
    for (const o of this.orbs) o.material = mat;
  }

  /**
   * `t` 0 → all five orbs coincide at the centre as a single sphere; 1 → the
   * mark. The same scalar the capsule uses to go from orb to pill, so the two
   * subjects share one reveal rather than each inventing its own.
   */
  spread(t: number) {
    for (let i = 0; i < this.orbs.length; i++) {
      const [ux, uy] = LOGO_UNITS[i];
      this.orbs[i].position.set(ux * this.radius * t, uy * this.radius * t, 0);
    }
  }

  /** bounding-sphere radius at full spread, for the camera fit */
  boundRadius() {
    return Math.hypot(LOGO_HALF_W, LOGO_HALF_H) * this.radius;
  }

  dispose() {
    this.geo.dispose();
  }
}
