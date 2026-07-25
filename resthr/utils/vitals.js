import * as sensor from '@zos/sensor'

/* ============================================================================
 * Daily body metrics: calories, steps, distance, PAI.
 *
 * IMPORTANT: every one of these is a DAILY CUMULATIVE counter. There is no
 * "calories for this workout" API. So a session figure is snapshot-at-start
 * subtracted from read-at-end.
 *
 * That delta is a decent proxy, not a measurement. It includes anything else
 * you did during the session window -- walking to the water fountain counts.
 * It will also differ from the native workout app's estimate, which uses its
 * own model.
 *
 * PAI is deliberately NOT deltaed. The watch recomputes PAI on its own
 * schedule, often hours later, so a session delta would usually read 0 and
 * look broken. Today's total is the honest thing to show.
 *
 * Every sensor is probed with checkSensor() where available and every call is
 * guarded -- a missing sensor returns null and the recap simply omits the row
 * rather than printing a zero.
 * ==========================================================================*/

function make(Ctor) {
  if (!Ctor) return null
  try {
    if (typeof sensor.checkSensor === 'function' && !sensor.checkSensor(Ctor)) {
      return null
    }
  } catch (e) {
    /* checkSensor unavailable -- fall through and just try constructing */
  }
  try {
    return new Ctor()
  } catch (e) {
    return null
  }
}

function read(instance, method) {
  if (!instance || typeof instance[method] !== 'function') return null
  try {
    const v = instance[method]()
    return typeof v === 'number' && v >= 0 ? v : null
  } catch (e) {
    return null
  }
}

let calorie = null
let step = null
let distance = null
let pai = null

export function caloriesToday() {
  if (!calorie) calorie = make(sensor.Calorie)
  return read(calorie, 'getCurrent')
}

export function stepsToday() {
  if (!step) step = make(sensor.Step)
  return read(step, 'getCurrent')
}

/* Metres, per the Distance sensor's units. */
export function distanceToday() {
  if (!distance) distance = make(sensor.Distance)
  return read(distance, 'getCurrent')
}

export function paiToday() {
  if (!pai) pai = make(sensor.Pai)
  return read(pai, 'getToday')
}

/* Snapshot everything worth deltaing, taken when a workout starts. */
export function snapshot() {
  return {
    cal: caloriesToday(),
    steps: stepsToday(),
    dist: distanceToday(),
  }
}

/*
 * Difference between now and a snapshot. Returns null for any metric that
 * wasn't readable at either end, or that went backwards (which happens at
 * midnight when the daily counter resets).
 */
export function since(snap, key, currentValue) {
  if (!snap) return null
  const start = snap[key]
  if (start === null || start === undefined) return null
  if (currentValue === null || currentValue === undefined) return null
  const d = currentValue - start
  return d >= 0 ? d : null
}
