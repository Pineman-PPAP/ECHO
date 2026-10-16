# M2: Full application (sensors, calibration, monsters, audio, menus, HUD)

**Goal:** wire every subsystem into the real game:
- title screen
- camera/mic startup
- hands-free calibration
- level intros
- play, and pause when the face is lost
- monsters revealed as afterimages, with 3D sound
- caught → jumpscare → game over
- escape → next level → victory
- hands-free menus, HUD, and the pipeline debug panel

The files are in `plan/stages/M2/`. They were compiled and driven through **every state** in a browser in sim mode (Script B below printed exactly the expected list). **Copy them; don't retype or redesign them.** You verify in sim mode here; real camera/mic testing with the user is M3.

## 1. Copy the stage

From `controller-free-game/`:

```bash
cp -r plan/stages/M2/. echo/
```

| File | New / replaced | What it is |
|---|---|---|
| `src/input/Sensors.ts` | new | Owns the camera + mic stream, the hidden `<video>`, `FaceTracker` and `MicAnalyzer`. `Sensors.open(audioCtx, onStatus)` starts everything; `update(nowMs)` returns `{ face, mic }` |
| `src/ui/Card.ts` | new | The centred panel for every screen (title, loading, calibration step + webcam preview, intro, pause, game over, victory, errors). `show()` is safe to call every frame |
| `src/ui/Hud.ts` | new | In-game overlay: level + objective (top-left), live sensor chips (top-centre: EYES / MIC meter / HUM), prompt line (bottom; empty until M4) |
| `src/ui/DebugPanel.ts` | new | The "pipeline" panel judges look at: ① camera → face (mirrored thumbnail + landmarks, blink bar with calibrated thresholds, yaw/lean bars), ② mic → sound (4-second level chart with floor, onset and hum markers), ③ intent, ④ game, event log. Toggle with the backtick key |
| `src/render/Renderer.ts` | replaced | Adds `afterimages` (red monster silhouettes) and `showJumpscare()` / `hideJumpscare()` |
| `src/app/App.ts` | replaced | The full state machine and frame loop (diagram in the class comment) |
| `src/main.ts` | replaced | Same as before, plus a **sim-only** `window.__echo` hook for scripted tests |
| `src/styles.css` | replaced | Adds the debug panel, card and HUD styles |

## 2. How it fits together (read `App.ts` with this list)

- **Frame order** (`App.frame`): sensors → intent (`IntentBuilder`, or `SimInput` in sim) → `step()` (state machine) → `renderer.render()` → `updateAudio()` → `updateOverlays()`.
- **Audio is created synchronously inside the Begin click** (`begin()`). Moving `new AudioContext()` into a `.then()` breaks audio because of the autoplay policy.
- **Menus are hands-free:** clap (`intent.pulses.length > 0`) = confirm, hum (`intent.humStarted`) = secondary action (recalibrate for a new player). Input is ignored for `MENU_INPUT_DELAY_MS` after each screen appears, so the clap that closed one screen can't skip the next.
- `world.update()` runs **only** in `playing`. Intro, pause and menus freeze the simulation.
- Face lost while playing → `paused` (the game never punishes tracker loss). Face back for `FACE_FOUND_RESUME_MS` → `playing`.
- **Calibration** uses the reference `CalibrationRunner`. The App plays its cues (beep / double beep / test tone / tick) via `Sfx`, shows the webcam preview on the face/neutral/left steps, then calls `IntentBuilder.setCalibration()`.
- **Mic gating:** `Sfx` reports every sound it starts. `App.onGameSound` gates the mic only when calibration measured `speakerLeak`.
- **Event routing** (`App.route`):
  - `reveal` → `renderer.afterimages.spawn`
  - `pulse` → `sfx.ping`
  - `footstep` → `sfx.footstep`
  - `caught` → jumpscare + scream → `caught` state
  - `exit` → `escaped` / `victory`
- **3D audio** (`updateAudio`): moves the listener with the player; per monster, sets voice position, scrape (only while moving) and breathing (when within 9 m); runs the heartbeat from `world.danger()`; plays the exit chime every `CHIME_INTERVAL_MS`.
- New `CONFIG` keys used here (already in `config.ts` from M0): `MENU_INPUT_DELAY_MS`, `INTRO_AUTO_MS`, `JUMPSCARE_MS`.

## 3. Verify

`npm run check` (69 tests) and `npm run build` must pass.

`npm run dev`, then open `http://127.0.0.1:5173/?sim=1&level=1&debug=1`. Keep the system volume low; the game makes sounds.

> If nothing animates while you drive the page with browser tools, the browser pane is hidden: `requestAnimationFrame` doesn't run in hidden pages. Ask the user to show the pane.

### A. Manual walkthrough

| Step | Expected |
|---|---|
| Page loads | **ECHO** title card with a "Begin (dev sim)" button; debug panel on the right; gold dev badge at the bottom |
| Click Begin | Card "The Listener" with three intro lines. After ~1 s the hint "Space (clap) to begin" appears |
| Space | Card disappears. HUD top-left "THE LISTENER / Escape. Follow the chime. Don't blink."; chips "EYES OPEN · MIC · DEV SIM". A confirm chime, then the exit chime every 3.5 s from the exit's direction (use headphones) |
| Space (in game) | Pulse visual + sonar ping with echoes; debug log `PULSE loudness 1.00 r=17.7 m` |
| Hold ↑ | Footstep clicks |
| F | "I can't see you" card. F again → back to play within ~0.3 s |
| Backtick | Debug panel hides/shows |

### B. Scripted check (browser console, or your browser tool's JS runner)

On `?sim=1&level=1`: click Begin, press Space to start the level, then run:

```js
const app = window.__echo;
const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code }));
const tap = async (code) => { key('keydown', code); await new Promise(r => setTimeout(r, 40)); key('keyup', code); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const log = [];
// 1. Clap next to the monster, then keep the eyes closed: it hunts and catches us.
const w = app.world, m = w.monsters[0];
w.player.x = m.x - 6; w.player.z = m.z; w.player.yaw = -Math.PI / 2;
await tap('Space'); await wait(300);
log.push(`monster ${m.state}, afterimages ${app.renderer.afterimages.slots.filter(s => s.active).length}`);
key('keydown', 'KeyB'); await wait(1800); key('keyup', 'KeyB');
log.push(`after eyes closed: ${app.state.kind}`);
await wait(1800); log.push(`then: ${app.state.kind}`);
await wait(1100); await tap('Space'); await wait(200); log.push(`retry: ${app.state.kind}`);
await wait(1100); await tap('Space'); await wait(200); log.push(`start: ${app.state.kind}`);
// 2. Teleport onto the exit, twice (level 1 -> level 2 -> victory).
const ex = app.world.level.exit;
app.world.player.x = (ex.c + 0.5) * 3 + 0.3; app.world.player.z = (ex.r + 0.5) * 3;
await wait(200); log.push(`exit: ${app.state.kind}`);
await wait(1100); await tap('Space'); await wait(200); log.push(`next: ${app.state.kind} level ${app.levelIndex}`);
await wait(1100); await tap('Space'); await wait(200);
const ex2 = app.world.level.exit;
app.world.player.x = (ex2.c + 0.5) * 3 + 0.3; app.world.player.z = (ex2.r + 0.5) * 3;
await wait(200); log.push(`last exit: ${app.state.kind}`);
log;
```

It must print exactly what the verified build printed:

```
["monster alert, afterimages 1", "after eyes closed: caught", "then: gameover", "retry: intro",
 "start: playing", "exit: escaped", "next: intro level 2", "last exit: victory"]
```

While it runs you should also see:
- a red figure (afterimage) after the clap
- the jumpscare: a red figure filling the screen while the camera shakes, with a scream
- the red **THEY FOUND YOU** card, then the gold **YOU ESCAPED** and **YOU MADE IT OUT** cards

### C. Real-sensor smoke test (HUMAN, 1 minute)

Ask the user:

> Please open `http://127.0.0.1:5173/?skipcal=1&debug=1` in **Chromium**, click Begin and allow the camera and microphone. Tell me what you see.

Expected:
- The intro card appears.
- The debug panel shows the mirrored webcam with cyan face dots.
- `face ✓ ~30 fps`, inference under 25 ms, delegate `GPU`.
- The mic level line moves when they talk.

Thorough sensor testing is M3; here we only confirm startup works. If an error card appears, write its title and body into `PROGRESS.md` notes and fix startup before continuing.

## Acceptance

- [ ] `npm run check` and `npm run build` pass.
- [ ] Walkthrough A behaves as described.
- [ ] Script B prints exactly the expected list.
- [ ] Smoke test C confirmed by the user (or its failure fixed).
- [ ] No console errors except MediaPipe's startup INFO lines.
- [ ] Tick M2 in `plan/PROGRESS.md`.
