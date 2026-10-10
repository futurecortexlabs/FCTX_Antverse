import { describe, expect, it } from 'vitest';
import { buildConfig } from '../config/load.ts';
import { detectProfile } from './device.ts';
import mobilePreset from '../../config/presets/mobile.json' with { type: 'json' };

const { config } = buildConfig();
const max = config.device.mobileMaxShortSide;

describe('device profile', () => {
  it('phones (coarse pointer, short side below threshold) get the mobile profile', () => {
    expect(detectProfile({ coarsePointer: true, shortSide: 390 }, max, null)).toBe('mobile');
  });

  it('desktops and large touch screens stay desktop', () => {
    expect(detectProfile({ coarsePointer: false, shortSide: 390 }, max, null)).toBe('desktop');
    expect(detectProfile({ coarsePointer: true, shortSide: 1024 }, max, null)).toBe('desktop');
  });

  it('?profile= forces the profile; unknown values are ignored', () => {
    expect(detectProfile({ coarsePointer: false, shortSide: 2000 }, max, 'mobile')).toBe('mobile');
    expect(detectProfile({ coarsePointer: true, shortSide: 390 }, max, 'desktop')).toBe('desktop');
    expect(detectProfile({ coarsePointer: true, shortSide: 390 }, max, 'tablet')).toBe('mobile');
  });

  it('the mobile preset is a valid overlay', () => {
    const { config: m } = buildConfig([mobilePreset]);
    expect(m.ui.hudCollapsed).toBe(true);
    expect(m.render.maxPixelRatio).toBeLessThanOrEqual(config.render.maxPixelRatio);
  });
});
