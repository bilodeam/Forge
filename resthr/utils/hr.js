import * as sensor from '@zos/sensor'

/*
 * Heart rate lifecycle.
 *
 * onCurrentChange() starts continuous measurement -- it is NOT free, so every
 * start() below must be paired with a stop(). Pages call start() in build()
 * and stop() in onDestroy(). The module keeps a single listener reference so a
 * double-start can't leak a second one.
 *
 * Leaked HR listeners are the classic way a Zepp OS app quietly eats a
 * battery, because continuous measurement keeps running after your page is
 * gone. If you add a new page that shows HR, copy this pattern exactly.
 */

let hrSensor = null
let listener = null
let latest = 0

function get() {
  if (!hrSensor) {
    try {
      hrSensor = new sensor.HeartRate()
    } catch (e) {
      hrSensor = null
    }
  }
  return hrSensor
}

/* onValue is called with a bpm number every time the sensor reports. */
export function start(onValue) {
  const s = get()
  if (!s) return false
  stop() // defensive: never stack listeners

  // Seed the display with the last known reading so the screen isn't blank
  // for the first few seconds while continuous measurement spins up.
  try {
    const last = s.getLast()
    if (last > 0) latest = last
  } catch (e) {}

  listener = function () {
    let v = 0
    try {
      v = s.getCurrent()
    } catch (e) {
      return
    }
    // The sensor reports 0 while it's searching for a signal. Treat that as
    // "no new data" rather than as a real reading of zero.
    if (v > 0) {
      latest = v
      if (onValue) onValue(v)
    }
  }

  try {
    s.onCurrentChange(listener)
  } catch (e) {
    listener = null
    return false
  }
  return true
}

export function stop() {
  const s = get()
  if (s && listener) {
    try {
      s.offCurrentChange(listener)
    } catch (e) {}
  }
  listener = null
}

export function current() {
  return latest
}

export function reset() {
  latest = 0
}
