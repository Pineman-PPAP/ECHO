import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { FireflyJar } from '../src/game/FireflyJar';
import { humFromMic } from '../src/input/mapping';

function run(jar: FireflyJar, seconds: number, hum: ReturnType<typeof humFromMic> | null): void {
  for (let t = 0; t < seconds; t += 0.016) jar.update(0.016, hum);
}

describe('FireflyJar', () => {
  it('stays dark without humming, brightens gradually and fades naturally back to darkness', () => {
    const jar = new FireflyJar();
    expect(jar.lit).toBe(false);
    expect(jar.radius).toBe(0);
    run(jar, 10, null);
    expect(jar.glow).toBe(0);
    run(jar, 0.1, humFromMic(30, 220, 30));
    const early = jar.glow;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.5);
    run(jar, 2, humFromMic(30, 220, 30));
    expect(jar.glow).toBeGreaterThan(early);
    expect(jar.glow).toBeGreaterThan(0.95);
    expect(jar.glow).toBeLessThanOrEqual(1);
    expect(jar.radius).toBeCloseTo(CONFIG.JAR_MAX_RADIUS_M, 0);
    const beforeRelease = jar.glow;
    jar.update(0.016, null);
    expect(jar.glow).toBeGreaterThan(beforeRelease * 0.9);
    expect(jar.glow).toBeLessThan(beforeRelease);
    run(jar, 0.5, null);
    expect(jar.glow).toBeGreaterThan(0);
    expect(jar.glow).toBeLessThan(beforeRelease * 0.5);
    expect(jar.lit).toBe(true);
    run(jar, 2, null);
    expect(jar.glow).toBe(0);
    expect(jar.radius).toBe(0);
    expect(jar.lit).toBe(false);
    run(jar, 6, null);
    expect(jar.lit).toBe(false);
  });

  it('a louder hum glows brighter and reaches further; even a faint hum gives some light', () => {
    const faint = new FireflyJar();
    const loud = new FireflyJar();
    run(faint, 3, humFromMic(CONFIG.HUM_MIN_ABOVE_FLOOR_DB, 220, 30));
    run(loud, 3, humFromMic(30, 220, 30));
    expect(faint.glow).toBeCloseTo(CONFIG.JAR_MIN_HUM_GLOW, 1);
    expect(loud.radius).toBeGreaterThan(faint.radius);
    expect(faint.radius).toBeGreaterThan(CONFIG.JAR_MIN_RADIUS_M);
  });

  it('a higher note excites the fireflies', () => {
    const low = new FireflyJar();
    const high = new FireflyJar();
    run(low, 2, humFromMic(30, CONFIG.HUM_LOW_PITCH_HZ, 30));
    run(high, 2, humFromMic(30, CONFIG.HUM_HIGH_PITCH_HZ, 30));
    expect(high.excitement).toBeGreaterThan(0.9);
    expect(low.excitement).toBeLessThan(0.05);
  });
});
