import * as sensor from '@zos/sensor'

/* ============================================================================
 * Vibration patterns.
 *
 * Alerts must be distinguishable without looking at the watch:
 *   restDone -- one strong burst   (the system "strong reminder")
 *   zoneHigh -- three short taps   ("ease off")
 *   zoneLow  -- two long buzzes    ("push")
 *
 * CALL-SHAPE WARNING: the Zepp OS docs contradict themselves on setMode(). The
 * type signature says it takes an option object, `setMode({ mode })`, but the
 * worked example passes the raw constant, `setMode(VIBRATOR_SCENE_DURATION)`.
 * We try both, in example-first order, and remember which one worked so we only
 * pay for the probe once.
 *
 * Nothing here is silently swallowed any more. Failures set `lastError`, which
 * the Settings "TEST BUZZ" button surfaces, so a dead vibrator looks like a
 * dead vibrator rather than like a broken timer.
 * ==========================================================================*/

let vibrator = null
let chain = []
let modeStyle = null // 'raw' | 'object' | 'none'
let lastError = ''
let level = 2 // 0 light, 1 medium, 2 strong -- see ALERT_LEVELS in constants

/*
 * Set the alert strength. Called from each page's build() after reading
 * settings, so this module never has to import the store -- keeping it a dumb
 * output device with no opinions about persistence.
 */
export function configure(n) {
  level = typeof n === 'number' && n >= 0 && n <= 2 ? n : 2
}

export function getLevel() {
  return level
}

function get() {
  if (vibrator) return vibrator
  try {
    vibrator = new sensor.Vibrator()
  } catch (e) {
    vibrator = null
    lastError = 'Vibrator constructor failed: ' + e
  }
  return vibrator
}

function clearChain() {
  for (let i = 0; i < chain.length; i++) clearTimeout(chain[i])
  chain = []
}

/* Resolve a scene constant by name, falling back through alternatives so one
 * missing export doesn't kill an alert entirely. */
function scene(names) {
  for (let i = 0; i < names.length; i++) {
    const v = sensor[names[i]]
    if (typeof v === 'number') return v
  }
  return undefined
}

function applyMode(v, mode) {
  if (mode === undefined) return false

  // Documented example form first.
  if (modeStyle === null || modeStyle === 'raw') {
    try {
      v.setMode(mode)
      modeStyle = 'raw'
      return true
    } catch (e) {
      if (modeStyle === 'raw') modeStyle = null
    }
  }
  // Documented type-signature form.
  if (modeStyle === null || modeStyle === 'object') {
    try {
      v.setMode({ mode })
      modeStyle = 'object'
      return true
    } catch (e) {
      if (modeStyle === 'object') modeStyle = null
    }
  }
  modeStyle = 'none'
  return false
}

/* Fire one vibration in `mode`. Returns true if start() was reached. */
function pulse(mode) {
  const v = get()
  if (!v) return false

  try {
    v.stop()
  } catch (e) {}

  const modeOk = applyMode(v, mode)

  try {
    // If setMode didn't take, start() also accepts a per-shot option object.
    if (!modeOk && mode !== undefined) v.start({ mode })
    else v.start()
    return true
  } catch (e) {
    // Last resort: default scene is better than total silence.
    try {
      v.start()
      return true
    } catch (e2) {
      lastError = 'start() failed: ' + e2
      return false
    }
  }
}

function burst(mode, count, gap) {
  clearChain()
  const ok = pulse(mode)
  for (let i = 1; i < count; i++) {
    chain.push(
      setTimeout(
        (function (m) {
          return function () {
            pulse(m)
          }
        })(mode),
        gap * i
      )
    )
  }
  return ok
}

/* End of rest -- the one alert the whole app exists for.
 * LIGHT: two short taps. MEDIUM: one reminder burst. STRONG: that burst twice. */
export function restDone() {
  if (level === 0) {
    return burst(scene(['VIBRATOR_SCENE_SHORT_STRONG', 'VIBRATOR_SCENE_SHORT_MIDDLE']), 2, 220)
  }
  const m = scene([
    'VIBRATOR_SCENE_STRONG_REMINDER',
    'VIBRATOR_SCENE_DURATION_LONG',
    'VIBRATOR_SCENE_DURATION',
  ])
  const ok = pulse(m)
  if (level === 2) {
    chain.push(
      setTimeout(function () {
        pulse(m)
      }, 1400)
    )
  }
  return ok
}

/* Too high: three short taps, "slow down". */
export function zoneHigh() {
  const m =
    level === 0
      ? scene(['VIBRATOR_SCENE_SHORT_LIGHT', 'VIBRATOR_SCENE_SHORT_MIDDLE'])
      : scene(['VIBRATOR_SCENE_SHORT_STRONG', 'VIBRATOR_SCENE_SHORT_MIDDLE'])
  return burst(m, 3, 200)
}

/* Too low: two long buzzes, "pick it up". */
export function zoneLow() {
  const m =
    level === 0
      ? scene(['VIBRATOR_SCENE_SHORT_STRONG', 'VIBRATOR_SCENE_DURATION'])
      : scene(['VIBRATOR_SCENE_DURATION', 'VIBRATOR_SCENE_DURATION_LONG'])
  return burst(m, 2, level === 0 ? 400 : 750)
}

/* Light confirmation for taps and toggles. */
export function tap() {
  return pulse(scene(['VIBRATOR_SCENE_SHORT_LIGHT', 'VIBRATOR_SCENE_SHORT_MIDDLE']))
}

export function stop() {
  clearChain()
  const v = get()
  if (v) {
    try {
      v.stop()
    } catch (e) {}
  }
}

/* Diagnostics, surfaced by the Settings test button. */
export function status() {
  const v = get()
  return {
    hasVibrator: !!v,
    modeStyle: modeStyle || 'untried',
    level: level,
    strongReminder: scene(['VIBRATOR_SCENE_STRONG_REMINDER']),
    lastError: lastError,
  }
}
