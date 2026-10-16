# M6: Deliverables (README, technical doc, demo script, demo-day checklist, final QA)

**Goal:** produce what the judges asked for:
1. a working playable prototype
2. source code
3. **brief technical documentation covering the input method, system architecture and implementation**
4. **a short demo**

Plus a checklist so the live demo goes smoothly. Use only facts you can verify in the code or in the numbers recorded in `PROGRESS.md`. **Never invent measurements.** If a number is missing, ask the user to read it from the debug panel.

All documents live in `controller-free-game/` (not inside `echo/`).

## 0. Before you start (added 2026-10-11, at the user's request)

- **M6 runs after the gameplay pass.** `PROGRESS.md` has an item "Gameplay pass" (thrill fixes and the cave look, ideas in `DIRECTIONS.md` §4). The documents describe the game, so writing them first means rewriting them. If that item isn't ticked, stop and ask the user whether it's done or dropped.
- **Describe the game as it is in the code at that point**, not as this file or `00-START-HERE.md` describe it. Check in particular:
  - the monster rules (blink, and anything added in the gameplay pass, such as visible eyes, the look-away rule or a new creature)
  - the exit guide (gold floor arrows plus a chime placed a few route cells ahead: `game/guide.ts`, `render/GuideTrail.ts`)
  - the level list and the visuals (sonar grid or cave)
  - every number. Numbers come only from `CONFIG` and `PROGRESS.md`; values quoted below (14 dB, 15 dB, …) are the plan's originals and may have changed.
- **Facts that changed after this file was written:**
  - **Headphones are mandatory**, not recommended: on speakers the game hears its own sounds, which breaks humming and claps (M3 T10). Bluetooth earbuds are fine for output; the input must stay the built-in mic.
  - **Hum-to-recalibrate on the game-over and victory cards doesn't work** (M3 T9). The user's decision: reload the page for a new player. The cards still show "Hum to recalibrate (new player)". Ask the user whether to fix it or remove the hint, and do that before final QA. Never tell judges to hum to recalibrate.
  - **Browser:** the user runs Google Chrome; Chromium isn't installed. `npm run demo` picks Chromium or Chrome and uses its own profile (`~/.cache/echo-demo-browser`), so it opens full-screen even if the user's browser is already open.
  - **The render scale defaults to 0.75** (M3: 47 fps at 1.0 vs 66+ fps at 0.75 on the integrated GPU). Adaptive quality can lower it to 0.6.
  - **Laptop prep for demo day lives in `DEMO_DAY_TUNING.md`** (power/EPP, mic gain, built-in-mic check, symptom → `CONFIG` table). `DEMO_DAY.md` links to it instead of repeating it.
  - **Bloom was not added** (M5 §8 needs ≥ 58 fps with face tracking at scale 1.0; it measured 47).
  - **Why the exit guide is visual** (a good engineering story for TECHNICAL.md): the first version guided only by a 3D chime, and testers couldn't find the exit. Earbud HRTF audio can't tell front from back, so a chime behind sounds like one ahead. The fix routes BFS from the player's cell and draws gold arrows on the next few route cells, keeping the chime as a pointer to them.

## 1. `controller-free-game/README.md`

Sections, in order:
1. **ECHO**: a one-sentence pitch. Then "A horror escape game played in total darkness, controlled only by your voice, your eyes and your head." Then 3 bullets for the core mechanics (sound → sight, hum pitch → beam width, blinking → monsters move).
2. **Controls**: the table from `plan/00-START-HERE.md` §3, rewritten for players.
3. **Run it**:
   ```bash
   cd echo
   npm install
   npm run assets   # one-time: MediaPipe runtime + face model, for offline play
   npm run demo     # production build, opens full-screen Chromium
   ```
   Plus the dev server alternative (`npm run dev` → `http://127.0.0.1:5173`).
4. **Requirements**: Chromium or Chrome, webcam, microphone, **headphones (required)**, a reasonably lit face. Tested on an Intel i7-13620H laptop with integrated graphics (Linux).
5. **URL flags**: the table from START-HERE §9, with `?sim=1` labelled *development only*.
6. **Project layout**: a short tree of `echo/src` with one line per folder.
7. **Docs**: links to `docs/TECHNICAL.md`, `docs/DEMO_SCRIPT.md`, `docs/DEMO_DAY.md`.

## 2. `controller-free-game/docs/TECHNICAL.md` (the required technical documentation, about 4–6 pages)

Required sections. Under each heading is what it must contain and where to get the facts.

1. **Overview**: what the game is; the design principle that every input is analog and physically meaningful (START-HERE §2 table).
2. **Input methods**
   - *Camera / face:* MediaPipe FaceLandmarker (Tasks Vision 0.10.35, WebGL GPU delegate, CPU fallback) at 640×480@30. Outputs used:
     - the `eyeBlinkLeft`/`eyeBlinkRight` blendshapes, averaged
     - the facial transformation matrix → yaw (YXZ Euler) and depth (|tz|)
     
     Processing:
     - blink hysteresis with per-player calibrated thresholds (`EyeState`, `blinkThresholdsFromCalibration`)
     - One-Euro filtering of yaw and lean (`OneEuroFilter`, parameters from `CONFIG`)
     - rate-controlled turning with a dead zone (`yawToTurnRate`)
     - lean = neutralDepth/depth − 1 → walking speed (`leanToSpeed`)
   - *Microphone:* `getUserMedia` with echo cancellation, noise suppression and AGC **disabled** (why: they flatten transients and pump levels). AnalyserNode polled per frame. **Every new 128-sample hop** is processed using `AudioContext.currentTime`, so onset timing is independent of frame rate (`MicAnalyzer`). Then:
     - noise floor = 20th percentile of 3 s of hop levels, frozen while humming (`NoiseFloor`)
     - onset = level ≥ floor + 14 dB **and** a rise ≥ 15 dB over 4 hops (~10.7 ms), with a 200 ms refractory period and peak measurement over the next 4 hops (`OnsetDetector`); explain why slow hum attacks don't trigger it
     - YIN pitch (difference function, CMNDF, absolute threshold, parabolic interpolation; `yin.ts`)
     - hum = voiced + loud + pitch spread ≤ 0.15 octave over 5 estimates + attack/release debounce (`HumDetector`); explain how this rejects speech
   - *Calibration (~15 s, hands-free, audio cues):* the 9 steps of `CalibrationRunner` and what each measures. Include the automatic head-yaw sign detection and the speaker-leak test.
3. **Mapping design** (why it isn't a disguised button): sound → reveal radius *and* noise radius (hearing always exceeds sight); pitch → beam width (directivity); blink → monster mobility (involuntary input as the threat); lean → walking; face loss → pause (never punish tracker failure). Put `CONFIG` values in a table.
4. **System architecture**: a Mermaid flowchart of the pipeline (sensors → processing → `IntentBuilder` → `World` → renderer / Sfx / HUD), a module table (file → responsibility → pure or not), the per-frame order, and the app state machine (copy the diagram from the `App.ts` class comment).
5. **Game logic**:
   - grid world, collision (sub-stepped circle vs grid), BFS pathfinding
   - the exit guide: BFS route → gold floor arrows on the next route cells, and the chime placed a few cells ahead (see §0 for why audio alone failed)
   - hearing model (radius from loudness, ×1.6 effective distance through walls, via Amanatides–Woo grid traversal)
   - monster states (idle / alert / search)
   - reveals and afterimages
6. **Rendering**: the reveal shader (expanding spherical wavefront, exponential fade, bright front band, normal-aware world-space grid lines with `fwidth` anti-aliasing, hum cone), one merged wall mesh, afterimages as pooled additive figures.
7. **Audio feedback**: procedural Web Audio (no asset files), HRTF panners for monsters and the exit chime, heartbeat tied to danger, mic gating when speakers leak.
8. **Latency and performance**: the measured numbers from `PROGRESS.md` (M3 T1, M5 §6). Also an analytic audio budget:
   - mic buffer
   - onset decision ≈ 4 hops ≈ 10.7 ms at 48 kHz
   - ≤ 1 frame poll (16.7 ms)
   - render + display ≈ 1–2 frames
   
   The face path is the camera frame (33 ms) plus inference (the measured ms).
9. **Robustness**: offline assets, adaptive render scale, pause on face loss / tab hidden, device-loss errors, calibration fallbacks with warnings.
10. **Testing**: the unit-test count (run `npm run check` and quote the number), what the suites cover, sim mode and scripted state-machine checks, the human test protocol (M3 tables, summarised).
11. **Limitations and future work**: honest points, e.g. noisy venues still affect onsets (headset mic advised), extreme lighting hurts face tracking, a single player. Future ideas: rPPG heart-rate from the webcam so the Hollows "hear your heartbeat", procedural levels, a multiplayer "one sees, one hears" mode.

## 3. `controller-free-game/docs/DEMO_SCRIPT.md`: the video (2:00–2:30)

The user records it; you write the script. Format: a table with time, what's on screen, and the narration line.

1. **0:00–0:10 Hook:** black screen; a clap; the cave lights up in a sonar wave. Title.
2. **0:10–0:30 The rule set**, shown (not told) in the tutorial: clap (radius), soft click vs loud clap, hum high vs low (beam width), head turn, lean to walk.
3. **0:30–1:05 The blink mechanic** in "The Listener":
   - a clap reveals a red Hollow
   - the player blinks; the eyelid overlay closes
   - the next clap shows it much closer
   - a "they moved" flash, then the heartbeat rises
4. **1:05–1:30 Under the hood:** toggle the debug panel and point at the pipeline (face mesh and blink bar; level chart with onset markers; pitch → beam; intent numbers; event log). One sentence on calibration.
5. **1:30–1:50 Tension and payoff:** a near-catch, a narrow escape to the gold exit, *or* a jumpscare and a clap to retry.
6. **1:50–2:10 Close:** "No keyboard. No mouse. No controller. Just your voice, your eyes and your nerve."

Recording guidance for the user:
- OBS Studio (`sudo pacman -S obs-studio`): capture the screen **plus a small camera picture-in-picture of the player**, so judges see that only voice/face are used.
- Capture desktop audio and mic.
- Record 1080p30.
- Use `npm run demo` (full screen).

## 4. `controller-free-game/docs/DEMO_DAY.md`: live demo checklist

- **The night before:** `npm run demo` with Wi-Fi off works end to end. Charger packed. Earbuds charged (output only; the input stays the built-in mic), plus a spare pair for judges. Run through `DEMO_DAY_TUNING.md` §1.
- **Setup (5 min):**
  - quiet corner if possible
  - light source in front of the player, not behind
  - screen and camera at eye level
  - volume ~60 %
  - close every other app (RAM)
  - disable OS notifications
  - `npm run demo -- '?debug=1'`
- **Per judge (3 min):**
  - 20-second pitch (script it: problem → idea → the blink twist)
  - hand them the headphones
  - **reload the page (F5) and click Begin** so calibration reruns for them (about 15–20 s); hum-to-recalibrate doesn't work (see §0)
  - let them play the tutorial (≈1 min), then "The Listener"
- **Talking points for technical judges:** the three novel mappings; the hop-based onset detector; YIN + steadiness rejecting speech; calibrated blink hysteresis; head-yaw sign auto-detection; pause-on-face-loss; fully offline; numbers from TECHNICAL §8.
- **If something breaks:**

| Problem | Fix |
|---|---|
| No face detected | More light on the face; sit closer; reload to recalibrate |
| Claps ignored | Move away from loud neighbours; reload to recalibrate (the clap step); see `DEMO_DAY_TUNING.md` §3 |
| Inverted turning | Reload to recalibrate; turn the head further during the "Turn" step |
| Audio silent | Click anywhere / reload (autoplay); check the output device |
| Everything fails | Show the recorded video; open `?sim=1` only to show the visuals, and say it's the dev mode |

## 5. Final QA (do it yourself, then with the user)

1. Fresh copy test: `git clone` (or copy) to a temp dir, `npm install && npm run assets && npm run check && npm run build`. Everything passes.
2. `npm run demo`: full hands-free playthrough tutorial → The Listener → The Choir → victory, by the user, without touching keyboard or mouse except the Begin click.
3. No console errors except MediaPipe's INFO lines.
4. README steps reproduce exactly.
5. The repo contains no `node_modules/`, `dist/`, `public/mediapipe/` or `public/models/` (check `git status`).
6. `grep -rn "TODO\|FIXME\|console.log" echo/src` → nothing left that matters.
7. No stale player-facing text: the "Hum to recalibrate" hint is fixed or removed (§0), and prompts and hints match the current mechanics (e.g. `grep -rn "chime" echo/src/app echo/src/game/Tutorial.ts`).

## Acceptance

- [ ] README, TECHNICAL, DEMO_SCRIPT and DEMO_DAY written. Every number in them traces to `PROGRESS.md` or code.
- [ ] Final QA §5 passes (user confirmed the hands-free full playthrough).
- [ ] The user has recorded (or scheduled) the demo video.
- [ ] Tick M6 in `plan/PROGRESS.md`. 🎉
