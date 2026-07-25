/* ============================================================================
 * constants.js -- EVERYTHING YOU ARE LIKELY TO WANT TO TUNE LIVES HERE.
 *
 * Screen is 480 x 480, round, centre at (240, 240). Anything you place near
 * the top or bottom edge loses horizontal room fast: at y = 60 you only have
 * about 340px of usable width, at y = 380 about 400px. Text widgets below are
 * full-width and centre-aligned, which sidesteps the problem for short strings.
 * ==========================================================================*/

export const SCREEN = {
  W: 480,
  H: 480,
  CX: 240,
  CY: 240,
}

export const COLOR = {
  BG: 0x000000,
  TEXT: 0xffffff,
  DIM: 0x8a8a8a,
  DIMMER: 0x555555,
  ACCENT: 0x00d9a3, // rest / in-zone green
  WARN: 0xff9500, // approaching / overtime amber
  DANGER: 0xff3b30, // out of zone / overtime red
  HR: 0xff4d6a, // heart rate pink
  CHIP_OFF: 0x1c1c1e,
  CHIP_ON: 0x00d9a3,
  DIVIDER: 0x2c2c2e,
}

/* ---------------------------------------------------------------------------
 * DEFAULT SETTINGS
 * These are the values a fresh install starts with. They are all editable on
 * the watch in the Settings page and persisted to /data/settings.json, so
 * changing them here only affects a first run (or after you clear app data).
 * -------------------------------------------------------------------------*/
export const DEFAULT_SETTINGS = {
  restShort: 60, // seconds -- the default preset
  restLong: 90, // seconds -- the alternate preset
  zoneLow: 120, // bpm -- bottom of zone 2
  zoneHigh: 135, // bpm -- top of zone 2 (your number)
  repDetect: true, // master switch for accelerometer rep counting
  alertLevel: 2, // 0 light, 1 medium, 2 strong -- see ALERT_LEVELS
  keyDebug: false, // show a live readout of physical key events on screen
}

/* ---------------------------------------------------------------------------
 * ALERT STRENGTH
 *
 * Zepp OS exposes vibration as fixed "scenes", not as a numeric intensity, so
 * this picks a different scene and repeat count rather than turning a dial.
 *
 *   0 LIGHT  -- two short taps. Worn tight, quiet room.
 *   1 MEDIUM -- one strong reminder burst (four pulses over 1.2s).
 *   2 STRONG -- the same burst twice. Loose strap, noisy gym, default.
 *
 * Applies to the end-of-rest alert and both zone alerts.
 * -------------------------------------------------------------------------*/
export const ALERT_LEVELS = ['LIGHT', 'MEDIUM', 'STRONG']

/* Bounds enforced by the Settings page so you can't crown-scroll into nonsense */
export const SETTING_LIMITS = {
  rest: { min: 15, max: 300, step: 5 },
  zone: { min: 80, max: 200, step: 1 },
}

/* ---------------------------------------------------------------------------
 * ZONE 2 ALERTING
 * The whole point of these numbers is to stop the watch buzzing at you every
 * few seconds while you hover on the boundary, which is exactly where you'll
 * spend the session. Raise BREACH_MS if it still feels twitchy; raise
 * COOLDOWN_MS if it nags.
 * -------------------------------------------------------------------------*/
export const ZONE = {
  BREACH_MS: 10000, // must be continuously out of zone this long before buzzing
  COOLDOWN_MS: 30000, // minimum gap between two zone buzzes
  GRACE_MS: 45000, // no zone alerts at all for this long after starting cardio
  // Optical HR is noisy. A single sample outside the band shouldn't reset or
  // trigger anything; we require this many consecutive out-of-band samples.
  MIN_SAMPLES: 3,
}

/* ---------------------------------------------------------------------------
 * REP DETECTION TUNING
 *
 * Algorithm: accelerometer magnitude -> slow EMA removes gravity/orientation
 * -> fast EMA smooths noise -> hysteresis crossing counter.
 *
 * A rep is counted when the smoothed signal rises above +THRESHOLD and then
 * falls back below -THRESHOLD * HYSTERESIS, no sooner than REFRACTORY_MS after
 * the previous rep.
 *
 * Units are cm/s^2 (gravity is ~981). If it UNDER-counts, lower MIN_THRESHOLD
 * and ADAPTIVE_GAIN. If it OVER-counts (phantom reps from fidgeting), raise
 * them. Change one at a time and do a set of 10 slow curls to check.
 * -------------------------------------------------------------------------*/
export const REP = {
  BASELINE_ALPHA: 0.02, // slow EMA -- tracks gravity, must be much slower than a rep
  SMOOTH_ALPHA: 0.35, // fast EMA -- noise smoothing, higher = more responsive
  ENVELOPE_ALPHA: 0.05, // tracks recent movement amplitude for the adaptive threshold
  MIN_THRESHOLD: 90, // cm/s^2 floor -- stops it counting you standing still
  ADAPTIVE_GAIN: 0.55, // threshold = max(MIN_THRESHOLD, envelope * ADAPTIVE_GAIN)
  HYSTERESIS: 0.5, // fraction of threshold the signal must fall back through
  REFRACTORY_MS: 550, // fastest plausible rep (~1.8 reps/sec)
  IDLE_RESET_MS: 8000, // no crossings for this long -> reset the arming state
}

/* ---------------------------------------------------------------------------
 * HR ZONE BAR (cardio screen)
 *
 * READ THIS BEFORE TRUSTING ZONES 1, 3, 4 AND 5.
 *
 * The only heart-rate numbers you have actually given the app are the zone 2
 * bounds. The other four zones are EXTRAPOLATED by repeating the width of
 * zone 2 above and below it -- with 120-135 that yields 105-120, 135-150,
 * 150-165, 165-180.
 *
 * That is a display convention, not physiology. It exists to give the bar
 * context so you can see where you sit relative to your target, and nothing
 * else in the app depends on it: every alert is driven purely by zoneLow and
 * zoneHigh. Do not read zone 5 here as a real threshold.
 *
 * If you ever get properly tested zone boundaries, replace deriveZones() in
 * page/cardio.js with the real numbers.
 * -------------------------------------------------------------------------*/
export const ZONE_BAR = {
  COLORS: [0x2f6fd0, 0x00d9a3, 0xd9b800, 0xe07b1f, 0xe03b30],
  // Non-active segments are drawn at this fraction of their colour, so the
  // zone you're actually in reads as "lit".
  DIM: 0.34,
  TARGET_INDEX: 1, // zone 2, zero-based -- the one the app polices
}

/* ---------------------------------------------------------------------------
 * EDGE ARCS
 *
 * Two arcs hugging the bezel: teal down the left, red down the right. They are
 * not decoration -- each one encodes a live value, with a dot marking the
 * current position.
 *
 *   LEFT  = time progress. On the set screen it fills as the set runs
 *           (0 -> SET_FULL_S). On the rest screen it DRAINS as the countdown
 *           runs, so a glance tells you how much rest is left without reading.
 *   RIGHT = heart rate mapped between HR_MIN and HR_MAX.
 *
 * Angles: 0 degrees = 3 o'clock. Both arcs are described from their TOP end
 * (where the dot starts) downward.
 *
 * DIR flips the sweep direction. If the arcs render mirrored or filled the
 * wrong way on your firmware, flip this to -1 and nothing else needs changing.
 * -------------------------------------------------------------------------*/
export const ARC = {
  DIR: 1,
  WIDTH: 6, // stroke thickness
  INSET: 12, // distance from the screen edge
  DOT_R: 7,

  // Left arc sweeps from 10 o'clock down to 7 o'clock.
  LEFT_TOP: 212,
  LEFT_BOTTOM: 132,

  // Right arc mirrors it: 2 o'clock down to 5 o'clock.
  RIGHT_TOP: -32,
  RIGHT_BOTTOM: 48,

  SET_FULL_S: 120, // set duration that fills the left arc completely
  HR_MIN: 60, // bottom of the right arc's heart-rate range
  HR_MAX: 170, // top of the right arc's heart-rate range
}

/* ---------------------------------------------------------------------------
 * TIMING / DISPLAY
 * -------------------------------------------------------------------------*/
export const TICK_MS = 200 // UI refresh rate. 200ms is smooth enough and cheap.
export const BRIGHT_TIME_MS = 600000 // how long to hold the screen awake per page
export const LONG_PRESS_MS = 800 // hold-anywhere-to-end threshold
/*
 * RESUME WINDOW -- measured from the last time the session was TOUCHED, not
 * from when it started.
 *
 * Leaving via the crown exits the app without ending the workout, so sessions
 * are routinely abandoned rather than finished. Gating on start time meant a
 * session from hours ago still looked live and greeted you with a discard
 * prompt every launch. A real interruption gets resumed within a minute or two;
 * anything untouched this long is abandoned and is cleared silently.
 */
export const RESUME_WINDOW_MS = 20 * 60 * 1000
export const SESSION_STALE_MS = 6 * 60 * 60 * 1000 // hard ceiling, belt and braces

export const MODE = {
  STRENGTH: 'strength',
  CARDIO: 'cardio',
  POSTURE: 'posture',
}

export const PHASE = {
  SET: 'set',
  REST: 'rest',
}
