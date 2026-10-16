import { describe, expect, it } from 'vitest';
import { facingToYaw } from '../src/game/grid';
import { LEVELS } from '../src/game/levels';
import { Tutorial } from '../src/game/Tutorial';
import { World } from '../src/game/World';
import { beamFromHum } from '../src/input/mapping';
import { intent } from './helpers';

const DT = 1 / 60;

function setup(sim = false) {
  const world = new World(LEVELS[0], 1);
  const tutorial = new Tutorial(world, sim);
  let nowMs = 0;
  const tick = (o: Parameters<typeof intent>[0] = {}): void => {
    nowMs += DT * 1000;
    const i = intent(o);
    const events = world.update(DT, nowMs, nowMs / 1000, i);
    tutorial.update(DT, i, events);
  };
  return { world, tutorial, tick };
}

describe('Tutorial', () => {
  it('advances through every step when the player does the thing', () => {
    const { world, tutorial, tick } = setup();
    expect(tutorial.step).toBe('clap');
    tick({ pulses: [1] });
    expect(tutorial.step).toBe('loudness');
    tick({ pulses: [0.2] });
    expect(tutorial.step).toBe('loudness');
    tick({ pulses: [1] });
    expect(tutorial.step).toBe('look');

    for (let i = 0; i < 102; i++) tick({ turnRate: 1 });
    expect(tutorial.step).toBe('walk');

    world.player.yaw = facingToYaw('E');
    const start = world.player.distanceWalked;
    for (let i = 0; i < 600 && world.player.distanceWalked - start < 4.05; i++) tick({ moveSpeed: 2.4 });
    expect(tutorial.step).toBe('hum');

    const beam = beamFromHum(30, 220, 30);
    for (let i = 0; i < 96; i++) tick({ beam });
    expect(tutorial.step).toBe('exit');
    for (let i = 0; i < 60; i++) tick({ pulses: [1], beam });
    expect(tutorial.step).toBe('exit');
  });

  it('shows the sim key hint only in sim mode', () => {
    expect(setup(true).tutorial.prompt).toContain('[Space]');
    expect(setup(false).tutorial.prompt).not.toContain('[Space]');
  });
});
