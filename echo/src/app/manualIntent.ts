import type { ManualPhase, StepId } from './FieldManual';
import { idleIntent, type PlayerIntent } from '../input/intent';

/** Restrict the practice scene to the action currently being taught. Sensors/skip still see raw input. */
export function manualStepIntent(
  frame: { phase: ManualPhase; step: { id: StepId } | null } | null,
  input: PlayerIntent,
): PlayerIntent {
  const out = { ...idleIntent(), facePresent: input.facePresent };
  if (!input.facePresent || frame?.phase !== 'await') return out;
  switch (frame.step?.id) {
    case 'hum':
    case 'quiet':
      out.hum = input.hum;
      out.humStarted = input.humStarted;
      break;
    case 'turnLeft':
      out.turnRate = Math.max(input.turnRate, 0);
      break;
    case 'turnRight':
      out.turnRate = Math.min(input.turnRate, 0);
      break;
    case 'leanIn':
      out.moveSpeed = Math.max(input.moveSpeed, 0);
      break;
    case 'leanBack':
      out.moveSpeed = Math.min(input.moveSpeed, 0);
      break;
    case 'clapReveal':
      out.pulses = input.pulses;
      break;
  }
  return out;
}
