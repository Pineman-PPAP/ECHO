import { CONFIG } from '../config';
import { yawForward } from './grid';

/** Sounds with nothing behind them. Positions are world (x, z); the App plays them in 3D. */
export type AmbientCue =
  /** A scrape where no Hollow is. */
  | { cue: 'fakeScrape'; x: number; z: number }
  /** The player's own clap, copied: late, and from behind. */
  | { cue: 'mimic'; x: number; z: number; loudness: number };

const DEG2RAD = Math.PI / 180;

/**
 * Schedules the cave's lies: fake scrapes now and then, and the occasional clap that echoes back late
 * from the wrong direction "as if something is copying you". Pure and seeded so tests are deterministic.
 */
export class Ambience {
  private nextFakeMs: number | null = null;
  private mimicReadyMs = 0;
  private pending: { atMs: number; x: number; z: number; loudness: number } | null = null;

  constructor(private readonly rand: () => number) {}

  /**
   * @param nearestHollowM distance to the nearest Hollow (fake scrapes only play when none is close)
   * @param claps loudness of every pulse the player made this frame
   * @param quiet the player is in a silent stretch: no fake sounds there
   */
  update(nowMs: number, px: number, pz: number, yaw: number, nearestHollowM: number, claps: readonly number[], quiet: boolean): AmbientCue[] {
    const out: AmbientCue[] = [];
    this.nextFakeMs ??= nowMs + this.fakeGap();
    if (nowMs >= this.nextFakeMs) {
      this.nextFakeMs = nowMs + this.fakeGap();
      if (!quiet && nearestHollowM > CONFIG.FAKE_SCRAPE_CLEAR_M) {
        out.push({ cue: 'fakeScrape', ...this.behind(px, pz, yaw, CONFIG.FAKE_SCRAPE_DISTANCE_M) });
      }
    }
    if (claps.length > 0 && this.pending === null && nowMs >= this.mimicReadyMs && !quiet && this.rand() < CONFIG.MIMIC_CHANCE) {
      const loudness = Math.max(...claps);
      this.pending = { atMs: nowMs + CONFIG.MIMIC_DELAY_MS, ...this.behind(px, pz, yaw, CONFIG.MIMIC_DISTANCE_M), loudness };
      this.mimicReadyMs = nowMs + CONFIG.MIMIC_COOLDOWN_MS;
    }
    if (this.pending && nowMs >= this.pending.atMs) {
      out.push({ cue: 'mimic', x: this.pending.x, z: this.pending.z, loudness: this.pending.loudness });
      this.pending = null;
    }
    return out;
  }

  private fakeGap(): number {
    return CONFIG.FAKE_SCRAPE_MIN_MS + this.rand() * (CONFIG.FAKE_SCRAPE_MAX_MS - CONFIG.FAKE_SCRAPE_MIN_MS);
  }

  /** A point `dist` metres behind the player, up to AMBIENT_BEHIND_SPREAD_DEG to either side. */
  private behind(px: number, pz: number, yaw: number, dist: number): { x: number; z: number } {
    const f = yawForward(yaw + Math.PI + (this.rand() * 2 - 1) * CONFIG.AMBIENT_BEHIND_SPREAD_DEG * DEG2RAD);
    return { x: px + f.x * dist, z: pz + f.z * dist };
  }
}
