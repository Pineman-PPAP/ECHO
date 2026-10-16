# Firefly jar visual update

## Scope

Visual assets and viewmodel rendering only. The hand and jar now use a locally bundled, transparent 1254 × 1254 cutout generated with the built-in imagegen tool. The hand has natural skin/fingernail detail and a canvas sleeve; the jar has worn glass, a tarnished screw lid and neck twine.

This is a **2.5D camera-attached viewmodel**, not a rigged 3D hand. It retains the existing sway and turn lag. Fireflies are still live particles, not painted into the image. Their existing trajectories are projected into the cutout's glass interior only when artwork is available. Original procedural geometry is retained for loading/failure fallback.

## Files

- `../src/assets/firefly-jar-hand.png`: original generated RGBA asset, unchanged alpha, about 1.2 MB.
- `../src/render/jarArtwork.ts`: local texture loading, measured registration, glow-responsive exposure and render-only particle projection.
- `../src/render/FireflyJarView.ts`: integrates the cutout and switches to the original geometry if it is unavailable.
- `../src/config.ts`: three new visual settings, `JAR_ART_WIDTH_M`, `JAR_ART_DARK_EXPOSURE`, `JAR_ART_LIT_EXPOSURE`.
- `firefly-jar-preview.html`: developer-only live comparison, glow/pitch sliders and gameplay framing.
- `firefly-jar-before.png`, `firefly-jar-after.png`: isolated Chrome captures.
- `firefly-jar-gameplay.png`: actual application in development simulation mode, during the jar introduction.

## Review

Run `npm run dev` in `echo/`, then open:

http://127.0.0.1:5173/artwork/firefly-jar-preview.html

The preview holds the jar on screen for inspection. Use **Show original geometry** to compare against the old viewmodel; **Show gameplay framing** uses the real camera FOV. Preview controls are development tooling and are never included in the gameplay UI.

For the actual integration, open `/?sim=1`, click Begin, start the tutorial and hold H. The jar raises once and stays held on screen. Real camera/mic play works through the same existing hum input.

## Preserved behavior

No edits to input processing, calibration, `PlayerIntent`, `World`, `FireflyJar`, levels, AI, cave shaders or the application state machine. The hum mapping, world light reach/strength, noise risk, fading, 4.5-second intro, movement and firefly simulation are unchanged. The render buffer alone is flattened into the photographed glass so particle emission cannot appear over fingers or outside the jar.

## Verification (2026-10-16)

- `npm run check`: TypeScript and all 145 tests across 20 files pass.
- `npm run build`: passes; the new PNG is bundled locally.
- Headless Chrome with SwiftShader: preview and actual gameplay rendered without console errors. New/old, asleep/awake and gameplay framing inspected.
- Compared new-artwork and original-geometry viewmodels across 300 identical update frames: maximum blink difference = 0; maximum world-light-position difference = 0. Artwork loaded and procedural fallback was hidden.
- Actual game: state remained playing; jar intro presence changed from 1 to 0; hum continued lighting the cave after the viewmodel lowered; glow decreased after releasing H.
- These are software-rendered visual checks, not a real webcam/microphone session or an integrated-GPU performance measurement.

## Hum-only light follow-up

The jar remains held on screen even in silence. Removed decorative startup light and all idle firefly/core/wing/trail/halo emission. On detected hum release, `FireflyJar` smoothly fades its glow with a 0.55-second exponential time constant (about 1.5 seconds to darkness from full brightness). Wake-up remains eased over a 0.35-second time constant. Below the visible-light threshold the glow finishes at exactly zero, preventing an idle afterglow. The cutout retains a very faint non-emissive exposure so the held jar can still be distinguished; it casts no cave light. World-light origin remains the jar position. Updated the regression test for initial darkness, gradual brightening, gradual dimming and eventual zero light. These changes supersede earlier notes about startup glow and fading.

## Density follow-up

Visibility follow-up: the initial 0.8-second raise now ends in a permanent held pose, rather than lowering again. The 4.5-second decorative intro glow still finishes normally; hum-controlled light, sway and turn lag remain unchanged. The earlier one-time visibility check above documents the original patch, before this requested change.

Distribution fix: fireflies now start at evenly spaced heights and wander around independent height bands. Removed the downward drift that accumulated them at the base. They fill the glass immediately during the brief introduction and remain distributed when dim. Flight changes are render-only; flash phases, noise and cave-light behavior are preserved. The updated browser screenshot is `firefly-jar-after.png`.

Density follow-up: increased the visible swarm from 14 to 36 fireflies. Their shader now uses elongated warm cores, individual green/gold tint variation, faint fluttering wing glints and softer halos. Existing fading trails remain. New shader attributes are static; there is still one particle draw call. The original first 14 seeded flies alone drive `blink`, preserving the cave's light flicker despite the increased visual density. `FIREFLY_VISUAL_EXPOSURE` limits accumulated bloom. No new bitmap generation was needed for this follow-up.

## Generation prompt (verbatim)

Built-in imagegen tool, transparent_background=true. The generated asset was copied into the project without resizing, repainting or removing its alpha.

Use case: stylized-concept. Asset type: production first-person horror game viewmodel cutout, transparent PNG, square 1024x1024.
Create a highly realistic adult LEFT HAND holding a small empty glass firefly jar from underneath, viewed by its owner looking forward and slightly down. Jar upright, cylindrical rounded mason glass body, antique tarnished pewter screw lid, fine cord tied around neck, subtle scratches and thick glass base. Hand anatomically excellent: natural palm cradles jar base, fingers curl around lower right side, thumb supports left side; five fingers total, credible joints and fingernails, natural rough skin and restrained dirt, charcoal canvas sleeve on forearm entering from bottom-left. Photorealistic cinematic game asset, detailed tactile materials, no chunky cartoon forms.
CRITICAL REGISTRATION: on square image, jar silhouette body extends x=390..730 y=180..620, lid y=145..205; jar CENTER at pixel (560,400); hand primarily below y=560; forearm runs diagonally to bottom-left edge. Entire jar and fingertips fully within canvas. Jar seen nearly straight on with small view down onto lid. Transparent background surrounding subject; GLASS INTERIOR ALSO nearly transparent alpha so live animated fireflies can be composited behind glass. Empty jar: NO fireflies, no particles, no solid fill in glass, no broad bloom baked into image. Slim pale glass reflections at sides and base, very subtle pale yellow-green illumination reflected on fingers and glass from inside jar, soft neutral fill just sufficient to see skin detail. Dark muted warm skin, silver-grey lid, not saturated green. No backdrop, no floor, no scene, no labels, no typography, no watermark, no extra hand. Genuine transparency, no checkerboard painted into image.

