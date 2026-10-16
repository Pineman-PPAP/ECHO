# ECHO

**A horror escape game played in total darkness, controlled only by your voice and your head.**
No keyboard, no mouse, no controller: a webcam and a microphone are the whole input.

- **Sound is sight.** A clap, click or knock sends out a sonar wave that briefly reveals the cave. Louder = further.
- **Every clap is a bet.** The Hollows are blind and hunt by sound: every creature in earshot runs to where you clapped. See the cave, then move.
- **Humming wakes the fireflies.** You carry a visible jar of fireflies in your left hand throughout play. A steady hum wakes them: they swirl and glow, lighting the rock all around you (louder = brighter and further). Only a Hollow right next to you hears a hum. Stop humming, and their glow gently diminishes to darkness over about 1.5 seconds; the jar remains held on screen.

## Status: finished ✅

ECHO is complete and playable start to finish, hands-free:

- **Input:** face tracking (head turn + lean to walk) and audio (claps, clicks, hums), with a guided calibration for each new player.
- **Game:** a tutorial and three levels (Awakening, The Listener, The Choir), blind Hollows that hunt by sound, the Hush, breakable pots and the Stalker.
- **Look and sound:** sonar-lit rock caves, creature artwork, jumpscares and 3D positional audio.
- **Quality:** typecheck + unit tests (`npm run check`) and the production build pass.

Quick start: `cd echo && npm install && npm run assets && npm run dev`, then open http://127.0.0.1:5173 in Chrome with headphones on.

---

## Controls

| You do | The game sees | Effect |
|---|---|---|
| Clap / tongue click / knock | Mic: sharp rise followed by a short percussive decay | Sonar pulse; loudness sets its radius and how far creatures hear it (4–34 m). Hollows in earshot run to that spot |
| Hum a steady note | Mic: pitch (YIN) + steadiness + level | Fireflies in the jar wake and light the cave around you; loudness → brightness and reach (3.5–9 m), pitch → how excitedly they swirl. Heard only within ~5 m |
| Turn your head | Head yaw | Turn left / right |
| Lean toward / away from the screen | Face distance vs. calibrated rest | Walk forward / back. A gentle lean is silent; a full lean makes footsteps heard up to 10 m |
| Leave the camera | No face for 0.4 s | Game pauses |

Menus are hands-free too: **clap = confirm**. The only mouse click is "Begin" (browsers require a click before granting camera, mic and audio).

---

## Run it

Requirements: Chrome or Chromium, a webcam, a microphone, **headphones (required: on speakers the game hears its own sounds)**, and a lit face. Built and tested on an Intel i7-13620H laptop with integrated graphics (Linux).

```bash
cd echo
npm install
npm run assets   # one-time: downloads the MediaPipe runtime + face model into public/ (then it runs offline)
npm run demo     # production build, opens full-screen Chrome/Chromium on http://127.0.0.1:4173
```

| Script (in `echo/`) | What it does |
|---|---|
| `npm run dev` | Dev server on `http://127.0.0.1:5173` |
| `npm run demo` | Build + preview server + full-screen browser with its own profile. `npm run demo -- '?debug=1'` adds the pipeline panel. Close the window to stop |
| `npm run assets` | Fetches the MediaPipe wasm and `face_landmarker.task` (no network needed at runtime) |
| `npm run check` | TypeScript check + 170 unit tests (vitest) |
| `npm run build` | Typecheck + production build into `dist/` |

**URL flags:** `?debug=1` pipeline/debug panel (toggle with the backtick key) · `?level=N` start at level N (0 = tutorial) · `?skipcal=1` skip calibration · `?manual=0` skip the Field Manual · `?sim=1` keyboard input, **development only**.

**New player:** reload the page (F5) and click Begin; that reruns calibration. Venue setup (power mode, mic gain, symptom → setting table): [`DEMO_TUNING.md`](DEMO_TUNING.md).

---

## How it works

### Pipeline (one animation frame)

```
webcam 640x480@30 ─▶ MediaPipe FaceLandmarker (GPU) ─▶ head yaw, face depth, presence  ─┐
                                                                                             ├─▶ IntentBuilder ─▶ PlayerIntent ─▶ World.update() ─▶ Renderer (three.js)
mic (no AGC / noise suppression) ─▶ MicAnalyzer: 128-sample hops ─▶ noise floor, onsets,   ─┘    + calibration                    (pure game logic)   Sfx (Web Audio, HRTF 3D)
                                     YIN pitch, hum detector                                                                                         HUD + debug panel
```

The game logic never touches a sensor: it only receives a `PlayerIntent` (turn rate, move speed, pulses, hum, face present). The same intent can come from the keyboard (`?sim=1`) for development, which is how the game logic is unit-tested.

### Input processing (`echo/src/input/`)

- **Face** (`face/`): MediaPipe Tasks Vision 0.10.35, GPU delegate with CPU fallback. The face transformation matrix gives head yaw and depth; both are smoothed with One-Euro filters. Yaw drives a turn *rate* (dead zone, then a curve), so you can keep looking at the screen while turning. Lean = rest depth / current depth − 1.
- **Mic** (`audio/`): processed in 128-sample hops. A percentile noise floor tracks the room. A sharp rise starts a clap candidate, which must decay at least 8 dB for 5 ms within 75 ms and have a percussive peak before it emits an **onset**. This rejects sustained room-noise increases and abrupt hums; measured claps usually confirm in a few tens of milliseconds. The player's calibrated clap also filters out much fainter transients. Actual nearby claps can still resemble player claps to a single microphone. A **hum** is a voiced YIN pitch that stays steady (small pitch spread) above the floor.
- **Calibration** (`calibration.ts`, ~45 s, hands-free): face check, quiet room (noise floor), neutral pose, look left (measures the yaw sign), a normal clap and a normal hum (loudness references), and a speaker-leak test. Each step first says what to do and why it matters in the cave, with a countdown (nothing is measured yet), then measures with a live reading ("Turned 14°", "Claps heard: 1 of 2", "Hearing your hum: 131 Hz"), then shows what it measured. The last screen lists every control. It is paced so a first-time player, and anyone watching, can follow it.
- **Field Manual** (once after calibration): a short interactive intro, four brief scenes: hum to wake the fireflies, stop to watch them fade, turn left/right, lean forward/back, then clap to reveal a blind Hollow following the sound. Real input and the existing cave renderer; the safe Hollow cannot catch you. Double clap to skip at any point. Hints repeat instead of falsely completing lessons. A brief “Find the way out” caption transitions straight into play, with no second intro card. The tutorial cave remains for exploration; its repeated control prompts are shortened after a completed intro. Speaker-leak calibration makes the intro silent so the mic can listen.
- **Mapping** (`mapping.ts`): clap loudness → pulse radius 5–24 m; hum level → the firefly jar's glow (`game/FireflyJar.ts`: eases up in ~0.35 s, fades naturally after humming stops; reach 3.5–9 m all around); hum pitch (log scale, 110–300 Hz) → how excited the fireflies are (visual only).

### Game rules (`echo/src/game/`, pure TypeScript, unit-tested)

- **Grid world** (`grid.ts`): levels are ASCII maps; collision, line of sight and BFS paths are on the grid.
- **Hearing** (`hearing.ts`): every sound has a hearing radius from its loudness (4–34 m, always further than a pulse reveals); walls multiply the distance.
- **Hollows** (`Monster.ts`, `sight.ts`): **blind**; idle wander → alert (hunting) → search. A Hollow becomes alert only when it **hears** you (a red flash and dry clicks from where it stands tell you it did), and runs to the exact spot the sound came from on a "rubber band": 3.6 m/s from far away (faster than you walk) easing to 1.9 m/s within 4 m (slower than you). Clap and stay put and you are caught; clap, look, and slip away with a gentle lean and it searches an empty spot. Walking at full speed keeps telling it where you are, so a chase lasts until you break the sound with a corner and go quiet. Their red eyes glow whenever one faces you: it can't see you, but you can see it.
- **The Hush** (`Hush.ts`, last level): hunts *silence*. After 12 s without a sound it appears behind you and drifts closer through the rock; every sound pushes it back, and those sounds bring the Hollows.
- **Navigation costs noise** (`guide.ts`): persistent scratched red arrows painted onto the rock walls, with faint baseline visibility; claps briefly boost their contrast, while a nearby hum reveals their normal matte paint, plus a cold draft sound from that direction. (A sound-only guide failed in testing: earbuds can't tell front from back.)
- **Authored moments** (`moments.ts`, data in `levels.ts`): Awakening (tutorial) shows a pair of eyes by the exit; The Listener has a long tunnel where the cave falls silent and a Hollow waits at the end, two cells past the turn you must sneak to; The Choir has a Hollow walking past while you hold still, then a finale where everything hunts you.
- **Pots** (`pots.ts`, placed in `levels.ts`): clay pots stand against one wall of some corridors. Walk into one and it shatters: a crash as loud as a clap (louder the faster you walk) plus a small flash of sonar light from the pot. Light the floor and steer around them. World emits a `potKicked` event for each one. In the tutorial nothing hears it; everywhere else it summons the Stalker.
- **The Stalker** (`Stalker.ts`): an invisible thing a broken pot calls. You never see it walk, you only hear it: an intense, rising dread and heavy footsteps coming straight at you through the rock from 16 m behind. The Hollows and the Hush freeze while it comes. At 4 m the HUD says **STAND STILL**; 2.5 s later its face is right in yours for 3.5 s. Walk, turn your head, clap or hum then and it takes you; stay perfectly still and silent and it turns away and the game goes on. The tutorial has one to learn on; in The Listener one stands in the last cell of the silent tunnel, three cells from where the Hollow waits.
- **The cave's lies** (`ambience.ts`): fake scrapes, and sometimes your clap echoes back late from behind you.

### Rendering (`echo/src/render/`)

- **Cave** (`caveMesh.ts`): a signed-distance field over the grid (rounded corners, rock noise, arched ceiling, stalactites) meshed with surface nets. Rock only ever bulges *into* corridors, never behind the collision line or into the camera (tested), so the grid collision stays honest.
- **Reveal shader** (`revealMaterial.ts`): the scene is black; up to 8 pulse wavefronts and the firefly jar (a soft green-yellow light all around the hand that holds it) add light. A clap sends an uneven cold-grey echo over damp rock: a soft wavefront, dark crevices, restrained wet glints and a fading afterglow. Pulse brightness saturates gently so repeated claps cannot wash the cave white; distant rock stays dim. The rock is procedural: ridged-noise grain with bump mapping (no UVs needed), partly faceted shading, soft rock layers, and wet glints that face you; a soft broken band marks the wavefront.
- **Hollows are never drawn live**, only their red eyes (`EyeGlow.ts`) and afterimages where a pulse or the jar's light touched them (`Afterimages.ts`). The creature uses generated transparent artwork (`hollowArtwork.ts`): a hunched, clawed predator in four poses (standing, stalking, crouched, reaching), plus a matching close-up for the catch. The frozen images sit on depth-tested planes at the actual creature location, with a ~2.45 m standing height; `game/poses.ts` chooses each glimpse. The shader preserves the skin detail, adds subtle red edges, and breaks the image into specks as it fades. Eye positions match the art. Two shared local textures load during the title/calibration screens and are bundled for offline play; procedural geometry remains a fallback and renders the Hush. Subtle drifting dust, sparse non-glowing insects, drips, small bat flocks on loud claps, and remains (`CaveLife.ts`) are also lit only by sound. [Artwork, prompts and shader preview](echo/artwork/README.md).
- **The catch:** the creature leaps from 3 m to your face in 0.2 s, a white frame, a flicker, then a hard cut to black and silence before the game-over card.
- Performance: render scale 0.75 with adaptive lowering below 40 fps. Measured on the laptop's integrated GPU: face tracking 30 fps (15–27 ms); render 66–90 fps (first look, M3). The current cave renders in 6.4–6.6 ms per frame at 1440×744 (on battery, power-saving mode), well inside a 20 ms frame.

### Audio (`echo/src/audio/Sfx.ts`)

All sound is synthesized (no audio files) with Web Audio; creatures, the draft, drips, bats and fake sounds use HRTF 3D panning. Silence is used as a warning: the drone fades as a Hollow comes close, and an unseen Hollow nearby breathes in one ear only.

### Layout

```
echo/src/app/      App: frame loop + state machine (title, calibration, Field Manual, intro, play, pause, menus), URL flags
echo/src/input/    sensors, signal processing, calibration, intent mapping, dev keyboard input
echo/src/game/     pure game logic: world, player, monsters, Hush, hearing, levels, moments, cave life
echo/src/render/   three.js: cave mesh, reveal shader, eyes, afterimages, arrows, bats/dust/drips/remains
echo/src/audio/    procedural 3D sound
echo/src/ui/       cards, HUD, overlays (vignette, flash, frost), debug/pipeline panel
echo/tests/        unit tests
```

---

## Demo script (about 2 minutes)

1. **Setup (before the judge sits down):** charger in, `npm run demo -- '?debug=1'`, headphones on the player, face lit from the front. Click **Begin** (the only click).
2. **Calibration (~45 s):** each step says what to do and why, counts down, shows a live reading, then what it measured; the last screen lists the controls. Point out the debug panel: camera → face, mic → sound, intent, game.
3. **Tutorial, "Awakening":** "Clap." The cave appears for a moment and bats burst overhead. A soft click shows a small area, a loud clap a big one. Turn the head to look, lean in to walk, hum to wake the fireflies in the jar (they light the cave around you). A clap brings out the scratched red arrows on the walls; follow them toward the exit. Near the exit, two red eyes watch, then vanish.
4. **"The Listener":** *"It's blind. It hunts by sound."* The tunnel goes completely silent. At its end, two red eyes: it's waiting by the turn you need. Lean gently and slip past without a sound. Then let the judge clap: a red flash, dry clicks, and you hear it running at the spot where you clapped. Move, and it finds an empty spot; stand still, and it finds you.
5. **Talking points:** every input is analog and physical (loudness = how far you see AND how far they hear, hum = firefly light but heard up close, lean = speed AND noise); no buttons in disguise; runs offline in the browser on an integrated GPU; 170 unit tests on the pure game logic.
6. **If there's time, "The Choir":** "Something is coming. Hold still." A Hollow walks past in the dark. Stay quiet too long and frost creeps in: the Hush hunts silence. Near the exit everything wakes up: run.
