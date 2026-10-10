/**
 * Device profile: phones get the `mobile` preset (lower pixel ratio, no GPU
 * timestamp queries, collapsed HUD) unless the URL forces a profile with
 * `?profile=mobile|desktop`. URL presets and `?set=` still override it.
 */

export type Profile = 'mobile' | 'desktop';

export interface DeviceEnv {
  /** Primary pointer is a finger (`(pointer: coarse)`). */
  coarsePointer: boolean;
  /** Shorter side of the screen in CSS px. */
  shortSide: number;
}

export function readDeviceEnv(): DeviceEnv {
  return {
    coarsePointer: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    shortSide: Math.min(screen.width, screen.height),
  };
}

export function detectProfile(env: DeviceEnv, mobileMaxShortSide: number, forced: string | null): Profile {
  if (forced === 'mobile' || forced === 'desktop') return forced;
  return env.coarsePointer && env.shortSide < mobileMaxShortSide ? 'mobile' : 'desktop';
}
