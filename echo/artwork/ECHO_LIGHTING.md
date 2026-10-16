# Damp-rock echo lighting

Claps now send a restrained, cold-grey reveal across the cave instead of a clean white scanning flash. The 22 m/s wave speed, loudness/range mapping, monster hearing, reveal timing and procedural sound are unchanged. Jar color, brightness, wake/fade and normal shading are preserved.

- 35 ms eased attack and a wider (0.9 m nominal), softly feathered wave band. Fixed world-space variation breaks its width and intensity across the rock without flickering.
- Echo-only slate/bone grading, with weaker light in grain depressions and baked crevices. Wet glints are limited to raised damp patches; no broad white sheen over the pulse-lit wall.
- The initial reveal decays faster, with a low afterglow that diminishes slightly differently across the rock. No strobing, camera flash overlay or glowing fissures.
- Exponential soft saturation limits overlapping pulse illumination instead of summing eight pulses into a white room.
- Near-camera dust and other airborne details briefly catch the arriving band. They still vanish in unlit areas.
- Red wall arrows retain their clap-only contrast boost and normal close-range hum appearance.

Implementation: `render/revealMaterial.ts`, `render/NearDust.ts`; settings `CAVE_AFTERGLOW`, `CAVE_FLASH_DECAY_PER_S`, `CAVE_ECHO_COLOR`, `CAVE_PULSE_*`, and `CAVE_RING_WIDTH_M` in `config.ts`. No new textures, lights, render passes, dependencies or sound changes.

## Validation

148 tests and production build pass. Actual application shaders compiled/rendered in isolated Chrome with SwiftShader, without console errors. Captured a normal clap at 0.15, 0.35, 0.8, 1.5 and 2.6 seconds; mean raw framebuffer brightness was approximately 37, 39, 26, 13 and 4 on a 0–255 scale. No white-clipped pixels in these captures. Eight simultaneous pulses were also inspected as a worst-case stacking check.

Review images: `echo-reveal.png` (0.35 s), `echo-afterglow.png` (0.8 s), `echo-stacked.png` (eight pulses). These are software-rendered development-simulation captures, not a real camera/mic playthrough or an integrated-GPU performance benchmark. The effect is stylized echolocation, not physical ray-traced light/shadow propagation.
