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

  // ---------------- Microphone ----------------
  /** Analysis hop in samples (~2.7 ms at 48 kHz). Matches the Web Audio render quantum. */
  HOP_SIZE: 128,
  MIN_FFT_SIZE: 2048,
  /** Noise floor = FLOOR_PERCENTILE of hop levels over the last FLOOR_WINDOW_S seconds. */
  FLOOR_WINDOW_S: 3,
  FLOOR_PERCENTILE: 0.2,
  FLOOR_INIT_DB: -60,
  FLOOR_MIN_DB: -100,
  FLOOR_MAX_DB: -20,
  /** Onset (clap / click / shout) = hop level >= floor + MIN_ABOVE and >= level LOOKBACK hops ago + RISE. */
  ONSET_MIN_ABOVE_FLOOR_DB: 14,
  ONSET_RISE_DB: 15,
  ONSET_LOOKBACK_HOPS: 4,
  /** Onset is emitted after this many extra hops so its peak loudness is measured (~10 ms). */
  ONSET_PEAK_HOPS: 4,
  ONSET_REFRACTORY_MS: 200,
  /** Peak-above-floor of a "normal clap" when calibration is skipped. Maps to loudness 1.0. */
  CLAP_REF_ABOVE_DB_DEFAULT: 36,
  YIN_WINDOW_S: 0.021,
  YIN_MIN_HZ: 80,
  YIN_MAX_HZ: 1200,
  YIN_THRESHOLD: 0.15,
  /** YIN result counts as "voiced" only below this aperiodicity (0 = perfect tone). */
  YIN_MAX_APERIODICITY: 0.2,
  /** Minimum time between pitch estimates. */
  PITCH_INTERVAL_MS: 30,
  HUM_MIN_ABOVE_FLOOR_DB: 10,
  /** Level-above-floor of a "normal hum" when calibration is skipped. Maps to hum level 1.0. */
  HUM_REF_ABOVE_DB_DEFAULT: 30,
  HUM_ATTACK_MS: 100,
  HUM_RELEASE_MS: 180,
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
  BEAM_MIN_PITCH_HZ: 110,
  BEAM_MAX_PITCH_HZ: 520,
  /** Low hum => wide floodlight, high hum => narrow spotlight. */
  BEAM_WIDE_HALF_ANGLE_DEG: 34,
  BEAM_NARROW_HALF_ANGLE_DEG: 8,
  BEAM_MIN_RANGE: 6,
  BEAM_MAX_RANGE: 20,
  /** Sonar grid lines per metre drawn on revealed surfaces. */
  LINE_DENSITY: 1.5,

  // ---------------- Hearing (monsters) ----------------
  HEAR_MIN_RADIUS: 4,
  HEAR_MAX_RADIUS: 34,
  /** Distance multiplier when a wall blocks the straight line between sound and listener. */
  WALL_MUFFLE: 1.6,
  HUM_NOISE_INTERVAL_MS: 600,
  HUM_NOISE_SCALE: 0.45,
  FOOTSTEP_STRIDE_M: 0.9,
  FOOTSTEP_NOISE_MAX: 0.3,
  FOOTSTEP_MIN_AUDIBLE: 0.04,
  /**
   * Eyes closed longer than CLOSED_EYES_ALERT_MS => every CLOSED_EYES_ALERT_INTERVAL_MS the player
   * emits a 'closedEyes' sound event of this loudness (0.55 => ~15 m hearing radius).
   */
  CLOSED_EYES_ALERT_MS: 1500,
  CLOSED_EYES_ALERT_INTERVAL_MS: 1000,
  CLOSED_EYES_ALERT_LOUDNESS: 0.55,

  // ---------------- Player ----------------
  PLAYER_RADIUS: 0.35,
  EYE_HEIGHT: 1.6,
  MAX_SPEED_FWD: 2.4,
  MAX_SPEED_BACK: 1.2,
  EXIT_REACH_M: 1.2,

  // ---------------- Monsters ----------------
  MONSTER_SPEED_EYES_OPEN: 0,
  MONSTER_SPEED_BLINK: 5,
  MONSTER_SPEED_LONG_CLOSE: 8,
  LONG_CLOSE_MS: 900,
  CATCH_DISTANCE: 1.1,
  SEARCH_DURATION_MS: 6000,
  ALERT_SPEED_FACTOR: 1,
  SEARCH_SPEED_FACTOR: 0.6,
  IDLE_SPEED_FACTOR: 0.35,
  AFTERIMAGE_FADE_S: 2.6,
  BEAM_AFTERIMAGE_INTERVAL_MS: 120,
  MAX_AFTERIMAGES: 24,
  /** Heartbeat / red vignette start when an alerted monster is closer than this. */
  DANGER_RADIUS: 12,

  // ---------------- World ----------------
  CELL_SIZE: 3,
  WALL_HEIGHT: 3.2,

  // ---------------- Render / loop ----------------
  CAMERA_FOV_DEG: 75,
  RENDER_SCALE: 1,
  MAX_DT_S: 0.05,

  // ---------------- Game flow ----------------
  /** Menus ignore claps/hums for this long after a screen appears (the clap that closed the last screen must not skip this one). */
  MENU_INPUT_DELAY_MS: 1000,
  /** A level's intro card continues by itself after this long if the player doesn't clap. */
  INTRO_AUTO_MS: 7000,
  /** Jumpscare duration before the game-over card. */
  JUMPSCARE_MS: 1600,

  // ---------------- Audio output ----------------
  MASTER_VOLUME: 0.8,
  CHIME_INTERVAL_MS: 3500,
  /** Calibration feedback check: mic rises this much during the test tone => speakers leak into mic. */
  SPEAKER_LEAK_RISE_DB: 8,
  /** When speakers leak, mic onsets/hums are ignored this long after each game sound starts. */
  SPEAKER_GATE_MS: 350,
} as const;

export type Config = typeof CONFIG;
