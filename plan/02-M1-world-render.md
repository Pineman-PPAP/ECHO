# M1: World and rendering in sim mode

**Goal:** the game is playable with the **development keyboard** (`?sim=1`). You see the dark maze, clap (Space) to send a sonar pulse, hum (H) to light the beam, and walk with collisions to the exit. No camera or mic yet. Monsters exist in the World but are invisible and silent until M2.

The files for this milestone are in `plan/stages/M1/`. They were run in a browser on the target laptop at 60 fps and every behaviour in the table below was checked. **Copy them; don't retype or redesign them.** Then read each one so you understand it; later milestones build on them.

## 1. Copy the stage

From `controller-free-game/`:

```bash
cp -r plan/stages/M1/. echo/
```

This adds or overwrites these files in `echo/`:

| File | What it is |
|---|---|
| `src/app/flags.ts` | Parses `?sim=1&debug=1&level=N&skipcal=1` once (see START-HERE §9) |
| `src/input/SimInput.ts` | **DEV ONLY** keyboard → `PlayerIntent`. Arrows/WASD move, Space clap, Shift+Space soft click, H hum, `[` `]` pitch, B eyes closed, F face lost |
| `src/render/Renderer.ts` | three.js renderer + first-person camera. Copies `World` state into the reveal shader's uniforms each frame |
| `src/app/App.ts` | **M1 version** of the app: sim only, one level, dev keys R (restart) and N (next level). M2 replaces it |
| `src/main.ts` | Entry point: `new App(root, readFlags()).start()` |
| `src/styles.css` | Base styles + the gold dev badge |
| `tests/flags.test.ts` | Unit test for `readFlags` |

## 2. Things to understand (read the files with these in mind)

- **`Renderer.syncSize()` runs every frame on purpose.** During testing the page loaded in a hidden pane with a 0×0 window; a resize-listener approach rendered nothing forever. It also skips rendering while the container is 0×0. Don't "optimise" this away.
- `renderer.setPixelRatio(1)` and `antialias: false`: the shader anti-aliases its own grid lines with `fwidth`, and the integrated GPU needs the headroom for MediaPipe.
- The camera is `rotation.order = 'YXZ'` with `rotation.y = player.yaw`. **Positive yaw rate = turn left.** Head bob comes from `player.bobPhase`.
- The beam uniforms come from `world.beam` (set by `World.update` from `intent.beam`). Origin = the camera position; direction = `yawForward(yaw)`.
- `App` uses `performance.now()` for `nowMs` and a separate `clockS` game clock for the shader (START-HERE §8).
- `World` is created with `seed = levelIndex + 1` so monster wandering is reproducible.

## 3. Verify

1. In `echo/`: `npm run check` → **69 tests pass** (68 reference + `flags.test.ts`). Then `npm run build` passes.
2. `npm run dev`, then open `http://127.0.0.1:5173/?sim=1&level=1`. Click the page once so it has keyboard focus.

| Action | Expected |
|---|---|
| Page loads | Fully black screen; a gold "DEV SIM INPUT" badge at the bottom-left showing ~60 fps |
| Space | A glowing cyan wireframe corridor appears from your position outward, with a bright band at the wavefront, then fades over ~2.6 s. The badge shows `pulse r=17.7 m` |
| Shift+Space | A smaller, dimmer pulse (`r=8.8 m`) |
| Hold H | A circular spotlight cone lights the wall ahead. `]` repeatedly → narrower cone; `[` → wider |
| Hold ↑ for 3 s | Badge position x grows by ~7 m (2.4 m/s) with gentle head bob; you stop at walls, never clip into them |
| ← / → | Camera turns left / right |
| Walk diagonally into a wall | You slide along it |
| N until "Awakening" (or load `?sim=1&level=0`), follow the corridor to the gold ring | Badge shows `escaped · ESCAPED (press R / N)` |
| Resize the window | The image stays undistorted and fills the window |

3. Console: no errors.

With browser tools you can do the table yourself: dispatch `new KeyboardEvent('keydown', { code: 'ArrowUp' })` on `window`, then the matching `keyup`, and take screenshots. If nothing animates, the browser pane is hidden (`requestAnimationFrame` pauses); ask the user to show it. Without browser tools, ask the user to run the table and report.

## Acceptance

- [ ] Every row of the table behaves as described.
- [ ] `npm run check` (69 tests) and `npm run build` pass.
- [ ] Tick M1 in `plan/PROGRESS.md`.
