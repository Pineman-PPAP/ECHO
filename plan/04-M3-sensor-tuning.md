# M3: Real-sensor bring-up and tuning (HUMAN CHECK milestone)

**Goal:** prove every input channel works for *this* user, laptop and room, tune `CONFIG` with measured numbers, and play the first two levels completely hands-free. You can't do the physical tests yourself. Your job is to run the session with the user **one test at a time**, read their reports, and change config values.

## Before starting (ask the user)

1. Chromium is installed (`sudo pacman -S chromium`).
2. Headphones on. **Wired is best.** If Bluetooth, make sure the *laptop's* built-in mic is the input, not the headset mic (Linux switches Bluetooth to a low-quality call profile when its mic is used). Check: Settings → Sound → Input → built-in microphone.
3. Light falls on the face from the front (a lamp or window behind the screen, not behind the user).
4. `npm run dev` is running in `echo/`.

For every test, give the user: the URL, what to do, and exactly which numbers to read from the debug panel. Record the answers in `plan/PROGRESS.md` under "Notes", for example `M3 T2: open 0.06, closed 0.71, 10/10 blinks`.

## The tests

Use `http://127.0.0.1:5173/?skipcal=1&debug=1&level=0` for T1–T6 (no calibration; the tutorial level has no monsters). Click Begin, allow camera + mic, clap once to pass the intro.

| # | Ask the user to… | Read from the debug panel | Pass |
|---|---|---|---|
| T1 | Sit normally for 10 s | ① line 1: `face ✓ NN fps  NN.N ms  GPU`; ④ `render NN fps` | face fps ≥ 25, inference ≤ 25 ms, `GPU`, render ≥ 50 fps |
| T2 | Blink normally 10 times, then close the eyes for 2 s | ① `blinks N`, blink score with eyes open vs closed | ≥ 9 of 10 counted; open score clearly below the gold marker, closed clearly above the red one |
| T3 | Look at the screen's centre, then turn the head ~20° left and hold, then ~20° right | ① `yaw raw` at centre / left / right | Left and right have clearly different signs (≥ 10° each side). *Which* sign is left doesn't matter; calibration measures it |
| T4 | Lean ~10 cm toward the screen, then ~10 cm back | ① `depth` sitting / leaning in / leaning back | Depth changes ≥ 15 % each way |
| T5 | Stay quiet 10 s; then clap 10 times (1 s apart); then click the tongue 5 times | ② `floor` (dB); ② chart gold markers; debug log `PULSE` lines | Floor steady; 10/10 claps → 10 `PULSE`; 0 pulses while quiet; tongue clicks give smaller pulses (≥ 3/5) |
| T6 | Hum "mmmm" low, medium, high (2 s each); then say "testing one two three" | ② `pitch NNN Hz`, `hum ON/off`; ③ `beam NN°` | Hum ON within ~0.3 s for each note, pitch steady; beam narrower for higher notes; speech gives few or no hum activations |

Then the full flow, at `http://127.0.0.1:5173/?debug=1` (with calibration):

| # | Ask the user to… | Pass |
|---|---|---|
| T7 | Follow the calibration prompts | Done in ≤ 20 s. The debug log line `calibrated · leftSign ±1 · leak false · 0 warnings`. If there are warnings, note them and which step produced them |
| T8 | Play the tutorial **without touching keyboard or mouse**: turn the head to look, lean to walk, clap, hum, follow the chime to the exit | Turning left with the head turns the view **left**; walking feels controllable; reaches the exit in under 3 minutes |
| T9 | Clap to continue to "The Listener". Make noise, blink deliberately, watch the red afterimages jump closer. Get caught once on purpose, clap to retry, then **hum** on the game-over card | Afterimage positions change only after blinks; jumpscare plays; clap retries; hum starts recalibration |
| T10 | Take the headphones off (speakers only), recalibrate (hum on a game-over card, or reload) and play 1 minute | Calibration warns about speakers; game sounds (chime, footsteps, ping) do **not** create pulses on their own |

## Tuning guide (symptom → change)

Change **one** value at a time in `echo/src/config.ts`, ask the user to retest, and record the final value and the reason in `PROGRESS.md`. After tuning, `npm run check` must still pass. If a test fails because it asserted the old number on purpose, update that expectation and explain why in the notes. Never delete a test.

| Symptom | Change |
|---|---|
| Normal blinks are missed | `BLINK_CLOSE_FRACTION` 0.55 → 0.45 (keep `BLINK_OPEN_FRACTION` at least 0.1 below it) |
| "Eyes closed" while looking down at the screen | `BLINK_CLOSE_FRACTION` 0.55 → 0.65; also ask the user to raise the screen/camera |
| Turning feels twitchy / drifts at rest | `YAW_DEADZONE_DEG` 6 → 9 |
| Turning is too slow | `YAW_FULL_DEG` 24 → 18, or `MAX_TURN_RATE_DEG` 110 → 140 |
| Walks without meaning to | `LEAN_FWD_DEADZONE` 0.07 → 0.10 |
| Has to lean too far to walk | `LEAN_FWD_FULL` 0.25 → 0.18 |
| Claps missed in a noisy room | `ONSET_MIN_ABOVE_FLOOR_DB` 14 → 11 |
| False pulses from talking/typing | `ONSET_RISE_DB` 15 → 18 (claps rise 25+ dB in one hop, so they still pass) |
| Hum takes too long to start | `HUM_ATTACK_MS` 100 → 70 |
| Hum flickers off mid-note | `HUM_RELEASE_MS` 180 → 260, or `HUM_MAX_PITCH_SPREAD_OCT` 0.15 → 0.2 |
| Speech turns on the beam | `HUM_MAX_PITCH_SPREAD_OCT` 0.15 → 0.1 |
| Pulses too small/large for this user's clap | Calibration should handle this. If not, check `clapRefAboveDb` in the T7 log and adjust `PULSE_MAX_RADIUS` |
| Face fps < 20 | Compare `FACE_DELEGATE: 'CPU'` vs `'GPU'` (T1 numbers for both); keep the faster one. Close other apps (RAM was 10 GB used at the start) |
| Render fps < 45 | `RENDER_SCALE` 1 → 0.75 |
| Monsters too easy/hard | `MONSTER_SPEED_BLINK` (5), `HEAR_MAX_RADIUS` (34), `CATCH_DISTANCE` (1.1) |

**If the head-turn direction is inverted after calibration** (T8 fails): the `left` calibration step got the wrong sign. Look at the T3 numbers. If the user didn't turn far enough, it falls back to `leftSign = 1` with a warning; ask them to turn further during calibration. Don't hard-code a sign.

## Acceptance

- [ ] T1–T10 pass (user confirmed), with numbers recorded in `PROGRESS.md`.
- [ ] Every tuned value is recorded with its reason; `npm run check` and `npm run build` pass.
- [ ] Tick M3 in `plan/PROGRESS.md`.
