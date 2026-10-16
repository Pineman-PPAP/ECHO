# ECHO: demo-day tuning (in-person hackathon)

Checklist and fix table for running ECHO in a noisy hall. For a Claude session at the venue: read this file first, then `CLAUDE.md`. Every tunable number is in `echo/src/config.ts` (`CONFIG`). Change **one** value at a time, ask the user to retest, and log the change in `plan/PROGRESS.md`. After any change, `npm run check` and `npm run build` in `echo/` must pass.

## 1. Before the demo (laptop setup)

The first T1 run failed only because of the power state: inference took 33 ms instead of 19 ms, and render ran at 30 fps instead of 66.

1. **Plug in the charger.**
2. Set the CPU to performance (needs sudo; resets on reboot or unplug):
   ```
   echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/energy_performance_preference
   ```
   Check: `cat /sys/devices/system/cpu/cpu0/cpufreq/energy_performance_preference` prints `performance`.
3. Close Zed, Firefox, extra Chrome windows and anything else heavy.
4. **Use the built-in mic**, not the Bluetooth earbuds' mic (Linux drops Bluetooth audio to a low-quality call mode when its mic is used). Check `wpctl inspect @DEFAULT_AUDIO_SOURCE@ | grep description`; it should say `Built-in Audio Analog Stereo`.
5. Mic hardware gain (may reset on reboot). Known-good values on card 0:
   ```
   amixer -c 0 sset Capture 25%
   amixer -c 0 sset 'Internal Mic Boost' 0
   amixer -c 0 sset Digital 50%
   ```
   The PipeWire input volume was 0.08 when the tests passed (`wpctl get-volume @DEFAULT_AUDIO_SOURCE@`).
6. `cd echo && npm run demo -- '?debug=1'` (production build, full-screen, its own browser profile; close the window to stop). Fallback: `npm run dev`, then open Chrome at `http://127.0.0.1:5173/?debug=1`.
7. **Calibrate at the venue**, in the spot where you'll demo. Calibration measures the room's noise and your clap, so calibrating at home is useless in the hall.
8. Light your face from the front (a lamp or a bright screen), not from behind.
9. **Headphones are mandatory.** Hand players your earbuds. On the laptop speakers the game hears its own sounds, which breaks humming and clapping (tested in M3, not fixable by tuning). Bluetooth earbuds are fine for listening; after connecting them, re-check step 4 so the input is still the built-in mic.
10. **New player = reload the page** (F5), then click Begin. That reruns calibration for them. Don't rely on "hum to recalibrate" on the game-over card; it didn't trigger in testing.

## 2. Numbers measured at home (2026-10-10)

| What | Value |
|---|---|
| Face tracking | 30 fps, 15–27 ms, GPU |
| Render | 66–90 fps at `RENDER_SCALE` 0.75 (47 fps at 1.0, too low) |
| Hum | 124-273 Hz detected reliably (`YIN_MAX_APERIODICITY` 0.3); wakes the firefly jar. Pitch only changes how excited the fireflies look (`HUM_LOW/HIGH_PITCH_HZ` 110-300) |
| Calibration | `leftSign 1 · leak false · 0 warnings` |
| Blink | 11/11 counted, open score 0.16 |
| Head yaw | centre -1°, right about -20°, left about +20° |
| Lean depth | lean in 30 / sitting 40 / lean back 50 |
| Mic floor (quiet bedroom, fan off) | about -70 to -77 dB |
| Clap | far above the floor (loudness capped at 1.5 without calibration) |

## 3. What's different in a noisy hall

- The noise floor will be about **-50 to -40 dB** instead of -70. The onset detector already handles that: a test guarantees that soft claps and tongue clicks 20 dB above a -43 dB floor still register.
- `FLOOR_MIN_DB` was raised from -100 to -68 to stop faint noises triggering pulses in a silent bedroom. **In the hall it has no effect.** Leave it as is.
- New risks: people clapping, shouting or laughing nearby; chatter waking the firefly jar; speakers on other stands.
- **Headphones are required.** In a loud room you'd turn the speakers up, and the game's own sounds would leak into the mic.

## 4. Symptom → fix (in this order)

Read the debug panel (`?debug=1`, or press the backtick key `` ` ``) before changing anything.

| Symptom at the venue | Check in the debug panel | Fix in `CONFIG` |
|---|---|---|
| Neighbours' claps or voices fire pulses | ② `floor` and EVENTS `PULSE loudness` values | First: sit closer to the laptop and recalibrate. Then `ONSET_MIN_ABOVE_FLOOR_DB` 14 → 17 (careful: the "soft clap in a noisy room" test may then need to be revisited; don't delete it) |
| Talking or laughter fires pulses | as above | `ONSET_RISE_DB` 15 → 18 (same test caveat) |
| Your claps are missed | ② `above floor` when you clap | Clap closer to the mic or harder. Then `ONSET_MIN_ABOVE_FLOOR_DB` 14 → 11 |
| Chatter wakes the fireflies | ② `hum ON` while you're silent | `HUM_MAX_PITCH_SPREAD_OCT` 0.15 → 0.1, or `HUM_MIN_ABOVE_FLOOR_DB` 10 → 13 |
| Your hum doesn't wake the fireflies | ② `pitch`, `hum`, `above floor` | Hum louder and closer. `HUM_MIN_ABOVE_FLOOR_DB` 10 → 8, `HUM_ATTACK_MS` 100 → 70 |
| Hum flickers off mid-note | ② `hum ON/off` flicker | `HUM_RELEASE_MS` 180 → 260 |
| Face lost or flickering (game keeps pausing) | ① `face ✓` and fps | Light the face from the front; avoid a bright window behind you |
| Low fps / laggy | ① inference ms, ④ `render NN fps` | Redo section 1 (charger plugged in, performance mode, other apps closed). Then `FACE_DELEGATE` 'GPU' vs 'CPU' |
| Head turn goes the wrong way | debug log `calibrated · leftSign` | Recalibrate and turn further during the "left" step. Don't hard-code the sign |
| Walking without leaning | ① `lean` at rest | Recalibrate while sitting the way you will play. Then `LEAN_FWD_DEADZONE` 0.07 → 0.10 |
| Judges get caught too often | ④ EVENTS `HEARD you`, monster distances | `HUNT_SPEED_FAR` 3.6 → 3.0 and `HUNT_SPEED_NEAR` 1.9 → 1.6 (keep NEAR below `MAX_SPEED_FWD` 2.4) |
| The chase feels harmless | as above | `HUNT_SPEED_NEAR` 1.9 → 2.1 (a walking player is then caught only if they stop) |
| Sneaking past a Hollow feels impossible | ④ EVENTS `heard footstep` | `FOOTSTEP_MIN_AUDIBLE` 0.04 → 0.07 (quiet steps up to a faster lean) |
| Humming next to a Hollow is never punished | ④ EVENTS `heard hum` | `HUM_NOISE_SCALE` 0.05 → 0.1 (heard within ~6 m instead of ~5 m) |
| Too dark to find the way | — | `CAVE_AFTERGLOW` 0.5 → 0.6, `CAVE_EXPOSURE` 1.7 → 2.0 |
| Calibration too slow for the queue | — | `CALIB_INTRO_MS` 2600 → 1800, `CALIB_RESULT_MS` 1600 → 1000, `CALIB_DONE_MS` 9000 → 6000 |

**Quick recovery:** reload the page (F5) to recalibrate. If you're under time pressure and only sound is a problem, recalibrating usually fixes it without any code change.
