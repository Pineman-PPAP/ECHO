# Scratched red wall arrows

Gold floor chevrons have been replaced by persistent, matte red painted arrows projected onto actual cave triangles. No hovering planes or glowing borders. The shader builds uneven brush strokes, chipped coverage and fine scratches; normal rock remains visible through the worn paint. Different markings have deterministic variation.

## Placement and direction

`game/guide.ts:wallGuideMarks()` bakes positions once per level, including side passages. Every second eligible cell receives a mark on a wall parallel to its next shortest-path step toward the exit. Arrows stay on the same walls when the player moves or backtracks. Wall position and left/right direction are tested against each level's actual grid and pathfinder. Open junctions with no suitable side wall are skipped.

`render/GuideTrail.ts` raycasts to the rock, clips a decal onto nearby surface triangles using Three.js's bundled DecalGeometry, and merges the paint into one mesh/draw call. Old paint geometry is disposed on level changes. No dependencies, external artwork, or extra lights were added.

## Visibility

- Darkness: faint, nearby baseline visibility; markings remain physically present at all times and are occluded by rock.
- Clap: sonar temporarily increases red contrast and paint opacity, then returns to normal as the pulse fades.
- Hum: ordinary muted paint is revealed only nearby (fades out by 3.2 m). Jar light does not trigger the sonar contrast/saturation boost.

Settings are `GUIDE_WALL_*` in `src/config.ts`. The exit pad retains its existing presentation. Tutorial and HUD instructions now refer to red wall arrows.

## Review evidence

- `wall-arrow-dark.png`: faint baseline, no hum or pulse.
- `wall-arrow-hum.png`: nearby matte red paint under normal jar illumination.
- `wall-arrow-clap.png`: increased contrast during sonar.

These are actual in-game headless Chrome captures using development simulation input and SwiftShader. No console/shader errors. All 148 tests and the production build pass. Hardware performance and real camera/microphone gameplay were not measured during this pass.
