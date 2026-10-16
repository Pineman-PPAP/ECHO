import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { yawForward } from '../src/game/grid';
import { Hush } from '../src/game/Hush';
import { mulberry32 } from '../src/game/rng';

/** Steps the Hush for `ms` of silence (16 ms frames). Returns every event. */
function silence(h: Hush, ms: number, yaw = 0, rand = mulberry32(3)): string[] {
  const out: string[] = [];
  for (let t = 0; t < ms; t += 16) out.push(...h.update(0.016, 0, 0, yaw, 0, rand));
  return out;
}

describe('Hush', () => {
  it('stays away while the player makes sounds', () => {
    const h = new Hush();
    const rand = mulberry32(1);
    for (let t = 0; t < CONFIG.HUSH_SILENCE_MS * 2; t += 16) {
      const footstep = t % 1000 < 16 ? 0.1 : 0;
      h.update(0.016, 0, 0, 0, footstep, rand);
    }
    expect(h.present).toBe(false);
  });

  it('appears behind the player after a long silence and drifts closer', () => {
    const h = new Hush();
    const yaw = 0.7;
    const ev = silence(h, CONFIG.HUSH_SILENCE_MS + 32, yaw);
    expect(ev).toContain('appear');
    const d0 = h.distanceTo(0, 0);
    expect(d0).toBeGreaterThan(CONFIG.HUSH_SPAWN_DISTANCE_M - 1);
    const f = yawForward(yaw);
    expect(h.x * f.x + h.z * f.z).toBeLessThan(0); // behind
    silence(h, 3000, yaw);
    expect(h.distanceTo(0, 0)).toBeCloseTo(d0 - 3 * CONFIG.HUSH_SPEED, 0);
    expect(h.closeness(0, 0)).toBeGreaterThan(0);
  });

  it('a clap drives it back and away; it comes back after the next long silence', () => {
    const h = new Hush();
    silence(h, CONFIG.HUSH_SILENCE_MS + 2000);
    const before = h.distanceTo(0, 0);
    expect(h.update(0.016, 0, 0, 0, 0.25, mulberry32(1))).toEqual([]); // a soft sound: pushed back a little
    expect(h.distanceTo(0, 0)).toBeCloseTo(before + CONFIG.HUSH_PUSH_M * 0.25, 1);
    expect(h.update(0.016, 0, 0, 0, 1.5, mulberry32(1))).toContain('gone'); // a loud clap: gone
    expect(h.present).toBe(false);
    expect(silence(h, CONFIG.HUSH_SILENCE_MS + 32)).toContain('appear');
  });

  it('hovers for HUSH_RESUME_MS after a small sound, then keeps coming', () => {
    const h = new Hush();
    silence(h, CONFIG.HUSH_SILENCE_MS + 32);
    h.update(0.016, 0, 0, 0, 0.05, mulberry32(1));
    const d = h.distanceTo(0, 0);
    silence(h, CONFIG.HUSH_RESUME_MS - 100);
    expect(h.distanceTo(0, 0)).toBeCloseTo(d, 5);
    silence(h, 1000);
    expect(h.distanceTo(0, 0)).toBeLessThan(d);
  });

  it('catches a player who stays silent', () => {
    const h = new Hush();
    const total = CONFIG.HUSH_SILENCE_MS + ((CONFIG.HUSH_SPAWN_DISTANCE_M - CONFIG.HUSH_CATCH_M) / CONFIG.HUSH_SPEED) * 1000 + 500;
    expect(silence(h, total)).toContain('caught');
  });
});
