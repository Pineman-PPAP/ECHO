# Subtle cave atmosphere

## Near-camera night-footage layer

The follow-up adds `src/render/NearDust.ts`: a continuously drifting volume of 1,100 near-lens particles. The volume follows the player while its contents retain world-space motion, giving parallax when walking and turning. Individual flecks vary in size and orientation; the nearest become soft out-of-focus discs rather than pinpoints. Air moves sideways and gently downward with independent turbulence. It uses one additional shader-driven draw call, with no per-frame allocations, external textures or new scene lights.

The jar and sonar illuminate this layer through the same reveal uniforms as the cave. It does not glow on its own, does not reveal cave geometry, and is drawn behind the held jar with rock depth testing. Volume edges and the camera near plane fade out rather than visibly wrapping. Settings are the `LENS_DUST_*` values in `CONFIG`.

Browser verification of the isolated layer: 1,465 nonblack pixels with jar light; a different frame 0.5 seconds later had 1,825 (motion confirmed). With jar/sonar light zero, the layer produced exactly zero nonblack pixels. No shader or console errors. `night-dust-preview.png` shows the effect in actual gameplay under jar-only light. Screenshots were software-rendered; hardware performance has not been measured.

## Distant dust and cave life

The cave now has a more visible layer of airborne dust and sparse, non-luminous moth-like insects. All details are world-space and depth-tested against the rock. They only appear in existing sonar/jar light, fade close to the camera and at distance, and disappear with the light. No ambient visibility or fog overlay is added.

- Dust: 36 motes per open grid cell, slow independent drift, varied size and soft edges. Opacity is restrained so the cave does not look snowy or smoky.
- Insects: one per 12 open cells, muted brown-grey silhouettes, irregular flight and flapping wings. They do not glow or emit game sounds.
- Existing clap-triggered bat bursts are smaller: six bats per flock, wing size reduced from 0.38 to 0.25 m. Roost activation and sound/hearing mechanics are unchanged.
- Animation runs in shaders. Dust keeps its existing draw call; insects add one Points draw call. Geometry/material disposal follows the existing level lifecycle. No new dependencies or generated raster assets.

Implementation: `src/render/CaveLife.ts`, `src/render/revealMaterial.ts`; all effect tuning lives under Cave life in `src/config.ts`.

Verified with TypeScript, 145 unit tests and the production build. Inspected actual gameplay under jar-only lighting and sonar in headless Chrome with SwiftShader, with no browser console/shader errors. `cave-air-preview.png` is a jar-only gameplay capture. Hardware GPU performance and real sensor play were not measured in this pass.
