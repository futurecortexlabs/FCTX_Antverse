import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildConfig, type Overlay } from '../config/load.ts';
import { detectTier, isLocalHost, TIERS } from './device.ts';

const { config } = buildConfig();
const max = config.device.mobileMaxShortSide;
const PRESETS = join(import.meta.dirname, '..', '..', 'config', 'presets');
const tierPreset = (t: string): Overlay => JSON.parse(readFileSync(join(PRESETS, `quality-${t}.json`), 'utf8')) as Overlay;

const desktop = (hostname: string) => ({ coarsePointer: false, shortSide: 1440, hostname });

describe('quality tier detection', () => {
  it('local development is ultra, hosted copies are web', () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]', '192.168.1.20', '10.0.0.5', '172.20.3.4', 'mypc.local']) expect(detectTier(desktop(h), max, null)).toBe('ultra');
    for (const h of ['futurecortexlabs.github.io', 'claude.ai', '172.32.0.1', '8.8.8.8']) expect(detectTier(desktop(h), max, null)).toBe('web');
  });

  it('phones are mobile wherever they load from (including a LAN dev server)', () => {
    for (const h of ['192.168.1.20', 'futurecortexlabs.github.io']) expect(detectTier({ coarsePointer: true, shortSide: 390, hostname: h }, max, null)).toBe('mobile');
    expect(detectTier({ coarsePointer: true, shortSide: 1024, hostname: 'futurecortexlabs.github.io' }, max, null)).toBe('web');
  });

  it('?quality= forces a tier; unknown values are ignored', () => {
    expect(detectTier(desktop('localhost'), max, 'web')).toBe('web');
    expect(detectTier(desktop('example.com'), max, 'ultra')).toBe('ultra');
    expect(detectTier(desktop('localhost'), max, 'potato')).toBe('ultra');
  });

  it('isLocalHost does not treat public addresses as local', () => {
    expect(isLocalHost('172.15.0.1')).toBe(false);
    expect(isLocalHost('192.169.0.1')).toBe(false);
  });
});

describe('quality presets', () => {
  /** Groups a tier may change: rendering and UI only, so every tier simulates the same world. */
  const ALLOWED = new Set(['render', 'terrainRender', 'ui', 'quality']);

  it('every tier has a valid preset', () => {
    for (const t of TIERS) expect(() => buildConfig([tierPreset(t)])).not.toThrow();
    const tierFiles = readdirSync(PRESETS).filter((f) => f.startsWith('quality-'));
    expect(tierFiles.sort()).toEqual(TIERS.map((t) => `quality-${t}.json`).sort());
  });

  it('tier presets touch only render / UI groups (simulation is identical in every tier)', () => {
    for (const t of TIERS) for (const group of Object.keys(tierPreset(t))) expect(ALLOWED.has(group), `${t}: ${group}`).toBe(true);
  });

  it('ultra is the highest quality, mobile the lightest', () => {
    const c = Object.fromEntries(TIERS.map((t) => [t, buildConfig([tierPreset(t)]).config])) as Record<string, typeof config>;
    expect(c.ultra!.terrainRender.maxScreenError).toBeLessThan(c.web!.terrainRender.maxScreenError);
    expect(c.web!.terrainRender.maxScreenError).toBeLessThanOrEqual(c.mobile!.terrainRender.maxScreenError);
    expect(c.ultra!.terrainRender.shadowMapSize).toBeGreaterThan(c.web!.terrainRender.shadowMapSize);
    expect(c.ultra!.quality.auto).toBe(false);
    expect(c.web!.quality.auto).toBe(true);
    expect(c.mobile!.quality.auto).toBe(true);
    expect(c.mobile!.ui.hudCollapsed).toBe(true);
  });
});
