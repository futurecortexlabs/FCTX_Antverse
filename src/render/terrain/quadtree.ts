/**
 * Camera-driven quadtree level-of-detail selection for the ground, by
 * screen-space geometric error. Pure logic (no three.js) so the guarantees
 * can be tested.
 *
 * Level 0 is the root square [-H, H]²; level L nodes have side 2H / 2^L and
 * are meshed with chunkQuads² quads, so vertex spacing halves per level.
 * A node's geometric error is the bound on how far the true (full-detail)
 * surface can deviate from its mesh: octaves dropped by the band limit plus
 * linear-interpolation error of the kept ones (Terrain.reliefMargin). A node
 * is split while that error, projected at the node's distance, exceeds
 * maxScreenError pixels. Detail finer than the mesh is shaded per pixel.
 *
 * Children replace their parent only when all four meshes are ready, so the
 * drawn set always covers the ground exactly once (no holes, no overlap).
 */

export interface QuadParams {
  halfExtent: number;
  chunkQuads: number;
  minSpacing: number;
  maxScreenError: number;
  /** Vertical bound of the relief (node boxes span [-reliefBound, reliefBound]). */
  reliefBound: number;
  /** Geometric error (mm) of a mesh with vertex spacing h. */
  errorAt: (h: number) => number;
}

export interface NodeRef {
  level: number;
  ix: number;
  iz: number;
}

export const nodeKey = (level: number, ix: number, iz: number): number => (level * 0x10000 + ix) * 0x10000 + iz;

export function maxLevel(p: QuadParams): number {
  const rootSpacing = (2 * p.halfExtent) / p.chunkQuads;
  return Math.max(0, Math.ceil(Math.log2(rootSpacing / p.minSpacing)));
}

export function nodeSize(p: QuadParams, level: number): number {
  return (2 * p.halfExtent) / 2 ** level;
}

export function nodeSpacing(p: QuadParams, level: number): number {
  return nodeSize(p, level) / p.chunkQuads;
}

export function nodeOrigin(p: QuadParams, n: NodeRef): [number, number] {
  const s = nodeSize(p, n.level);
  return [-p.halfExtent + n.ix * s, -p.halfExtent + n.iz * s];
}

/** Distance from (cx, cy, cz) to the node's bounding box. */
export function nodeDistance(p: QuadParams, n: NodeRef, cx: number, cy: number, cz: number): number {
  const s = nodeSize(p, n.level);
  const [x0, z0] = nodeOrigin(p, n);
  const dx = Math.max(x0 - cx, 0, cx - (x0 + s));
  const dz = Math.max(z0 - cz, 0, cz - (z0 + s));
  const dy = Math.max(-p.reliefBound - cy, 0, cy - p.reliefBound);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Per-level geometric error (mm), index = level. */
export function levelErrors(p: QuadParams): Float64Array {
  const max = maxLevel(p);
  const e = new Float64Array(max + 1);
  for (let l = 0; l <= max; l++) e[l] = p.errorAt(nodeSpacing(p, l));
  return e;
}

/** Projected error (px) of node n seen from (cx, cy, cz); `focal` = viewport px / (2 tan(fov/2)). */
export function screenError(errors: Float64Array, p: QuadParams, n: NodeRef, cx: number, cy: number, cz: number, focal: number): number {
  const d = nodeDistance(p, n, cx, cy, cz);
  return d <= 0 ? Infinity : (errors[n.level]! * focal) / d;
}

/**
 * Collect the nodes to draw. `ready` reports whether a node's mesh exists;
 * `want` is called for every missing node the view needs (callers queue
 * those for building). The root must be ready.
 */
export function selectNodes(
  p: QuadParams, errors: Float64Array, cx: number, cy: number, cz: number, focal: number,
  ready: (n: NodeRef) => boolean, want: (n: NodeRef, distance: number) => void,
): NodeRef[] {
  const out: NodeRef[] = [];
  const max = errors.length - 1;
  const visit = (n: NodeRef): void => {
    if (n.level < max && screenError(errors, p, n, cx, cy, cz, focal) > p.maxScreenError) {
      const kids: NodeRef[] = [];
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) kids.push({ level: n.level + 1, ix: n.ix * 2 + i, iz: n.iz * 2 + j });
      let all = true;
      for (const k of kids) if (!ready(k)) { all = false; want(k, nodeDistance(p, k, cx, cy, cz)); }
      if (all) { for (const k of kids) visit(k); return; }
    }
    out.push(n);
  };
  visit({ level: 0, ix: 0, iz: 0 });
  return out;
}

/** Focal length in pixels for a vertical field of view (radians) and viewport height (px). */
export const focalPx = (fovRad: number, viewportPx: number): number => viewportPx / 2 / Math.tan(fovRad / 2);
