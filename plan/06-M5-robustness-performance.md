# M5: Robustness, performance and the demo launcher

**Goal:** nothing on stage can crash or stall the demo. The game:
- adapts if the GPU struggles
- survives tab switches and unplugged devices
- launches full-screen with one command, from a production build

## 1. Adaptive render scale

- `Renderer`: add a public mutable `scale = CONFIG.RENDER_SCALE` and use `this.scale` instead of `CONFIG.RENDER_SCALE` in `syncSize()`.
- `App`: while `playing`, track how long `renderer.fps < 40` has lasted continuously (field `lowFpsSinceMs: number | null`). After **3000 ms** below 40: `renderer.scale = Math.max(0.6, renderer.scale - 0.15)`, log `render scale → 0.85` in the debug panel, and reset the timer. Never raise it automatically (it would oscillate).
- The DebugPanel game section shows the current scale: add `scale` to the `game` snapshot and print it after `render NN fps`.

## 2. Tab hidden / audio suspended

- In `App`, keep `private audio: AudioContext | null` (set in `begin()`).
- `document.addEventListener('visibilitychange', …)`:
  - When `document.hidden` and the state is `playing`: `setState({ kind: 'paused', faceBackSinceMs: null })`. The frame loop stops while hidden, so this must happen in the event handler.
  - When visible again: `void this.audio?.resume()`. The existing paused logic resumes play once the face is seen.

## 3. Device loss

After `Sensors.open()` succeeds, add `ended` listeners to `sensors.stream.getVideoTracks()[0]` and `getAudioTracks()[0]`. On `ended`: `setState({ kind: 'error', title: 'Camera disconnected' | 'Microphone disconnected', body: 'Reconnect it, then reload the page.' })`.

## 4. Startup failures that happen before the App exists

In `main.ts`, wrap `new App(...)` in `try/catch`. On error (most likely WebGL unavailable):
- `root.innerHTML = '<div class="fatal">…</div>'` with the message: *"ECHO couldn't start graphics (WebGL). Use Chromium with hardware acceleration enabled (chrome://settings → System)."*, plus the error text.
- `console.error` the error.

CSS: `.fatal { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; text-align: center; color: var(--red); font-size: 18px; }`

Test it by temporarily throwing in the `Renderer` constructor, then remove the throw.

## 5. Production build + one-command demo launcher

Create `echo/scripts/demo.sh` (and `chmod +x` it):

```bash
#!/usr/bin/env bash
# Builds ECHO and opens it full-screen in Chromium for the demo.
# First run: Chromium asks for camera + microphone; the permission is remembered for 127.0.0.1:4173.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f public/models/face_landmarker.task ] || npm run assets
npm run build
npm run preview &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -sf http://127.0.0.1:4173/ >/dev/null && break; sleep 0.1; done
chromium --new-window --start-fullscreen "http://127.0.0.1:4173/${1:-}"
wait $SERVER
```

Add `"demo": "bash scripts/demo.sh"` to `package.json` scripts. Usage: `npm run demo`, or `npm run demo -- '?debug=1'` to start with the pipeline panel open.

Check that `dist/` contains `mediapipe/wasm/*` and `models/face_landmarker.task`. Vite copies `public/` into `dist/`. The production build must work with the network disabled; ask the user to test with Wi-Fi off.

## 6. Performance pass (HUMAN CHECK)

Ask the user to run `npm run demo -- '?debug=1'` and play "The Listener" for 2 minutes, then report these numbers from the debug panel:

| Metric | Target | Where |
|---|---|---|
| Render fps while playing | ≥ 55 | ④ `render NN fps` |
| Render scale | stays 1.0 | ④ (new) |
| Face fps | ≥ 25 | ① |
| Face inference | ≤ 25 ms | ① |
| Chromium RAM | ≤ 1.5 GB | `htop` / system monitor |

Record them in `PROGRESS.md`; the technical document (M6) quotes them. If render fps < 55 with scale 1.0: first try `FACE_DELEGATE: 'CPU'` (frees the GPU for rendering; compare face inference), then `RENDER_SCALE: 0.85`.

## 7. Endurance check (sim)

Run `?sim=1&level=1` for 10 minutes with a console loop that claps every 2 s and hums every 10 s, for example a `setInterval` dispatching the `Space` / `KeyH` key events. In Chromium, `performance.memory.usedJSHeapSize` sampled at minute 1 and minute 10 must not have grown more than ~30 %. Pulses, afterimages and sound nodes are all bounded or pooled. If memory grows, find the leak; don't paper over it.

## 8. Optional: bloom (only if §6 shows headroom)

Only if render fps stays ≥ 58 with face tracking running. Add `ENABLE_BLOOM: false` to `CONFIG`. In `Renderer`, when it's enabled:
- Create an `EffectComposer` from `three/addons/postprocessing/EffectComposer.js` with `RenderPass`, `UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.8, 0.35, 0.12)` and `OutputPass` (same addons folder).
- Call `composer.setSize(w, h)` inside `syncSize()`.
- Render with `composer.render()` instead of `gl.render(...)`.

Keep it only if fps stays ≥ 55 afterwards; otherwise leave `ENABLE_BLOOM: false`. The reveal shader's `#include <colorspace_fragment>` is already correct for both paths.

## Acceptance

- [ ] §1–§5 implemented; `npm run check` and `npm run build` pass.
- [ ] `npm run demo` opens the full-screen production build; works with Wi-Fi off (user confirmed).
- [ ] Performance numbers recorded (user confirmed) and on target, or the documented fallback applied.
- [ ] Endurance check passes.
- [ ] Tick M5 in `plan/PROGRESS.md`.
