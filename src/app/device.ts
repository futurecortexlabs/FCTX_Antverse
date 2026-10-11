/**
 * Quality tier, chosen from where and on what the app runs:
 *
 *   ultra   local development (localhost / LAN address) on a desktop: highest quality
 *   web     a hosted copy (GitHub Pages, artifact pages…): lighter, with automatic
 *           quality reduction so slow machines still get a usable frame rate
 *   mobile  phones (coarse pointer, short screen side): lightest, touch UI
 *
 * Each tier applies config/presets/quality-<tier>.json. Tiers only change
 * rendering and UI parameters, never simulation parameters, so a given seed
 * produces the same world in every tier (checked by a test).
 * `?quality=ultra|web|mobile` forces a tier; explicit `?preset=` and `?set=`
 * are applied after the tier and win.
 */

export type Tier = 'ultra' | 'web' | 'mobile';
export const TIERS: readonly Tier[] = ['ultra', 'web', 'mobile'];

export interface DeviceEnv {
  /** Primary pointer is a finger (`(pointer: coarse)`). */
  coarsePointer: boolean;
  /** Shorter side of the screen in CSS px. */
  shortSide: number;
  /** location.hostname */
  hostname: string;
}

export function readDeviceEnv(): DeviceEnv {
  return {
    coarsePointer: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
    shortSide: Math.min(screen.width, screen.height),
    hostname: location.hostname,
  };
}

/** Loopback, *.local and private-network (RFC 1918) addresses: the developer's own machine or LAN. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function detectTier(env: DeviceEnv, mobileMaxShortSide: number, forced: string | null): Tier {
  if (forced !== null && (TIERS as readonly string[]).includes(forced)) return forced as Tier;
  if (env.coarsePointer && env.shortSide < mobileMaxShortSide) return 'mobile';
  return isLocalHost(env.hostname) ? 'ultra' : 'web';
}
