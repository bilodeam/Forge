import * as router from '@zos/router'
import * as U from '../utils/ui'
import * as session from '../utils/session'
import * as hr from '../utils/hr'
import * as haptics from '../utils/haptics'
import * as keys from '../utils/keys'
import { getSettings } from '../utils/store'
import { COLOR, TICK_MS, ZONE, ZONE_BAR, MODE, CLOCK_24H } from '../utils/constants'
import { clock, bpm, pct, timeOfDay } from '../utils/format'
import { deriveZones, zoneIndexFor } from '../utils/zones'

/* ============================================================================
 * Cardio page. One timer, live HR, zone-2 policing.
 *
 * Zone-high loop (HR >= zoneHigh ≈ zone 3+):
 *   ~5s out of zone 2 → ~2s buzz → 15s quiet → repeat until back in band.
 *
 * A buzz requires ALL of:
 *   - past the opening grace period
 *   - at least ZONE.MIN_SAMPLES consecutive out-of-band ticks
 *   - out for ZONE.BREACH_MS (brief flickers back in don't reset; need RECOVER_MS)
 *   - at least ZONE.COOLDOWN_MS since the last buzz
 *
 * Patterns:
 *   high  = taps across ~2s ("ease off")
 *   low   = two long buzzes ("push")
 *
 * Alerts run from tick() using the latest HR, not only from sensor callbacks --
 * callback-only checks were easy to miss when the sensor went quiet while high.
 *
 * IMPORTANT: the five-segment bar is DISPLAY. Only zone 2 comes from your
 * numbers; zones 1/3/4/5 are extrapolated. Alerts use zoneLow/zoneHigh only.
 * ==========================================================================*/

const PERSIST_EVERY_MS = 5000

/* Bar geometry */
const BAR_X = 90
const BAR_W = 300
const BAR_Y = 276
const BAR_H = 28
const SEG_W = BAR_W / 5

/* Scale each RGB channel -- used to dim the segments you're not in. */
function dimColor(color, factor) {
  const r = Math.round(((color >> 16) & 0xff) * factor)
  const g = Math.round(((color >> 8) & 0xff) * factor)
  const b = Math.round((color & 0xff) * factor)
  return (r << 16) | (g << 8) | b
}

Page({
  onInit(params) {
    this.launchParam = params || null
  },

  build() {
    U.keepAwake()

    this.settings = getSettings()
    haptics.configure(this.settings.alertLevel)
    this.confirming = false
    this.overlay = null
    this.lastPersistAt = 0

    // Zone alert state
    this.breachBand = null
    this.breachStartedAt = 0
    this.breachSamples = 0
    this.recoverStartedAt = 0
    this.lastAlertAt = 0
    this.litIndex = -1

    session.ensureLoaded()
    session.beginFromParams(MODE.CARDIO, this.launchParam)

    const s = session.state()
    if (!s.startedAt) {
      router.replace({ url: 'page/index' })
      return
    }

    this.bounds = deriveZones(this.settings.zoneLow, this.settings.zoneHigh)

    this.bg = U.background()
    this.buildLayout()

    // Cardio has no "advance" action -- only hold-to-end.
    const self = this
    this.tap = U.tapLayer(
      [this.bg, this.wElapsed, this.wElapsedCap, this.wHr, this.wPctCap, this.wPct, this.wClock],
      null,
      function () {
        self.onEndRequested()
      }
    )

    keys.capture({
      onAdvance: null,
      onEnd: function () {
        self.onEndRequested()
      },
    })

    hr.start(function (value) {
      // Keep session stats fresh; zone policing runs from tick() so a steady
      // high reading still arms the 5s timer without needing a new callback.
      session.recordHr(value, self.bounds)
    })

    this.tick()
    this.timer = setInterval(function () {
      self.tick()
    }, TICK_MS)
  },

  buildLayout() {
    const low = this.settings.zoneLow
    const high = this.settings.zoneHigh

    this.wElapsedCap = U.text({
      y: 52, h: 22, size: 17, color: COLOR.DIMMER, text: 'CARDIO TIME',
    })
    this.wElapsed = U.text({
      y: 74, h: 42, size: 34, color: COLOR.TEXT, text: '0:00',
    })

    /*
     * HR is the hero -- in cardio it's the number you steer by, and its colour
     * carries the in/out signal without needing to read the bar.
     * The glyph and unit sit to the right of a centred number; a 3-digit value
     * at this size spans roughly x=145..335, so x=356 clears it.
     */
    this.wHr = U.text({
      y: 122, h: 126, size: 112, color: COLOR.ACCENT, text: '--',
    })
    U.image({ x: 356, y: 164, w: 36, h: 32, src: 'heart-outline.png' })
    U.text({
      x: 344, y: 202, w: 60, h: 26,
      size: 18, color: COLOR.DIM, text: 'BPM',
    })

    /*
     * Five-segment zone bar. Segments are square-cornered: FILL_RECT applies a
     * radius to all four corners, so rounding only the outer ends would leave
     * visible notches where segments meet. A crisp bar beats a lumpy one.
     */
    this.segments = []
    for (let i = 0; i < 5; i++) {
      const seg = U.rect({
        x: Math.round(BAR_X + i * SEG_W),
        y: BAR_Y,
        w: Math.ceil(SEG_W),
        h: BAR_H,
        radius: 0,
        color: dimColor(ZONE_BAR.COLORS[i], ZONE_BAR.DIM),
      })
      this.segments.push(seg)
      // Zone number, centred in its segment.
      U.text({
        x: Math.round(BAR_X + i * SEG_W),
        y: BAR_Y,
        w: Math.ceil(SEG_W),
        h: BAR_H,
        size: 19,
        color: 0xffffff,
        text: String(i + 1),
      })
    }

    // Position marker above the bar.
    this.wMarker = U.image({
      x: BAR_X + Math.round(BAR_W / 2) - 11,
      y: BAR_Y - 18,
      w: 22,
      h: 14,
      src: 'marker.png',
    })

    this.wZoneLabel = U.text({
      y: 310, h: 26, size: 22, color: COLOR.ACCENT, text: 'ZONE 2',
    })
    U.text({
      y: 338, h: 24, size: 19, color: COLOR.DIM,
      text: low + ' - ' + high + ' BPM',
    })

    U.rect({ x: 140, y: 368, w: 200, h: 1, color: COLOR.DIVIDER })

    this.wPctCap = U.text({
      y: 374, h: 20, size: 16, color: COLOR.DIMMER, text: 'IN ZONE',
    })
    this.wPct = U.text({
      y: 394, h: 36, size: 32, color: COLOR.ACCENT, text: '0%',
    })

    // Same position as the strength screen.
    this.wClock = U.text({
      y: 434, h: 26, size: 22, color: COLOR.TEXT, text: '',
    })
  },

  /* ------------------------------------------------------------ HR + zones */

  /*
   * Zone police. Called every tick with the latest bpm. Returns early while
   * HR is 0 (sensor still hunting) so we don't treat "no signal" as in-zone.
   */
  evaluateZone(value) {
    if (!(value > 0)) return

    const low = this.settings.zoneLow
    const high = this.settings.zoneHigh
    const now = Date.now()
    const s = session.state()

    // No nagging while your HR is still climbing at the start.
    if (now - s.startedAt < ZONE.GRACE_MS) {
      this.resetBreach()
      return
    }

    // Match the on-screen ZONE 3 label: zone 2 is [low, high), above is >= high.
    const band = value >= high ? 'above' : value < low ? 'below' : 'in'

    if (band === 'in') {
      // Sticky breach: brief dips back to 134 while "in zone 3" on average
      // used to wipe the 5s timer. Require sustained in-zone before clearing.
      if (!this.breachBand) return
      if (!this.recoverStartedAt) this.recoverStartedAt = now
      if (now - this.recoverStartedAt >= ZONE.RECOVER_MS) this.resetBreach()
      return
    }

    this.recoverStartedAt = 0

    if (band !== this.breachBand) {
      // Switched sides (or first reading outside) -- restart the clock.
      this.breachBand = band
      this.breachStartedAt = now
      this.breachSamples = 1
      return
    }

    this.breachSamples++
    if (this.breachSamples < ZONE.MIN_SAMPLES) return
    if (now - this.breachStartedAt < ZONE.BREACH_MS) return
    if (this.lastAlertAt && now - this.lastAlertAt < ZONE.COOLDOWN_MS) return

    this.lastAlertAt = now
    console.log('[zone] alert band=' + band + ' hr=' + value + ' high=' + high)
    const ok = band === 'above' ? haptics.zoneHigh() : haptics.zoneLow()
    // If the short-tap scene isn't available on this firmware, still make noise.
    if (!ok) haptics.restDone()
  },

  resetBreach() {
    this.breachBand = null
    this.breachStartedAt = 0
    this.breachSamples = 0
    this.recoverStartedAt = 0
  },

  lightSegment(index) {
    if (index === this.litIndex) return
    this.litIndex = index
    for (let i = 0; i < 5; i++) {
      const full = ZONE_BAR.COLORS[i]
      const c = i === index ? full : dimColor(full, ZONE_BAR.DIM)
      try {
        this.segments[i].setProperty(U.ui.prop.MORE, {
          x: Math.round(BAR_X + i * SEG_W),
          y: BAR_Y,
          w: Math.ceil(SEG_W),
          h: BAR_H,
          radius: 0,
          color: c,
        })
      } catch (e) {}
    }
  },

  /* ------------------------------------------------------------------ tick */

  tick() {
    const now = Date.now()
    const value = hr.current()
    const low = this.settings.zoneLow
    const high = this.settings.zoneHigh

    // CARDIO time, not session total -- starts from zero when you switch in.
    this.wElapsed.setProperty(U.ui.prop.TEXT, clock(session.cardioMs()))
    this.wClock.setProperty(U.ui.prop.TEXT, timeOfDay(CLOCK_24H))
    this.wHr.setProperty(U.ui.prop.TEXT, bpm(value))

    let color = COLOR.DIM
    if (value > 0) {
      if (value > high) color = COLOR.DANGER
      else if (value < low) color = COLOR.WARN
      else color = COLOR.ACCENT
    }
    try {
      this.wHr.setProperty(U.ui.prop.MORE, { color })
    } catch (e) {}

    if (value > 0) {
      // Marker slides across the whole five-zone span, clamped at both ends.
      const lo = this.bounds[0]
      const hi = this.bounds[5]
      let f = (value - lo) / (hi - lo)
      if (f < 0) f = 0
      if (f > 1) f = 1
      const mx = BAR_X + Math.round(f * BAR_W) - 11
      try {
        this.wMarker.setProperty(U.ui.prop.MORE, {
          x: mx, y: BAR_Y - 18, w: 22, h: 14, src: 'marker.png',
        })
      } catch (e) {}

      const zi = zoneIndexFor(this.bounds, value)
      this.lightSegment(zi)
      this.wZoneLabel.setProperty(
        U.ui.prop.TEXT,
        zi >= 0 ? 'ZONE ' + (zi + 1) : 'BELOW ZONE 1'
      )
      try {
        this.wZoneLabel.setProperty(U.ui.prop.MORE, {
          color: zi === ZONE_BAR.TARGET_INDEX ? COLOR.ACCENT : COLOR.DIM,
        })
      } catch (e) {}
    }

    const tracked = session.zoneTrackedMs()
    this.wPct.setProperty(U.ui.prop.TEXT, pct(session.zoneInMs(), tracked))

    // Zone alerts: run here so a sustained high HR still triggers even when
    // the sensor stops emitting callbacks for a few seconds.
    this.evaluateZone(value)

    if (now - this.lastPersistAt > PERSIST_EVERY_MS) {
      this.lastPersistAt = now
      session.persist()
    }
  },

  /* --------------------------------------------------------------- ending */

  /* Same menu as the strength screen, with STRENGTH offered instead of CARDIO. */
  onEndRequested() {
    if (this.confirming) return
    this.confirming = true
    haptics.tap()

    const self = this
    this.overlay = U.menuOverlay([
      {
        text: 'RESUME',
        fill: COLOR.ACCENT,
        textColor: 0x000000,
        onSelect: function () { self.dismissOverlay() },
      },
      {
        text: 'STRENGTH',
        onSelect: function () {
          self.dismissOverlay()
          haptics.stop()
          session.switchMode(MODE.STRENGTH)
          router.replace({ url: 'page/strength' })
        },
      },
      {
        text: 'FINISH',
        textColor: COLOR.DANGER,
        onSelect: function () {
          self.dismissOverlay()
          self.endWorkout()
        },
      },
      {
        text: 'SETTINGS',
        textColor: COLOR.DIM,
        onSelect: function () {
          self.dismissOverlay()
          router.push({ url: 'page/settings' })
        },
      },
    ])
  },

  dismissOverlay() {
    if (this.overlay) {
      this.overlay.destroy()
      this.overlay = null
    }
    this.confirming = false
  },

  endWorkout() {
    haptics.stop()
    session.end()
    router.replace({ url: 'page/summary' })
  },

  /* ------------------------------------------------------------- lifecycle */

  onResume() {
    U.keepAwake()
    if (this.timer) this.tick()
  },

  onDestroy() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    hr.stop()
    keys.release()
    if (this.tap) this.tap.destroy()
    this.dismissOverlay()
    session.persist()
    U.releaseAwake()
  },
})
