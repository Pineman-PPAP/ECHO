/**
 * Every tunable number in ECHO lives here. Never hard-code these values elsewhere.
 * Units are in the name: _M metres, _S seconds, _MS milliseconds, _DEG degrees,
 * _DB decibels, _HZ hertz. Unitless values are ratios or 0..1 scores.
 */
export const CONFIG = {
  // ---------------- Camera / face ----------------
  VIDEO_WIDTH: 640,
  VIDEO_HEIGHT: 480,
  VIDEO_FPS: 30,
  /** Tried first; FaceTracker falls back to 'CPU' automatically if GPU init throws. */
  FACE_DELEGATE: 'GPU' as 'GPU' | 'CPU',
  /** Face missing this long while PLAYING => simulation pauses ("I can't see you"). */
  FACE_LOST_PAUSE_MS: 400,
  /** Face must be back this long before the simulation resumes. */
  FACE_FOUND_RESUME_MS: 300,
  /** Blink thresholds used when calibration fails or is skipped. Score = mean(eyeBlinkLeft, eyeBlinkRight). */
  BLINK_CLOSE_DEFAULT: 0.5,
  BLINK_OPEN_DEFAULT: 0.3,
  /** Calibrated thresholds: open + FRACTION * (closed - open). Close > open gives hysteresis. */
  BLINK_CLOSE_FRACTION: 0.55,
  BLINK_OPEN_FRACTION: 0.35,
  /** If (closed - open) measured during calibration is below this, calibration is rejected. */
  BLINK_MIN_CALIBRATED_RANGE: 0.2,
  /** One-Euro filter for head yaw (degrees) and lean ratio. */
  HEAD_FILTER_MIN_CUTOFF: 1.0,
  HEAD_FILTER_BETA: 0.05,
  HEAD_FILTER_D_CUTOFF: 1.0,
  YAW_DEADZONE_DEG: 6,
  YAW_FULL_DEG: 24,
  MAX_TURN_RATE_DEG: 110,
  /** Lean = neutralDepth / depth - 1  (positive = closer to the screen = walk forward). */
  LEAN_FWD_DEADZONE: 0.07,
  LEAN_FWD_FULL: 0.25,
  LEAN_BACK_DEADZONE: 0.06,
  LEAN_BACK_FULL: 0.16,
  /** Calibration "look left" must move the head at least this much or the step is retried. */
  CALIB_MIN_YAW_DELTA_DEG: 8,
  /**
   * Calibration pacing (for first-time players and anyone watching): each step first shows what to
   * do and why for CALIB_INTRO_MS (countdown, nothing measured), then measures, then shows what it
   * measured for CALIB_RESULT_MS. The final controls summary stays up for CALIB_DONE_MS; a clap
   * skips it after CALIB_DONE_SKIP_MS.
   */
  CALIB_INTRO_MS: 2600,
  CALIB_RESULT_MS: 1600,
  CALIB_DONE_MS: 9000,
  CALIB_DONE_SKIP_MS: 1500,

  // ---------------- Microphone ----------------
  /** Analysis hop in samples (~2.7 ms at 48 kHz). Matches the Web Audio render quantum. */
  HOP_SIZE: 128,
  MIN_FFT_SIZE: 2048,
  /** Noise floor = FLOOR_PERCENTILE of hop levels over the last FLOOR_WINDOW_S seconds. */
  FLOOR_WINDOW_S: 3,
  FLOOR_PERCENTILE: 0.2,
  FLOOR_INIT_DB: -60,
  FLOOR_MIN_DB: -68,
  FLOOR_MAX_DB: -20,
  /** Onset (clap / click / shout) = hop level >= floor + MIN_ABOVE and >= level LOOKBACK hops ago + RISE. */
  ONSET_MIN_ABOVE_FLOOR_DB: 14,
  ONSET_RISE_DB: 15,
  ONSET_LOOKBACK_HOPS: 4,
  /** Onset is emitted after this many extra hops so its peak loudness is measured (~10 ms). */
  ONSET_PEAK_HOPS: 4,
  /** A clap must decay this much for a few milliseconds; a sustained noise attack is rejected. */
  ONSET_DECAY_DB: 8,
  ONSET_DECAY_HOLD_MS: 5,
  /** Reject candidates that remain loud this long instead of pulsing on every abrupt sound. */
  ONSET_MAX_DURATION_MS: 75,
  /** Percussive sounds have a sharper sample peak than a brief steady voiced note. */
  ONSET_MIN_CREST_DB: 4,
  ONSET_REFRACTORY_MS: 200,
  /** Ignore faint transients more than this many dB below the player's calibrated clap peak. */
  CLAP_REJECT_BELOW_REF_DB: 20,
  /** Peak-above-floor of a "normal clap" when calibration is skipped. Maps to loudness 1.0. */
  CLAP_REF_ABOVE_DB_DEFAULT: 36,
  YIN_WINDOW_S: 0.021,
  YIN_MIN_HZ: 80,
  YIN_MAX_HZ: 1200,
  /**
   * First dip of the YIN difference function below this is the period. 0.15 was too strict for a soft,
   * breathy hum: it fell through to the global minimum, often an octave or two low (a 200 Hz hum read
   * as 100 Hz), and the jumps broke the hum's steadiness. Keep it below YIN_MAX_APERIODICITY.
   */
  YIN_THRESHOLD: 0.35,
  /** YIN result counts as "voiced" only below this aperiodicity (0 = perfect tone). 0.4 lets a soft, breathy hum through. */
  YIN_MAX_APERIODICITY: 0.4,
  /** Minimum time between pitch estimates. */
  PITCH_INTERVAL_MS: 30,
  /** A hum this far above the room's noise floor counts: 6 dB catches a quiet "hmm". */
  HUM_MIN_ABOVE_FLOOR_DB: 6,
  /** Level-above-floor of a "normal hum" when calibration is skipped. Maps to hum level 1.0. */
  HUM_REF_ABOVE_DB_DEFAULT: 30,
  HUM_ATTACK_MS: 100,
  /** A soft hum wavers: it stays on through dropouts this short. */
  HUM_RELEASE_MS: 300,
  /** A hum must hold a steady note: max-min of recent pitches (in octaves) must stay below this. */
  HUM_MAX_PITCH_SPREAD_OCT: 0.15,
  HUM_PITCH_HISTORY: 5,
  /** Noise floor is frozen while humming, but never longer than this. */
  HUM_FLOOR_FREEZE_MAX_MS: 8000,

  // ---------------- Echo visuals ----------------
  /** Visual wavefront speed (real sound is 343 m/s; slowed so the eye can follow it). */
  PULSE_SPEED: 22,
  PULSE_FADE_S: 2.6,
  PULSE_MIN_RADIUS: 5,
  PULSE_MAX_RADIUS: 24,
  /** Must equal MAX_PULSES in the GLSL source (revealMaterial.ts injects it as a define). */
  MAX_PULSES: 8,
  /** Hum pitches mapped to 0..1 (log scale): how excited the fireflies are. M3: a comfortable male hum is ~120-250 Hz. */
  HUM_LOW_PITCH_HZ: 110,
  HUM_HIGH_PITCH_HZ: 300,

  // ---------------- Firefly jar (the hum's light, held in the left hand) ----------------
  /**
   * Humming wakes the fireflies: their glow eases toward the hum's level with time constant JAR_WAKE_S
   * and fades naturally with JAR_SLEEP_S when the hum gets quieter or stops. Silence eventually
   * reaches zero glow; there is no idle light. Any detected hum gives at least JAR_MIN_HUM_GLOW.
   */
  JAR_WAKE_S: 0.2,
  JAR_SLEEP_S: 0.55,
  JAR_MIN_HUM_GLOW: 0.55,
  /**
   * Glow follows hum level ^ JAR_HUM_CURVE: below 1 a quiet hum lights a lot (0.5: a quarter-loud hum
   * gives half the extra glow), so a soft "hmm" is enough to see by.
   */
  JAR_HUM_CURVE: 0.5,
  /** Glow below this lights nothing and reveals nothing. */
  JAR_LIT_MIN: 0.05,
  /** Light reaches this far at the faintest glow and at a full (calibrated) hum. All around you, not a cone. */
  JAR_MIN_RADIUS_M: 3.5,
  JAR_MAX_RADIUS_M: 9,
  /** Brightness of the jar's light on the rock at full glow (before CAVE_EXPOSURE). */
  JAR_LIGHT_STRENGTH: 0.75,
  /** Tint of the jar's light on the rock (pale firefly green-yellow). */
  JAR_LIGHT_COLOR: 0xe4f0a0,
  /** 0..1: how much the light breathes with the fireflies' blinking. */
  JAR_FLICKER: 0.3,
  /** Afterimage refresh while a creature stands in the jar's light. */
  JAR_AFTERIMAGE_INTERVAL_MS: 120,
  /** Where the jar is held, in camera space (metres: +x right, +y up, -z ahead), and its size. */
  JAR_HOLD_X_M: -0.33,
  JAR_HOLD_Y_M: -0.155,
  JAR_HOLD_Z_M: -0.44,
  JAR_RADIUS_M: 0.052,
  JAR_HEIGHT_M: 0.13,
  /** The jar sways with each stride and lags behind head turns. */
  JAR_SWAY_M: 0.006,
  JAR_TURN_LAG: 0.035,
  /**
   * The jar rises into view over JAR_INTRO_MOVE_S when play first starts and stays held on screen.
   * Raising it does not light it: fireflies emit only while humming.
   */
  JAR_INTRO_MOVE_S: 0.8,
  /** First-person artwork only; these never change the jar's world light or hum mapping. */
  JAR_ART_WIDTH_M: 0.31,
  JAR_ART_DARK_EXPOSURE: 0.055,
  JAR_ART_LIT_EXPOSURE: 0.85,
  /** Fireflies in the jar (render only). */
  FIREFLY_COUNT: 36,
  /** Keep the original 14-insect flicker sample so additional flies cannot change cave lighting. */
  FIREFLY_LIGHT_SAMPLE_COUNT: 14,
  FIREFLY_COLOR: 0xc8ff5a,
  FIREFLY_POINT_PX: 24,
  /** Per-insect exposure: a denser jar should keep individual lights instead of a solid bloom. */
  FIREFLY_VISUAL_EXPOSURE: 0.8,
  /** Visual flight only: keep insects distributed through the full height instead of sinking. */
  FIREFLY_HEIGHT_WANDER: 0.06,
  FIREFLY_HEIGHT_RETURN_PER_S: 6,
  FIREFLY_HALO_COLOR: 0x6dff3a,
  /** Points per firefly: the firefly plus a short fading trail of where it just was. */
  FIREFLY_TRAIL: 6,
  /** Flying speed asleep, awake, and the extra share a high hum adds (excited). */
  FIREFLY_SLEEP_SPEED: 0.006,
  FIREFLY_AWAKE_SPEED: 0.05,
  FIREFLY_EXCITED_BOOST: 1.2,
  /** Blink rate asleep and awake (Hz). */
  FIREFLY_SLEEP_BLINK_HZ: 0.35,
  FIREFLY_AWAKE_BLINK_HZ: 1.6,
  /** Fast tiny jitter of their wings ("buzzing"), metres. */
  FIREFLY_BUZZ_M: 0.0014,
  /** Permanent scratched paint. Sonar boosts contrast; close jar light shows normal paint. */
  GUIDE_WALL_SPACING_CELLS: 2,
  GUIDE_WALL_HEIGHT_M: 1.45,
  GUIDE_WALL_SIZE_M: 0.95,
  GUIDE_WALL_COLOR: 0x873027,
  GUIDE_WALL_PULSE_COLOR: 0xcd3325,
  GUIDE_WALL_AMBIENT: 0.035,
  GUIDE_WALL_JAR_NEAR_M: 3.2,
  GUIDE_WALL_PULSE_BOOST: 3,

  // ---------------- Hearing (monsters) ----------------
  HEAR_MIN_RADIUS: 4,
  HEAR_MAX_RADIUS: 34,
  /** Distance multiplier when a wall blocks the straight line between sound and listener. */
  WALL_MUFFLE: 1.6,
  /**
   * A hum is quiet: it makes a sound every HUM_NOISE_INTERVAL_MS of loudness (hum level 0..1) x
   * HUM_NOISE_SCALE, so a Hollow hears it only within ~5 m (a clap carries 4-34 m).
   */
  HUM_NOISE_INTERVAL_MS: 600,
  HUM_NOISE_SCALE: 0.05,
  FOOTSTEP_STRIDE_M: 0.9,
  FOOTSTEP_NOISE_MAX: 0.3,
  FOOTSTEP_MIN_AUDIBLE: 0.04,

  // ---------------- Player ----------------
  PLAYER_RADIUS: 0.35,
  EYE_HEIGHT: 1.6,
  MAX_SPEED_FWD: 2.4,
  MAX_SPEED_BACK: 1.2,
  EXIT_REACH_M: 1.2,

  // ---------------- Monsters ----------------
  /**
   * Speeds (m/s, before the state factor below). Hollows are blind and only hear. One that isn't
   * hunting creeps at MONSTER_SPEED_UNSEEN.
   */
  MONSTER_SPEED_UNSEEN: 1.3,
  /**
   * A HUNTING Hollow (it heard you) runs to the sound: HUNT_SPEED_FAR (faster than you walk) while
   * it is HUNT_FAR_M or more from you, easing to HUNT_SPEED_NEAR (slower than you) at HUNT_NEAR_M or
   * less. A player who keeps walking stays ~6 m ahead; one who stays where it heard them is caught.
   */
  HUNT_SPEED_FAR: 3.6,
  HUNT_SPEED_NEAR: 1.9,
  HUNT_FAR_M: 12,
  HUNT_NEAR_M: 4,
  CATCH_DISTANCE: 1.1,
  SEARCH_DURATION_MS: 6000,
  ALERT_SPEED_FACTOR: 1,
  SEARCH_SPEED_FACTOR: 0.6,
  IDLE_SPEED_FACTOR: 0.35,
  /** Scripted walks (the Choir's walk-past). */
  PATROL_SPEED_FACTOR: 1.3,
  AFTERIMAGE_FADE_S: 2.6,
  /** Scan lines across a revealed Hollow (render). */
  HOLLOW_SCAN_LINES_PER_M: 14,
  /** Generated Hollow artwork is grounded in metres, using a single shared atlas and catch portrait. */
  HOLLOW_HEIGHT_M: 2.45,
  HOLLOW_CROUCH_HEIGHT_M: 1.6,
  HOLLOW_CATCH_SIZE_M: 1.8,
  HOLLOW_EYE_FORWARD_M: 0.02,
  HOLLOW_ART_EXPOSURE: 0.85,
  HOLLOW_ART_EDGE_COLOR: 0x852824,
  HOLLOW_ART_ALPHA_CUTOFF: 0.06,
  MAX_AFTERIMAGES: 24,
  /** Heartbeat / red vignette start when an alerted monster is closer than this. */
  DANGER_RADIUS: 12,

  // ---------------- Poses (what you see when a Hollow is revealed; game/poses.ts) ----------------
  /** Within this distance it is caught reaching for you. */
  POSE_REACH_M: 4,
  /** The pose (and its mirror) is fixed per square of this size, so the beam's repeated reveals don't flicker. */
  POSE_CELL_M: 1.5,

  // ---------------- Red eyes ----------------
  /** A Hollow's eyes glow in the dark (no pulse needed) while it faces the player within this half-angle, with a clear line between them. */
  EYES_FACING_HALF_ANGLE_DEG: 50,
  EYES_MAX_DISTANCE_M: 30,
  /** Eye glow is 1 at this distance or closer, falling to EYES_FAR_GLOW at EYES_MAX_DISTANCE_M. */
  EYES_FULL_DISTANCE_M: 6,
  EYES_FAR_GLOW: 0.3,
  /** Things within this half-angle of the look direction are "in front of" the player (about half the screen width). */
  VIEW_HALF_ANGLE_DEG: 42,
  /** On-screen eye dot diameter in drawing-buffer pixels at EYES_FULL_DISTANCE_M (render). */
  EYES_POINT_PX: 10,
  /** Eye dot size scales with 1/distance, clamped to this range (render). */
  EYES_MIN_SCALE: 0.6,
  EYES_MAX_SCALE: 1.8,
  /** Eyes fade in and out over this long instead of popping (render). */
  EYES_FADE_S: 0.18,

  // ---------------- The Hush (hunts silence) ----------------
  /** The Hush appears after the player has made no sound for this long. */
  HUSH_SILENCE_MS: 12000,
  /** Once present, it drifts closer whenever the player has been silent this long. */
  HUSH_RESUME_MS: 2500,
  /** It appears this far behind the player (it passes through rock). */
  HUSH_SPAWN_DISTANCE_M: 14,
  HUSH_SPAWN_SPREAD_DEG: 40,
  HUSH_SPEED: 0.9,
  /** Every sound pushes it back by HUSH_PUSH_M * loudness (a normal clap = 1.0). */
  HUSH_PUSH_M: 8,
  /** Pushed this far away, it fades out until the next long silence. */
  HUSH_GONE_DISTANCE_M: 18,
  HUSH_CATCH_M: 1.2,

  // ---------------- Authored moments (levels.ts) ----------------
  /** HUD line shown when a moment fires. */
  MOMENT_PROMPT_MS: 5000,
  /** Tutorial watcher: the eyes vanish when the player gets this close, claps, or after WATCHER_SHOW_MS. */
  WATCHER_VANISH_M: 12,
  WATCHER_SHOW_MS: 6000,
  /** Finale: Hollows creep this much faster and re-hear the player every FINALE_REALERT_MS. */
  FINALE_SPEED_FACTOR: 1.6,
  FINALE_REALERT_MS: 2000,

  // ---------------- Sound design ----------------
  /** Fake scrapes (nothing there) every FAKE_SCRAPE_MIN..MAX ms, only with no Hollow within FAKE_SCRAPE_CLEAR_M. */
  FAKE_SCRAPE_MIN_MS: 20000,
  FAKE_SCRAPE_MAX_MS: 45000,
  FAKE_SCRAPE_CLEAR_M: 10,
  FAKE_SCRAPE_DISTANCE_M: 5,
  /** Now and then a clap is copied: played back late, from behind. */
  MIMIC_CHANCE: 0.3,
  MIMIC_COOLDOWN_MS: 30000,
  MIMIC_DELAY_MS: 900,
  MIMIC_DISTANCE_M: 10,
  /** Fake scrapes and mimics come from behind the player, up to this far to either side. */
  AMBIENT_BEHIND_SPREAD_DEG: 60,
  /** A Hollow this close and not in front of you breathes in one ear only. */
  EAR_BREATH_RADIUS_M: 5,
  EAR_BREATH_GAIN: 0.5,
  /** The drone fades out as a Hollow comes within DRONE_CUT_RADIUS_M (silent at DRONE_SILENT_RADIUS_M), as the Hush nears, and in quiet zones. */
  DRONE_GAIN: 0.035,
  /**
   * Background music (public/bgm.ogg) everywhere except calibration (it would skew the room
   * measurements). It sinks to BGM_STALKER_DUCK while the Stalker holds you and BGM_CAUGHT_DUCK
   * under the jumpscare; level changes ease over BGM_FADE_S.
   */
  BGM_GAIN: 0.35,
  BGM_FADE_S: 1.5,
  BGM_STALKER_DUCK: 0.25,
  BGM_CAUGHT_DUCK: 0.15,
  DRONE_CUT_RADIUS_M: 9,
  DRONE_SILENT_RADIUS_M: 3,
  /** Seconds for the drone to fade to a new level. */
  DRONE_FADE_S: 0.6,
  /** The Hush's whisper at full closeness. */
  HUSH_WHISPER_GAIN: 0.35,
  /** A running Hollow's footsteps: heard at this speed (m/s) and above, one per stride. */
  HOLLOW_STEP_MIN_SPEED: 1.6,
  HOLLOW_STRIDE_M: 1.1,
  HOLLOW_STEP_GAIN: 0.7,
  /** A Hollow's scrape is at full volume at this speed (m/s) and above. */
  HOLLOW_SCRAPE_FULL_SPEED: 3,
  /** Clicks and a rasp when a Hollow hears you and starts hunting. */
  ALERTED_GAIN: 0.6,

  // ---------------- World ----------------
  CELL_SIZE: 3,
  WALL_HEIGHT: 3.2,

  // ---------------- Cave look (render only; collision stays on the grid) ----------------
  /** Sample spacing of the rock field that is meshed into the cave (smaller = smoother, more triangles). */
  CAVE_VOXEL_M: 0.25,
  /** Rock bulges into the corridor by 0..this much at eye level. Must stay below PLAYER_RADIUS so rock never reaches the camera. */
  CAVE_WALL_BUMP_M: 0.19,
  /** Outside the eye band (below CAVE_EYE_BAND_LOW_M, above CAVE_EYE_BAND_HIGH_M) rock may bulge up to this much: ledges and an arched top. */
  CAVE_LEDGE_BUMP_M: 0.55,
  CAVE_EYE_BAND_LOW_M: 0.7,
  CAVE_EYE_BAND_HIGH_M: 2.3,
  /** Corners of the corridors are rounded over about this radius... */
  CAVE_CORNER_ROUND_M: 0.5,
  /** ...but the rounding never pushes rock more than this into the corridor (keeps it off the camera in corners). */
  CAVE_FILLET_MAX_M: 0.05,
  /** Rounding where walls meet the ceiling (an arch) and the floor. */
  CAVE_CEIL_ROUND_M: 0.9,
  CAVE_FLOOR_ROUND_M: 0.7,
  /** Floor bumps (+/-) and ceiling height variation (+/-). */
  CAVE_FLOOR_BUMP_M: 0.06,
  CAVE_CEIL_VAR_M: 0.35,
  /** Stalactites: one candidate per SPACING square, CHANCE of one hanging there, up to MAX long. */
  CAVE_STALACTITE_SPACING_M: 1.6,
  CAVE_STALACTITE_CHANCE: 0.3,
  CAVE_STALACTITE_MAX_M: 0.8,
  /** Rock layers per metre of height and how much they wander (in layers): soft bands in the stone's colour. */
  CAVE_LAYER_DENSITY: 2.2,
  CAVE_LAYER_WARP: 1.6,
  /** How strongly the layers darken the stone (0 = no banding). */
  CAVE_STRATA: 0.14,
  /** Rock grain: base frequency (cycles per metre; 3 octaves from it) and bump height (m) for the echo to catch. */
  CAVE_GRAIN_PER_M: 4,
  CAVE_GRAIN_BUMP_M: 0.05,
  /** A surface turned away from the pulse still gets this much of its light (relief shading). */
  CAVE_WRAP_LIGHT: 0.15,
  /** Crevices (rock close in front of the surface) darken down to this. */
  CAVE_CREVICE_DARK: 0.25,
  /** Sonar light weakens with distance: light / (1 + d² * this). Far rock stays dim. */
  CAVE_DISTANCE_FALLOFF: 0.012,
  /** Relief shading treats the echo as coming from this much (x distance) above its source, so overhangs fall dark. */
  CAVE_LIGHT_LIFT: 0.45,
  /**
   * A pulse lights the rock in a quick flash (decaying at CAVE_FLASH_DECAY_PER_S per second), leaving a
   * dim afterglow of CAVE_AFTERGLOW of it that fades over PULSE_FADE_S: the dark comes back fast.
   */
  CAVE_AFTERGLOW: 0.45,
  CAVE_FLASH_DECAY_PER_S: 2.3,
  /** Echo-only grading; leave the firefly jar's exposure and warm tint unchanged. */
  CAVE_ECHO_COLOR: 0xb2bdc2,
  CAVE_PULSE_GAIN: 1.1,
  CAVE_PULSE_MAX_LIGHT: 0.8,
  CAVE_PULSE_ATTACK_S: 0.035,
  CAVE_PULSE_CREVICE: 0.55,
  CAVE_PULSE_GLOSS: 0.6,
  /** Overall brightness of lit rock, and how strongly wet bumps facing you glint. */
  CAVE_EXPOSURE: 1.7,
  CAVE_GLOSS: 0.5,
  /** 0..1: rock shaded by its flat mesh faces (angular, chipped stone) rather than smooth normals. */
  CAVE_FACET: 0.4,
  /** Cold grey rock with darker floor/ceiling and a soft broken wavefront. */
  CAVE_WALL_COLOR: 0xb4b3aa,
  CAVE_FLOOR_COLOR: 0x8a877e,
  CAVE_CEIL_COLOR: 0x66686a,
  CAVE_RING_COLOR: 0xdfe7ec,
  CAVE_RING_WIDTH_M: 0.9,
  /** Exit markers sit this high so floor bumps never cover them. */
  CAVE_MARKER_Y_M: 0.1,

  // ---------------- Cave life ----------------
  /** Airborne dust per floor cell, seen only in sonar/jar light (render only). */
  DUST_PER_CELL: 36,
  DUST_DRIFT_M: 0.18,
  DUST_POINT_PX: 3.4,
  DUST_OPACITY: 0.65,
  DUST_NEAR_FADE_M: 0.35,
  DUST_FAR_FADE_M: 14,
  /** Near-lens airborne layer: close soft flecks, like dust caught in night-camera light. */
  LENS_DUST_COUNT: 1100,
  LENS_DUST_SPAN_M: 6,
  LENS_DUST_HEIGHT_M: 3.6,
  LENS_DUST_BREEZE_MPS: 0.18,
  LENS_DUST_OPACITY: 0.42,
  LENS_DUST_DIAMETER_M: 0.005,
  LENS_DUST_DEFOCUS_PX: 22,
  /** Sparse, non-glowing cave insects. One per this many open cells; no gameplay/noise effects. */
  MOTH_EVERY_CELLS: 12,
  MOTH_POINT_PX: 7,
  MOTH_DRIFT_M: 0.38,
  MOTH_FLAP_HZ: 9,
  /** One dripping spot per this many floor cells; drops fall from DRIP_TOP_M every DRIP_MIN..MAX_PERIOD_S. */
  DRIP_EVERY_CELLS: 7,
  DRIP_TOP_M: 3.0,
  DRIP_MIN_PERIOD_S: 2.5,
  DRIP_MAX_PERIOD_S: 6.5,
  DRIP_POINT_PX: 3,
  /** Drips are heard within this distance. */
  DRIP_HEAR_RADIUS_M: 12,
  DRIP_GAIN: 0.25,
  GRAVITY_MPS2: 9.8,
  /** Bats roost along the route to the exit (first at route cell BAT_ROOST_FIRST, then every BAT_ROOST_EVERY_CELLS). */
  BAT_ROOST_FIRST: 3,
  BAT_ROOST_EVERY_CELLS: 12,
  /** A clap at least this loud wakes the nearest roost within BAT_WAKE_RADIUS_M that can see the player (once per roost). */
  BAT_MIN_LOUDNESS: 0.9,
  BAT_WAKE_RADIUS_M: 14,
  /** Bats per flock; they burst over the player's head and away behind them. */
  BAT_COUNT: 6,
  BAT_SPEED: 8,
  BAT_SCATTER_M: 0.7,
  BAT_FLAP_HZ: 11,
  BAT_SIZE_M: 0.25,
  BAT_GAIN: 0.4,
  /** The rock mesh is split into square chunks of this many cells so off-screen parts are culled and the rest drawn front to back. */
  CAVE_CHUNK_CELLS: 4,
  /** Remains (bones, a dropped lantern, claw marks) per level, in dead ends first. */
  REMAINS_PER_LEVEL: 3,

  // ---------------- Pots (game/pots.ts; placed in levels.ts) ----------------
  /** Walking within this distance of a pot (player centre to pot centre) breaks it: player radius + pot radius. */
  POT_KICK_RADIUS_M: 0.6,
  /** The player must actually be moving (m/s) to kick a pot. */
  POT_KICK_MIN_SPEED: 0.05,
  /** Crash loudness on the clap scale: a gentle bump (0.8, heard ~20 m) up to walking in at full speed (1.2, ~28 m). */
  POT_LOUDNESS_SOFT: 0.8,
  POT_LOUDNESS_HARD: 1.2,
  /** The crash lights the cave from the pot like a small pulse of loudness x POT_LIGHT_SCALE, from this height. */
  POT_LIGHT_SCALE: 0.5,
  POT_LIGHT_Y_M: 0.4,
  /** Pot size (render) and crash volume (Sfx, at loudness 1). */
  POT_HEIGHT_M: 0.5,
  POT_RADIUS_M: 0.22,
  POT_SHARDS: 9,
  POT_SHARD_SCATTER_M: 0.7,
  POT_GAIN: 0.9,

  // ---------------- The Stalker (a broken pot summons it; game/Stalker.ts) ----------------
  /** It starts this far away, behind the player (up to SPREAD to either side), and walks at them through the rock. */
  STALKER_SPAWN_M: 16,
  STALKER_SPAWN_SPREAD_DEG: 50,
  STALKER_SPEED: 2,
  /** At this distance the HUD says STAND STILL; it creeps on at CREEP_SPEED (stopping STARE_M away) for WARN_MS... */
  STALKER_WARN_M: 4,
  STALKER_WARN_MS: 2500,
  STALKER_CREEP_SPEED: 1.2,
  /** ...then its face is right in front of yours for STARE_MS. Move or make any sound then and it takes you. */
  STALKER_STARE_M: 0.8,
  STALKER_STARE_MS: 3500,
  /** The first moment of the stare doesn't count, so a still player isn't judged on the last frame of a stop. */
  STALKER_STARE_GRACE_MS: 250,
  /** "Moving" during the stare: walking faster than this (m/s) or turning faster than this (rad/s). */
  STALKER_MOVE_LIMIT_MPS: 0.15,
  STALKER_TURN_LIMIT_RAD_S: 0.5,
  /** If you stay still it walks away at LEAVE_SPEED and is gone at LEAVE_M. */
  STALKER_LEAVE_SPEED: 2.4,
  STALKER_LEAVE_M: 14,
  /** When it arrives for the stare (unseen, right in front of you) the view jolts this much (m) for this long (s). */
  STALKER_STARE_SHAKE_M: 0.06,
  STALKER_STARE_SHAKE_S: 0.35,
  /** Sound: one heavy step per STRIDE_M walked; the rising dread under it at full intensity; the hit when the face appears. */
  STALKER_STRIDE_M: 1.3,
  STALKER_STEP_GAIN: 1.1,
  STALKER_DREAD_GAIN: 0.32,
  STALKER_HIT_GAIN: 0.9,
  /** High scraping strings that rise with the drone; its breathing (full while it stares); the whisper; the groan when it wakes; the STAND STILL swell. */
  STALKER_RISER_GAIN: 0.12,
  STALKER_BREATH_GAIN: 0.4,
  STALKER_WHISPER_GAIN: 0.5,
  STALKER_GROAN_GAIN: 0.6,
  STALKER_SWELL_GAIN: 0.5,

  // ---------------- Render / loop ----------------
  /** Size of the random film-grain tile (CSS overlay, animated by translation only). */
  GRAIN_TILE_PX: 160,
  CAMERA_FOV_DEG: 75,
  /** Camera near plane. Rock may bulge to within PLAYER_RADIUS of the wall line, so keep this small. */
  CAMERA_NEAR_M: 0.03,
  RENDER_SCALE: 0.75,
  MAX_DT_S: 0.05,
  /** Adaptive quality: render fps below this while playing counts as "struggling". */
  ADAPTIVE_MIN_FPS: 40,
  /** Struggling this long without a break lowers the render scale one step. */
  ADAPTIVE_LOW_FPS_MS: 3000,
  ADAPTIVE_SCALE_STEP: 0.15,
  /** The render scale never drops below this; it never rises automatically (it would oscillate). */
  ADAPTIVE_MIN_SCALE: 0.6,

  // ---------------- Game flow ----------------
  /** Menus ignore claps/hums for this long after a screen appears (the clap that closed the last screen must not skip this one). */
  MENU_INPUT_DELAY_MS: 1000,
  /** A level's intro card continues by itself after this long if the player doesn't clap. */
  INTRO_AUTO_MS: 7000,
  JUMPSCARE_MS: 2000,
  /**
   * Caught: the filmed jumpscare (public/jumpscare.mp4) plays at once, full screen, with a thud
   * (JUMPSCARE_THUD_GAIN) and the clip's own audio (JUMPSCARE_VIDEO_GAIN). After JUMPSCARE_VIDEO_MS
   * (the clip's length) it cuts to black and silence for JUMPSCARE_VIDEO_BLACK_MS, then the card.
   * If the clip can't play: just the thud and black for JUMPSCARE_MS.
   */
  JUMPSCARE_VIDEO_MS: 5500,
  JUMPSCARE_VIDEO_BLACK_MS: 600,
  JUMPSCARE_VIDEO_GAIN: 1.0,
  JUMPSCARE_THUD_GAIN: 1.0,
  /** The extra scare laid over the thud and clip (Sfx.jumpscareSting), and when the clip's face flickers back (s after the catch). */
  JUMPSCARE_STING_GAIN: 0.8,
  JUMPSCARE_FLICKER_HITS_S: [2.2, 4.1],
  /** Menus and the title screen emit a soft background pulse this often so the maze is visible behind cards. */
  ATTRACT_PULSE_MS: 2600,
  /** Non-tutorial levels show their hint line for this long after play starts. */
  LEVEL_HINT_MS: 6000,
  /** Title screen camera slowly rotates (rad/s). */
  TITLE_SPIN_RATE: 0.12,
  /** Tutorial: pulses needed in the loudness step. */
  TUTORIAL_PULSES: 2,
  /** Tutorial: total head turn (rad) to pass the look step. */
  TUTORIAL_LOOK_RAD: Math.PI / 2,
  /** Tutorial: metres to walk to pass the walk step. */
  TUTORIAL_WALK_M: 4,
  /** Tutorial: hum time (ms) to pass the hum step. */
  TUTORIAL_HUM_MS: 1500,

  // ---------------- Audio output ----------------
  MASTER_VOLUME: 0.8,
  /**
   * A cold draft from the way out (replaced the M4 chime: cave-native, quieter, rarer). The wall arrows,
   * lit by pulses, are the reliable guide; the draft only says "this side".
   */
  DRAFT_INTERVAL_MS: 5000,
  /** Peak gain of each gust before distance attenuation. */
  DRAFT_GAIN: 0.5,
  /** The draft is full volume within this distance; the guide point sits ~3 cells (9 m) ahead, so keep it large. */
  DRAFT_REF_DISTANCE_M: 8,
  /** The draft blows from this many path cells ahead of the player (not the exit itself), so its side tells which way to go. */
  DRAFT_LOOKAHEAD_CELLS: 3,
  /** Calibration feedback check: mic rises this much during the test tone => speakers leak into mic. */
  SPEAKER_LEAK_RISE_DB: 8,
  /** When speakers leak, mic onsets/hums are ignored this long after each game sound starts. */
  SPEAKER_GATE_MS: 350,
} as const;

export type Config = typeof CONFIG;
