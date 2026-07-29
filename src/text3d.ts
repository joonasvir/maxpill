import * as THREE from 'three';
import { parse, type Font } from 'opentype.js';

// Real extruded geometry from the real Selecta outlines.
//
// The label started life as a plane with an alpha-cutout mask, which has two
// problems the reference frames make obvious. First, `alphaTest` is a BINARY
// decision per pixel — there is no partial coverage, so every glyph edge is a
// hard staircase no matter how large the mask canvas gets. Second, a plane is a
// slice: it has no thickness, so it can never catch a highlight on its side
// wall the way cut type does.
//
// Both are the same fix. Tessellating the actual curves gives edges that the
// renderer's own multisampling resolves, and gives a solid with real depth and
// a real bevel.

export interface Text3DOpts {
  depth: number;
  bevel: number;
  /** target height of the cap-height, in world units */
  size: number;
}

let fontPromise: Promise<Font> | null = null;

export function loadFont(url: string): Promise<Font> {
  if (!fontPromise) {
    fontPromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`font ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => parse(b));
  }
  return fontPromise;
}

interface Contour {
  pts: THREE.Vector2[];
  path: THREE.Path;
  area: number;
}

function signedArea(pts: THREE.Vector2[]) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function inside(pt: THREE.Vector2, poly: THREE.Vector2[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      hit = !hit;
    }
  }
  return hit;
}

/**
 * Build shapes for `text`. opentype hands back a single path holding every
 * contour of every glyph, so the outers and the counters have to be separated
 * here — a counter is simply a contour that falls inside another one. Winding
 * direction alone is not safe to rely on across fonts.
 */
export function textShapes(font: Font, text: string, unitSize = 1): THREE.Shape[] {
  // opentype's y grows DOWNWARD; three's grows up, so every y is negated as it
  // is read rather than flipping the geometry afterwards (which would also
  // reverse the extrusion direction).
  const p = font.getPath(text, 0, 0, unitSize);

  const contours: Contour[] = [];
  let cur: THREE.Path | null = null;
  let pts: THREE.Vector2[] = [];
  let cx = 0;
  let cy = 0;

  const flush = () => {
    if (cur && pts.length > 2) {
      contours.push({ pts, path: cur, area: Math.abs(signedArea(pts)) });
    }
    cur = null;
    pts = [];
  };

  for (const c of p.commands) {
    if (c.type === 'M') {
      flush();
      cur = new THREE.Path();
      cur.moveTo(c.x, -c.y);
      pts = [new THREE.Vector2(c.x, -c.y)];
      cx = c.x;
      cy = c.y;
    } else if (!cur) {
      continue;
    } else if (c.type === 'L') {
      cur.lineTo(c.x, -c.y);
      pts.push(new THREE.Vector2(c.x, -c.y));
      cx = c.x;
      cy = c.y;
    } else if (c.type === 'C') {
      cur.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
      // flatten a few samples for the containment test only
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        const mt = 1 - t;
        const x = mt * mt * mt * cx + 3 * mt * mt * t * c.x1 + 3 * mt * t * t * c.x2 + t * t * t * c.x;
        const y = mt * mt * mt * cy + 3 * mt * mt * t * c.y1 + 3 * mt * t * t * c.y2 + t * t * t * c.y;
        pts.push(new THREE.Vector2(x, -y));
      }
      cx = c.x;
      cy = c.y;
    } else if (c.type === 'Q') {
      cur.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
      for (let i = 1; i <= 5; i++) {
        const t = i / 5;
        const mt = 1 - t;
        const x = mt * mt * cx + 2 * mt * t * c.x1 + t * t * c.x;
        const y = mt * mt * cy + 2 * mt * t * c.y1 + t * t * c.y;
        pts.push(new THREE.Vector2(x, -y));
      }
      cx = c.x;
      cy = c.y;
    } else if (c.type === 'Z') {
      if (cur) cur.closePath();
      flush();
    }
  }
  flush();

  // biggest first, so a counter is always tested against an outline that has
  // already been promoted to a Shape
  contours.sort((a, b) => b.area - a.area);

  const shapes: THREE.Shape[] = [];
  const owners: Contour[] = [];
  for (const c of contours) {
    const probe = c.pts[0];
    let host = -1;
    for (let i = 0; i < owners.length; i++) {
      if (inside(probe, owners[i].pts)) host = i;
    }
    if (host >= 0) {
      shapes[host].holes.push(c.path);
    } else {
      const s = new THREE.Shape();
      s.curves = c.path.curves;
      s.autoClose = true;
      shapes.push(s);
      owners.push(c);
    }
  }
  return shapes;
}

export function buildText3D(font: Font, text: string, opts: Text3DOpts) {
  const shapes = textShapes(font, text, 100);
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth: opts.depth * 100,
    bevelEnabled: opts.bevel > 0.0005,
    bevelThickness: opts.bevel * 100,
    bevelSize: opts.bevel * 100,
    bevelSegments: 4,
    curveSegments: 24, // the curves ARE the quality — this is the anti-staircase
  });

  // centre on its own bounds and normalise to the requested height. Centring
  // matters: the glyph run starts at the origin baseline, so without this the
  // label hangs off to one side and half of it sits outside the capsule.
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const w = bb.max.x - bb.min.x;
  const h = bb.max.y - bb.min.y;
  const d = bb.max.z - bb.min.z;
  geo.translate(-(bb.min.x + w / 2), -(bb.min.y + h / 2), -(bb.min.z + d / 2));

  const k = opts.size / h;
  geo.scale(k, k, k);
  geo.computeVertexNormals();
  return { geo, aspect: w / h };
}
