/**
 * Soil material (TSL). Relief finer than a chunk's mesh is shaded per pixel
 * with the *same* noise the simulation uses — identical integer hash, salts,
 * wavelengths and amplitudes as terrain/noise.ts — so the bumps you see are
 * the bumps an ant touches. Per octave:
 *   weight = (1 - meshWeight) × pixelWeight
 *   meshWeight  = bandWeight(λ, chunk spacing)  (already in the geometry)
 *   pixelWeight = fades octaves out below detailMinPixels per wavelength
 * The detail perturbs the normal (exact heightfield gradient) and the soil
 * brightness.
 */

import * as THREE from 'three/webgpu';
import {
  cameraViewMatrix, cos, float, floor, fwidth, length, max, normalWorld, normalize, positionWorld,
  sin, smoothstep, uint, userData, vec3, vec4, vertexColor,
} from 'three/tsl';
import type { Config } from '../../config/params.ts';
import type { Terrain } from '../../terrain/terrain.ts';

type N = THREE.Node<'float'>;
type U = THREE.Node<'uint'>;

/** lowbias32, as core/rng.ts mix32 (uint arithmetic wraps mod 2^32 on GPUs). */
function mix32(x: U): U {
  const a = x.bitXor(x.shiftRight(uint(16)));
  const b = a.mul(uint(0x7feb352d));
  const c = b.bitXor(b.shiftRight(uint(15)));
  const d = c.mul(uint(0x846ca68b));
  return d.bitXor(d.shiftRight(uint(16)));
}

const PX = 0x27d4eb2d;
const PZ = 0x165667b1;
const GRAD_COUNT = 16;
/** Hash salt of the visual-only speckle (not part of the simulated relief). */
const SPECKLE_SALT = 0x5bd1e995;
/** Guards the slope division for near-vertical faces (chunk skirts). */
const MIN_NORMAL_Y = 0.05;

/** Gradient of lattice point (ix, iz) — as terrain/noise.ts gidx + GX/GZ. */
function grad(ix: N, iz: N, salt: number): THREE.Node<'vec3'> {
  const h = mix32(ix.toInt().toUint().mul(uint(PX)).bitXor(iz.toInt().toUint().mul(uint(PZ))).bitXor(uint(salt)));
  const a = h.bitAnd(uint(GRAD_COUNT - 1)).toFloat().mul((2 * Math.PI) / GRAD_COUNT);
  return vec3(cos(a), sin(a), 0);
}

/** Gradient noise with derivatives: returns vec3(value, d/dx, d/dz) — as terrain/noise.ts gradNoise. */
function gradNoise(px: N, pz: N, salt: number): THREE.Node<'vec3'> {
  const x0 = floor(px), z0 = floor(pz);
  const fx = px.sub(x0), fz = pz.sub(z0);
  const u = fx.mul(fx).mul(fx).mul(fx.mul(fx.mul(6).sub(15)).add(10));
  const v = fz.mul(fz).mul(fz).mul(fz.mul(fz.mul(6).sub(15)).add(10));
  const du = fx.mul(fx).mul(fx.sub(1)).mul(fx.sub(1)).mul(30);
  const dv = fz.mul(fz).mul(fz.sub(1)).mul(fz.sub(1)).mul(30);
  const g00 = grad(x0, z0, salt), g10 = grad(x0.add(1), z0, salt);
  const g01 = grad(x0, z0.add(1), salt), g11 = grad(x0.add(1), z0.add(1), salt);
  const n00 = g00.x.mul(fx).add(g00.y.mul(fz));
  const n10 = g10.x.mul(fx.sub(1)).add(g10.y.mul(fz));
  const n01 = g01.x.mul(fx).add(g01.y.mul(fz.sub(1)));
  const n11 = g11.x.mul(fx.sub(1)).add(g11.y.mul(fz.sub(1)));
  const k1 = n10.sub(n00), k2 = n01.sub(n00), k3 = n00.sub(n10).sub(n01).add(n11);
  const uv = u.mul(v);
  const value = n00.add(u.mul(k1)).add(v.mul(k2)).add(uv.mul(k3));
  const dx = g00.x.add(u.mul(g10.x.sub(g00.x))).add(v.mul(g01.x.sub(g00.x)))
    .add(uv.mul(g00.x.sub(g10.x).sub(g01.x).add(g11.x))).add(du.mul(k1.add(k3.mul(v))));
  const dz = g00.y.add(u.mul(g10.y.sub(g00.y))).add(v.mul(g01.y.sub(g00.y)))
    .add(uv.mul(g00.y.sub(g10.y).sub(g01.y).add(g11.y))).add(dv.mul(k2.add(k3.mul(u))));
  return vec3(value, dx, dz);
}

export function groundMaterial(terrain: Terrain, cfg: Config): THREE.MeshStandardNodeMaterial {
  const tr = cfg.terrainRender;
  const spacing = userData('spacing', 'float') as unknown as N;
  const footprint = length(fwidth(positionWorld.xz)) as unknown as N; // mm per pixel
  const px = positionWorld.x as unknown as N, pz = positionWorld.z as unknown as N;

  let height: N = float(0);
  let gx: N = float(0), gz: N = float(0);
  const f = terrain.micro;
  let lambda = f.wavelength;
  for (let i = 0; i < f.octaves; i++) {
    const L = float(lambda);
    const meshW = smoothstep(spacing.mul(2), spacing.mul(4), L);
    const pixW = smoothstep(footprint.mul(tr.detailMinPixels[0]!), footprint.mul(tr.detailMinPixels[1]!), L);
    const w = float(1).sub(meshW).mul(pixW);
    const n = gradNoise(px.div(lambda), pz.div(lambda), f.salts[i]!);
    const amp = f.amps[i]!;
    height = height.add(w.mul(amp).mul(n.x));
    gx = gx.add(w.mul(amp / lambda).mul(n.y));
    gz = gz.add(w.mul(amp / lambda).mul(n.z));
    lambda /= f.lacunarity;
  }

  // Mineral speckle: each speckle cell holds one fine grain — a disc at a random position, of random
  // size and brightness — instead of a flat square, so close-ups show grains rather than a checkerboard.
  // Faded out once a cell is under ~2 px.
  const cell = float(tr.soilSpeckleSize);
  const qx = px.div(cell), qz = pz.div(cell);
  const sx = floor(qx), sz = floor(qz);
  const hsh = mix32(sx.toInt().toUint().mul(uint(PX)).bitXor(sz.toInt().toUint().mul(uint(PZ))).bitXor(uint(SPECKLE_SALT)));
  const byte = (shift: number): N => hsh.shiftRight(uint(shift)).bitAnd(uint(0xff)).toFloat().div(0xff) as unknown as N;
  const [rMin, rMax] = [tr.soilSpeckleRadius[0]!, tr.soilSpeckleRadius[1]!];
  const radius = byte(16).mul(rMax - rMin).add(rMin);
  const cx = byte(0).mul(float(1).sub(radius.mul(2))).add(radius);
  const cz = byte(8).mul(float(1).sub(radius.mul(2))).add(radius);
  const dist = length(vec3(qx.sub(sx).sub(cx), qz.sub(sz).sub(cz), 0));
  const aa = footprint.div(cell);
  const inside = float(1).sub(smoothstep(radius.sub(aa), radius.add(aa), dist));
  const tone = byte(24).sub(0.5).mul(2 * tr.soilSpeckleContrast);
  const speckleW = smoothstep(footprint.mul(tr.detailMinPixels[0]!), footprint.mul(tr.detailMinPixels[1]!), cell);
  const speckle = float(1).add(tone.mul(inside).mul(speckleW));
  // Each speckle grain is a shallow dome: add its slope so it shades like a grain, not a painted dot.
  // (Visual only — sand finer than terrain.grainSize is not part of the simulated surface.)
  const domeK = inside.mul(speckleW).mul(-2 * tr.soilSpeckleRelief).div(radius);
  gx = gx.add(domeK.mul(qx.sub(sx).sub(cx)));
  gz = gz.add(domeK.mul(qz.sub(sz).sub(cz)));

  // Heightfield normal with the detail gradient added to the mesh gradient.
  const ny = max(normalWorld.y, float(MIN_NORMAL_Y));
  const nWorld = normalize(vec3(normalWorld.x.div(ny).sub(gx), float(1), normalWorld.z.div(ny).sub(gz)));
  const nView = normalize(cameraViewMatrix.mul(vec4(nWorld, 0)).xyz);

  const relief = float(1).add(height.mul(tr.soilDetailContrast / tr.soilShadeRange));
  const shade = relief.mul(speckle);
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
  material.colorNode = vec4(vertexColor().xyz.mul(shade), 1);
  material.normalNode = nView;
  return material;
}
