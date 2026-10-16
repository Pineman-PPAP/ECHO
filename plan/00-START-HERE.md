# ECHO: Start Here

Read this whole file before every session. It explains what we're building, how the code is organized, and the rules every milestone follows. Each milestone has its own file; read only the current one.

---

## 1. The game in one minute

**ECHO** is a first-person horror escape game played in total darkness.

- **Your voice is your light.** A clap, tongue click, knock or shout sends out a sonar wave that briefly lights up the 3D cave as a glowing wireframe. The louder the sound, the further the wave travels.
- **Humming is a flashlight.** A steady hum ("mmmm") projects a cone of light wherever your head points. A **higher note gives a narrower, sharper beam**; a lower note gives a wider one (like real sonar: high frequencies are more directional).
- **The creatures (the "Hollows") hunt by sound.** Every sound you make carries further than it lets you see. A loud clap shows you a lot but tells every creature nearby where you are. Footsteps make noise too.
- **The Hollows can only move while your eyes are closed.** The webcam watches your eyelids. Every blink lets them lunge closer. Keep your eyes shut too long and they come straight for you.
- **Your head steers.** Turn your head to look around. Lean toward the screen to walk; lean back to stop.
- **Headphones give 3D audio.** You *hear* where the creatures scrape and breathe, and a chime marks the exit.

Goal: reach the exit of each level without being caught. Three levels: a tutorial with no creatures, then one creature, then three.

## 2. The hackathon brief, and why ECHO fits it

The brief asks for a game controlled without keyboard, mouse, touchscreen or controller, where the input is *meaningfully tied to gameplay* (not "wave = press jump"). It wants a real pipeline (sensor → signal processing → recognition → mapping → game logic → real-time feedback) with low latency and reliable detection. Deliverables: playable prototype, source code, short technical documentation (input method, architecture, implementation), short demo video.

How ECHO answers it. Keep these points intact; they are the pitch:

| Input | Why it isn't a disguised button |
|---|---|
| Sound → sonar pulse | Sound literally becomes sight (echolocation). Loudness is analog: it sets the reveal radius *and* the noise risk. |
| Hum pitch → beam width | A continuous analog control with real physical logic (frequency vs directivity). |
| Blinking → creatures move | Blinking is involuntary. The threat comes from your own body; you can't "not press" it forever. |
| Head yaw → look, lean → walk | Leaning to move is the brief's own example of a natural mapping. |

Keyboard/mouse are allowed **only for development and debugging** (`?sim=1`, `?debug=1`). There is one unavoidable mouse click: the browser requires a click before it grants camera/mic access and starts audio. After that click, everything is hands-free, including menus (clap = confirm, hum = secondary action).

## 3. Controls (final mapping)

| Player does | Detected by | Game effect |
|---|---|---|
| Clap / click / knock / shout | Mic onset detector (sharp rise in level) | Sonar pulse from the player's head; radius and brightness grow with loudness. Creatures within hearing range come to investigate. |
| Hum a steady note | Mic: YIN pitch + steadiness + loudness | Beam in the look direction. Pitch → beam width; loudness → range and brightness. Makes a little noise every 0.6 s. |
| Blink / close eyes | Face blendshapes `eyeBlinkLeft` / `eyeBlinkRight` (calibrated thresholds, with hysteresis) | Creatures move only while the eyes are closed (fast after 0.9 s). Closed for 1.5 s or more alerts nearby creatures. |
| Turn head left/right | Face transform matrix → yaw (One-Euro filtered) | Camera turns at a rate proportional to head angle (rate control, so you can keep looking at the screen) |
| Lean toward/away from the screen | Face distance from camera vs calibrated rest distance | Walk forward / backward; faster lean = faster, louder footsteps |
| Face leaves the camera | No face for 400 ms | Game **pauses** ("I can't see you"), so tracker glitches never kill the player |

## 4. Target hardware and runtime

- The user's laptop: Intel i7-13620H, 16 GB RAM (about 10 GB already used by other apps), **Intel UHD integrated GPU only**, built-in 1080p30 webcam, built-in mic, EndeavourOS (Arch) Linux.
- Browser: **Chromium** (MediaPipe's GPU path is most tested there). Firefox is only a fallback. The user installs it with `sudo pacman -S chromium`; you can't run sudo.
- Served from `http://127.0.0.1:5173`. 127.0.0.1 is a secure context, so camera/mic work without HTTPS.
- **Must run fully offline.** Venue Wi-Fi is unreliable. MediaPipe wasm and the model are served from `public/` (see `npm run assets`). No CDNs, no Google Fonts, no network calls at runtime.
- Measured on this laptop:
  - The reveal shader renders at 60 fps at 1024×768.
  - MediaPipe FaceLandmarker initialises in 0.15–0.3 s and takes about 7–10 ms per frame with no face in view (expect 10–20 ms with a face).
  - Performance budget: render ≥ 50 fps, face inference ≤ 25 ms.

## 5. Tech stack (pinned; do not change)

| Package | Version | Use |
|---|---|---|
| `three` / `@types/three` | 0.186.1 / 0.186.0 | Rendering (WebGL2, custom ShaderMaterial) |
| `@mediapipe/tasks-vision` | 0.10.35 | FaceLandmarker: blink blendshapes and head transform |
| `vite` | 7.3.7 | Dev server and build |
| `typescript` | 5.9.3 | Strict typing (`tsc --noEmit`) |
| `vitest` | 3.2.7 | Unit tests |

Audio uses the plain Web Audio API: AnalyserNode for analysis; oscillators, noise buffers and HRTF PannerNodes for procedural sound effects. **There are no audio asset files**: every sound is synthesized in code.

`npm install` may print `npm warn install-scripts ... esbuild`. That's expected and harmless; the build works without it. Don't approve or "fix" it.

## 6. Folder layout (final state)

```
controller-free-game/
├── CLAUDE.md                  agent rules (auto-loaded)
├── README.md                  written in M6
├── plan/                      this plan: read-only except PROGRESS.md
│   ├── 00-START-HERE.md
│   ├── 01-M0-setup.md … 07-M6-deliverables.md
│   ├── PROGRESS.md            tick milestones here
│   ├── reference/             verified baseline project, copied into echo/ at M0
│   └── stages/M1, stages/M2   verified files copied into echo/ at M1 and M2
├── echo/                      THE GAME (created in M0)
│   ├── index.html
│   ├── package.json, package-lock.json, tsconfig.json, vite.config.ts, .gitignore
│   ├── scripts/fetch-assets.mjs, scripts/demo.sh (M5)
│   ├── public/mediapipe/wasm/*      (generated by `npm run assets`, gitignored)
│   ├── public/models/face_landmarker.task  (generated, gitignored)
│   ├── src/
│   │   ├── main.ts                 entry: reads URL flags, builds App          [M1, M2]
│   │   ├── config.ts               ALL tunables                                [ref]
│   │   ├── styles.css                                                          [M0, M1, M2, M4]
│   │   ├── app/App.ts              frame loop + state machine                  [M1 → M2 → M4/M5 edits]
│   │   ├── app/flags.ts            URL flags                                   [M1]
│   │   ├── input/
│   │   │   ├── intent.ts           PlayerIntent type                           [ref]
│   │   │   ├── mapping.ts          head/voice → numbers                        [ref]
│   │   │   ├── IntentBuilder.ts    sensor frames → PlayerIntent                [ref]
│   │   │   ├── calibration.ts      CalibrationRunner                           [ref]
│   │   │   ├── camera.ts           getUserMedia + <video>                      [ref]
│   │   │   ├── SimInput.ts         keyboard → PlayerIntent (DEV ONLY)          [M1]
│   │   │   ├── Sensors.ts          owns camera, mic, FaceTracker, MicAnalyzer  [M2]
│   │   │   ├── filters/OneEuro.ts                                              [ref]
│   │   │   ├── face/FaceTracker.ts, faceMath.ts, EyeState.ts                   [ref]
│   │   │   └── audio/MicAnalyzer.ts, OnsetDetector.ts, HumDetector.ts,
│   │   │             NoiseFloor.ts, yin.ts, dsp.ts                             [ref]
│   │   ├── game/
│   │   │   ├── World.ts, Player.ts, Monster.ts, PulseManager.ts,
│   │   │   │   grid.ts, hearing.ts, levels.ts, rng.ts                          [ref]
│   │   │   └── Tutorial.ts                                                     [M4, you write it]
│   │   ├── render/
│   │   │   ├── revealMaterial.ts, buildLevelMesh.ts                            [ref]
│   │   │   ├── monsterModel.ts, Afterimages.ts                                 [ref]
│   │   │   └── Renderer.ts                                                     [M1 → M2 → M5 edit]
│   │   ├── audio/Sfx.ts            procedural 3D audio                         [ref]
│   │   └── ui/
│   │       ├── Card.ts, Hud.ts, DebugPanel.ts                                  [M2]
│   │       └── Overlays.ts         eyelids, vignette, flash                    [M4, you write it]
│   └── tests/*.test.ts             68 reference + flags (M1) + tutorial (M4)
└── docs/                       written in M6
    ├── TECHNICAL.md
    ├── DEMO_SCRIPT.md
    └── DEMO_DAY.md
```

**Stage folders:** `plan/reference/`, `plan/stages/M1/` and `plan/stages/M2/` hold code that was compiled, unit-tested and driven in a browser on the target laptop before this plan was written. Milestones M0–M2 tell you to *copy* them (`cp -r … echo/`). That's deliberate: retyping 3,000 lines invites typos. You still read every copied file, because later milestones build on them. M3–M6 are yours to implement from the specs.

## 7. Architecture: the pipeline

```
 SENSORS                SIGNAL PROCESSING                  MAPPING                GAME LOGIC            FEEDBACK
┌──────────┐   ┌──────────────────────────────────┐   ┌───────────────┐   ┌───────────────────┐   ┌──────────────────────┐
│ webcam   │──▶│ FaceTracker (MediaPipe, GPU)     │──▶│               │   │ World.update()    │──▶│ Renderer (three.js)  │
│ 640x480  │   │  blink scores, head matrix       │   │ IntentBuilder │   │  Player (collide) │   │  reveal shader,      │
│ @30fps   │   │ faceMath → yaw / depth           │   │  + Calibration│──▶│  PulseManager     │   │  afterimages         │
└──────────┘   │ EyeState (hysteresis)            │   │  data         │   │  Monster AI (BFS) │   ├──────────────────────┤
┌──────────┐   │ OneEuro filters                  │   │ → PlayerIntent│   │  hearing model    │──▶│ Sfx (Web Audio,      │
│ mic      │──▶│ MicAnalyzer: 128-sample hops     │──▶│               │   │  reveals / catch  │   │  HRTF 3D sound)      │
│ (no AGC, │   │  NoiseFloor (percentile)         │   └───────────────┘   └───────────────────┘   ├──────────────────────┤
│  no NS)  │   │  OnsetDetector (claps)           │                                               │ HUD + DebugPanel     │
└──────────┘   │  YIN pitch + HumDetector (hums)  │                                               │ (sensor state, events│
               └──────────────────────────────────┘                                               │  latency numbers)    │
                                                                                                   └──────────────────────┘
```

**One animation frame, in this exact order (`App.frame(nowMs)`):**

1. `nowMs = performance.now()`; `clockS = (nowMs - appStartMs) / 1000`; `dtS = min((nowMs - lastMs)/1000, CONFIG.MAX_DT_S)`.
2. Sensors: `face = faceTracker.update(video, nowMs)` (null when the camera has no new frame, which happens about every other frame) and `mic = micAnalyzer.update(nowMs)`.
3. Mapping: `intent = intentBuilder.update(nowMs, face, mic)`. In sim mode: `intent = simInput.update(nowMs)`.
4. State machine (`App`): calibration / menus / pause / playing.
5. While playing: `events = world.update(dtS, nowMs, clockS, intent)`.
6. Feedback: route `events` to the renderer (afterimages), Sfx (sounds) and HUD (log); `renderer.render(world, clockS)`; update HUD and debug panel.

## 8. Conventions (follow exactly)

**Coordinates.**
- Grid cell `(c, r)`: `c` is the column (+x), `r` is the row (+z).
- Cell centre: `x = (c + 0.5) * CELL_SIZE`, `z = (r + 0.5) * CELL_SIZE`. `y` is up; the floor is at y = 0.
- `grid.ts` has `cellCenter`, `worldToCell`, `isWall`, `lineOfSight`, `findPath`, `moveWithCollision`. Use them; don't write new grid math.

**Yaw.**
- `player.yaw` *is* three.js `camera.rotation.y` (with `camera.rotation.order = 'YXZ'`).
- Forward vector = `(-sin yaw, 0, -cos yaw)` = `yawForward(yaw)`.
- **Positive turn rate = turn LEFT.**
- Facing N/E/S/W → `facingToYaw()`.

**Head yaw sign.** MediaPipe's yaw sign depends on the camera. Calibration measures it (`leftSign`), so never hard-code a sign. `IntentBuilder` already outputs `relYawLeftDeg` (positive = player turned to their own left).

**Time.** There are two clocks and they must not be mixed:
- `nowMs`: `performance.now()` milliseconds. Used by input, logic timers, monsters and debouncing.
- `clockS`: game clock in seconds since the app started. Used by anything the shader sees (`uTime`, pulse start times).

**Units.** Metres, seconds, milliseconds, degrees, dB are all named in `CONFIG` keys (`_M`, `_S`, `_MS`, `_DEG`, `_DB`, `_HZ`).

**Code style.**
- TypeScript strict; no `any`; no `// @ts-ignore`.
- Pure logic (game/, input/ except camera/FaceTracker/MicAnalyzer's AnalyserSource) must not import three.js scene objects, DOM or Web Audio, so it stays unit-testable. three.js math classes are fine.
- New pure logic gets a vitest test in `echo/tests/`.
- Match the reference code's style: small classes, doc comments that explain *why*, named exports, no default exports.
- No `console.log` spam in the frame loop. Debug info goes to the DebugPanel.

**DOM / UI.**
- Plain DOM + CSS (no framework). One stylesheet: `src/styles.css`.
- System font stack only (offline).
- Colours:
  - background `#000`
  - text `#cfe9ff`
  - sonar cyan `#4fd8ff`
  - exit gold `#ffc94a`
  - danger red `#ff2a2a`
  - muted `#5d7286`

## 9. URL flags (parsed once in `src/app/flags.ts`, M1)

| Flag | Meaning |
|---|---|
| `?sim=1` | **Development only.** No camera or mic. Keyboard drives a PlayerIntent (see M1). Skips calibration. Shows a "DEV SIM INPUT" badge. |
| `?debug=1` | Debug/pipeline panel visible from the start (the backtick key `` ` `` toggles it anyway). |
| `?level=N` | Start at level index N (0 = tutorial). |
| `?skipcal=1` | Real sensors, but skip calibration and use `defaultCalibration()`. |

Flags combine, e.g. `?sim=1&debug=1&level=1`.

## 10. How to verify your work

1. **Automated, every milestone:** in `echo/`, run `npm run check` (typecheck + all tests) and `npm run build`. Both must pass with zero errors.
2. **Sim mode:** `npm run dev`, open `http://127.0.0.1:5173/?sim=1&debug=1`.
   - If you have browser tools (an in-app browser / preview tool), use them to load the page, take screenshots, read console errors, and send key presses.
   - If you don't, ask the user to look and report.
3. **HUMAN CHECK:** real camera/mic behaviour (blinks, claps, hums, head turns) can only be tested by the user. Each milestone lists exactly what to ask. Give the user the exact URL and a short checklist, then wait.
4. **Console must be clean:** no errors and no repeated warnings while running, except MediaPipe's startup log lines (see Known pitfalls). The favicon is handled in M0 so there's no 404.

## 11. Known pitfalls (already solved; don't regress)

| Symptom | Cause | Fix (already in plan) |
|---|---|---|
| Canvas is 0×0 / black | Window size read as 0 at startup (hidden pane) | Renderer checks container size every frame and resizes when it changes; it skips rendering at 0 size |
| MediaPipe throws about timestamps | `detectForVideo` needs strictly increasing timestamps | `FaceTracker` enforces `max(round(now), last+1)` |
| AudioContext stays `suspended` | Autoplay policy | Create and `resume()` the AudioContext inside the Begin-button click handler |
| Claps barely register / hum level pumps | Browser AGC / noise suppression on the mic | `openCameraAndMic()` disables echoCancellation, noiseSuppression and autoGainControl |
| A pulse fires at startup | Onset history empty at boot | `OnsetDetector` waits for its lookback history before firing (fixed + tested) |
| Game sounds trigger pulses (speakers) | Speakers leak into the mic | Calibration measures `speakerLeak`; if true, Sfx gates the mic while it plays sounds. Headphones are recommended anyway (3D audio). |
| Grid lines everywhere on a wall | Using the coordinate along the surface normal | Reveal shader excludes the normal axis (done) |
| Colours look darker than the hex | Shader colour space | Reveal shader includes `#include <colorspace_fragment>` (done) |
| Vite: "Failed to load source map … vision_bundle" | Excluding MediaPipe from dep optimisation | Don't add `optimizeDeps.exclude`; use the provided `vite.config.ts` |
| Face tracking flickers in dim light | Low light | Demo tip: light the face from the front; calibration retries; game pauses instead of punishing |
| Console shows `[error] INFO: Created TensorFlow Lite XNNPACK delegate for CPU.` plus `W…`/`I…` lines from `face_landmarker_graph`, `gl_context` | MediaPipe's own startup logging (it prints INFO via console.error) | **Expected and harmless.** Don't try to suppress or "fix" it. Every other console error is a real bug. |
| You hear test beeps from your own speakers while testing | The page's AudioContext is live | Normal. Keep the volume low while developing. |

## 12. Milestones

| # | File | Goal | Needs human? |
|---|---|---|---|
| # | File | Goal | Code source | Needs human? |
|---|---|---|---|---|
| M0 | `01-M0-setup.md` | Create `echo/` from reference, install, fetch assets, 68 tests green | copy `reference/` | no |
| M1 | `02-M1-world-render.md` | Playable in **sim mode**: dark maze, walking, pulses, beam, exit | copy `stages/M1/` | no |
| M2 | `03-M2-full-app.md` | Full app: sensors, calibration, monsters, afterimages, 3D audio, menus, HUD, debug panel | copy `stages/M2/` | smoke test |
| M3 | `04-M3-sensor-tuning.md` | Real-sensor bring-up with the user; tune `CONFIG`; hands-free play of levels 0–1 | config edits | **yes** |
| M4 | `05-M4-tutorial-atmosphere.md` | Tutorial prompts, level hints, eyelids, danger vignette, "moved" flash, attract mode | **you write it** | yes (short) |
| M5 | `06-M5-robustness-performance.md` | Adaptive quality, tab/device loss, fatal-error screen, `npm run demo`, perf + endurance | **you write it** | yes (numbers) |
| M6 | `07-M6-deliverables.md` | README, TECHNICAL.md, DEMO_SCRIPT.md, DEMO_DAY.md, final QA | **you write it** | yes |

**MVP cut line:** after **M3** the game is complete and demoable hands-free (title → calibration → tutorial → 2 levels → win/lose with clap menus). M4–M5 make it impressive and safe; M6 is required for submission. If time runs short: M0–M3 → M6 (docs) → M5 §5 (demo launcher) → the rest.
