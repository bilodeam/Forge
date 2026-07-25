import * as sensor from '@zos/sensor'
import { REP } from './constants'

/* ============================================================================
 * Accelerometer rep counter.
 *
 * HONEST EXPECTATIONS: this counts wrist oscillations, not reps. On rhythmic
 * full-range movements (curls, presses, rows, pulldowns) it lands close. On
 * short-range or slow grinding movements, or anything where the bar sits on
 * your back and the wrist barely travels, it will be wrong. It will also count
 * you re-racking or adjusting your grip. That is why the count is a secondary
 * display and is crown-correctable during rest.
 *
 * Pipeline:
 *   magnitude = |(x,y,z)|                       (cm/s^2, gravity ~= 981)
 *   baseline  = slow EMA of magnitude           (removes gravity + orientation)
 *   signal    = magnitude - baseline
 *   smoothed  = fast EMA of signal              (kills sensor noise)
 *   envelope  = slow EMA of |smoothed|          (how hard you're moving)
 *   threshold = max(MIN_THRESHOLD, envelope * ADAPTIVE_GAIN)
 *
 * A rep is counted on the DOWNWARD crossing after the signal has been armed by
 * an upward crossing -- i.e. one full up-and-down of the wrist. Refractory
 * period stops a single jerky rep registering twice.
 *
 * All tuning constants live in constants.js under REP.
 * ==========================================================================*/

export class RepDetector {
  constructor() {
    this.reset()
    this.accel = null
    this.listener = null
    this.running = false
    this.onRep = null
  }

  reset() {
    this.baseline = 0
    this.smoothed = 0
    this.envelope = 0
    this.armed = false
    this.primed = false // becomes true once baseline has settled
    this.samples = 0
    this.lastRepAt = 0
    this.lastCrossAt = 0
    this.count = 0
  }

  /* Feed one accelerometer sample. Returns true if this sample completed a rep. */
  push(x, y, z, now) {
    const mag = Math.sqrt(x * x + y * y + z * z)

    // Seed the baseline on the first sample, otherwise the first ~50 samples
    // are dominated by the ramp from zero to gravity and produce fake reps.
    if (this.samples === 0) {
      this.baseline = mag
    }
    this.samples++

    this.baseline += REP.BASELINE_ALPHA * (mag - this.baseline)
    const signal = mag - this.baseline
    this.smoothed += REP.SMOOTH_ALPHA * (signal - this.smoothed)
    this.envelope +=
      REP.ENVELOPE_ALPHA * (Math.abs(this.smoothed) - this.envelope)

    // Wait for the baseline EMA to converge before trusting anything.
    if (!this.primed) {
      if (this.samples > 40) this.primed = true
      return false
    }

    const threshold = Math.max(
      REP.MIN_THRESHOLD,
      this.envelope * REP.ADAPTIVE_GAIN
    )
    const release = threshold * REP.HYSTERESIS

    // Long quiet stretch -- forget any half-finished rep so a movement started
    // before a pause doesn't pair up with an unrelated one after it.
    if (this.armed && now - this.lastCrossAt > REP.IDLE_RESET_MS) {
      this.armed = false
    }

    if (!this.armed) {
      if (this.smoothed > threshold) {
        this.armed = true
        this.lastCrossAt = now
      }
      return false
    }

    // Armed: waiting for the downward half of the movement.
    if (this.smoothed < -release) {
      this.armed = false
      this.lastCrossAt = now
      if (now - this.lastRepAt >= REP.REFRACTORY_MS) {
        this.lastRepAt = now
        this.count++
        if (this.onRep) this.onRep(this.count)
        return true
      }
    }
    return false
  }

  /* Begin sampling. onRep(count) fires on each detected rep. */
  start(onRep) {
    if (this.running) return true
    this.onRep = onRep
    try {
      this.accel = new sensor.Accelerometer()
    } catch (e) {
      this.accel = null
      return false
    }

    const self = this
    this.listener = function () {
      let d = null
      try {
        d = self.accel.getCurrent()
      } catch (e) {
        return
      }
      if (!d) return
      self.push(d.x, d.y, d.z, Date.now())
    }

    try {
      this.accel.onChange(this.listener)
      // NORMAL is the right trade-off here: HIGH burns noticeably more power
      // for resolution we don't need at ~1 rep/second. If reps are being
      // missed on fast movements, try FREQ_MODE_HIGH.
      this.accel.setFreqMode(sensor.FREQ_MODE_NORMAL)
      this.accel.start()
      this.running = true
      return true
    } catch (e) {
      this.listener = null
      this.accel = null
      return false
    }
  }

  /* Stop sampling. MUST be called when leaving the SET phase -- the
   * accelerometer running during rest is both the biggest source of phantom
   * reps and about half the battery cost of this app. */
  stop() {
    if (this.accel) {
      try {
        if (this.listener) this.accel.offChange(this.listener)
      } catch (e) {}
      try {
        this.accel.stop()
      } catch (e) {}
    }
    this.listener = null
    this.running = false
  }

  getCount() {
    return this.count
  }

  setCount(n) {
    this.count = n < 0 ? 0 : n
  }
}
