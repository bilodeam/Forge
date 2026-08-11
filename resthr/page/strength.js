import * as router from '@zos/router'
import * as U from '../utils/ui'
import * as session from '../utils/session'
import * as hr from '../utils/hr'
import * as haptics from '../utils/haptics'
import * as keys from '../utils/keys'
import * as restAlarm from '../utils/rest-alarm'
import { RepDetector } from '../utils/rep-detector'
import { getSettings } from '../utils/store'
import { COLOR, TICK_MS, PHASE, MODE, ARC, SCREEN, CLOCK_24H } from '../utils/constants'
import { clock, mmss, bpm, timeOfDay } from '../utils/format'
import { deriveZones } from '../utils/zones'

/* ============================================================================
 * Strength page. Owns both phases of the loop:
 *
 *   SET  --tap-->  REST  --tap-->  SET  --tap-->  REST ...
 *                                   \--hold--> confirm --> SUMMARY
 *
 * Both layouts are built once and toggled with visibility rather than being
 * torn down and rebuilt.
 *
 * LAYOUT (480x480 round). The two edge arcs use the bezel instead of fighting
 * it, which is what frees the middle for one big number. Everything else is
 * stacked on the centre line, where the chord is widest.
 *
 *   y  22  heart glyph
 *   y  72  TOTAL TIME / HEART RATE captions
 *   y  94  values (18:42 | 128 BPM)
 *   y 146  phase pill  (SET 3 / REST · 3 / OT · 3)
 *   y 198  hero number (reps or countdown)
 *   y 330  caption + divider rules
 *   y 362  secondary value (set time) or controls (reps, chips)
 *
 * The arcs encode live data -- see the ARC block in constants.js.
 * ==========================================================================*/

const PERSIST_EVERY_MS = 5000

/* Arc geometry: a full-screen box inset from the bezel. */
const ARC_BOX = {
  x: ARC.INSET,
  y: ARC.INSET,
  w: SCREEN.W - ARC.INSET * 2,
  h: SCREEN.H - ARC.INSET * 2,
  radius: (SCREEN.W - ARC.INSET * 2) / 2,
}
const ARC_R = ARC_BOX.radius

Page({
  onInit(params) {
    // 'rest_done' when the system alarm relaunched us with the screen off,
    // or 'start=1&rest=NN' when opened from the mode picker.
    this.launchParam = params || null
  },

  build() {
    U.keepAwake()

    this.settings = getSettings()
    haptics.configure(this.settings.alertLevel)
    this.detector = new RepDetector(this.settings.repSensitivity)
    this.confirming = false
    this.overlay = null
    this.lastPersistAt = 0

    // MUST come before reading state: this page has its own JS context and its
    // own blank copy of the session module.
    session.ensureLoaded()
    session.beginFromParams(MODE.STRENGTH, this.launchParam)

    const s = session.state()
    if (!s.startedAt) {
      router.replace({ url: 'page/index' })
      return
    }

    this.bounds = deriveZones(this.settings.zoneLow, this.settings.zoneHigh)

    this.bg = U.background()
    this.buildArcs()
    this.buildCommon()
    this.buildSetLayout()
    this.buildRestLayout()

    const self = this
    this.tap = U.tapLayer(
      [
        this.bg,
        this.wTotal,
        this.wTotalCap,
        this.wHr,
        this.wHrCap,
        this.wBpm,
        this.wPillLabel,
        this.wCountdown,
      ].concat(this.setGroup),
      function () {
        self.onAdvance()
      },
      function () {
        self.onEndRequested()
      }
    )

    keys.capture({
      onAdvance: function () {
        self.onAdvance()
      },
      onEnd: function () {
        self.onEndRequested()
      },
      // Live key readout, so you can find out what the crown actually reports
      // without needing a terminal attached.
      onDebug: this.settings.keyDebug
        ? function (name, code, event) {
            if (!self.wKeyDebug) return
            self.wKeyDebug.setProperty(
              U.ui.prop.TEXT,
              name + ' (' + code + ') ev' + event
            )
          }
        : null,
    })

    if (this.settings.keyDebug) {
      this.wKeyDebug = U.text({
        x: 60, y: 440, w: 360, h: 24, size: 15, color: COLOR.WARN,
        text: 'press a key...',
      })
      console.log('[keys] available: ' + keys.availableKeys())
    }

    hr.start(function (value) {
      session.recordHr(value, self.bounds)
    })

    this.applyPhase()
    this.tick()
    this.timer = setInterval(function () {
      self.tick()
    }, TICK_MS)
  },

  /* ------------------------------------------------------------------ arcs */

  buildArcs() {
    // Dim tracks, always full length, so the arc reads as a gauge rather than
    // a floating line.
    U.arc({
      x: ARC_BOX.x, y: ARC_BOX.y, w: ARC_BOX.w, h: ARC_BOX.h,
      radius: ARC_BOX.radius,
      start: ARC.LEFT_BOTTOM, end: ARC.LEFT_TOP,
      width: ARC.WIDTH, color: 0x14231f,
    })
    U.arc({
      x: ARC_BOX.x, y: ARC_BOX.y, w: ARC_BOX.w, h: ARC_BOX.h,
      radius: ARC_BOX.radius,
      start: ARC.RIGHT_TOP, end: ARC.RIGHT_BOTTOM,
      width: ARC.WIDTH, color: 0x2a1418,
    })

    this.arcLeft = U.arc({
      x: ARC_BOX.x, y: ARC_BOX.y, w: ARC_BOX.w, h: ARC_BOX.h,
      radius: ARC_BOX.radius,
      start: ARC.LEFT_TOP - 1, end: ARC.LEFT_TOP,
      width: ARC.WIDTH, color: COLOR.ACCENT,
    })
    this.arcRight = U.arc({
      x: ARC_BOX.x, y: ARC_BOX.y, w: ARC_BOX.w, h: ARC_BOX.h,
      radius: ARC_BOX.radius,
      start: ARC.RIGHT_TOP, end: ARC.RIGHT_TOP + 1,
      width: ARC.WIDTH, color: COLOR.HR,
    })

    const l = U.pointOnCircle(SCREEN.CX, SCREEN.CY, ARC_R, ARC.LEFT_TOP)
    const r = U.pointOnCircle(SCREEN.CX, SCREEN.CY, ARC_R, ARC.RIGHT_TOP)
    this.dotLeft = U.dot({ cx: l.x, cy: l.y, r: ARC.DOT_R, color: COLOR.ACCENT })
    this.dotRight = U.dot({ cx: r.x, cy: r.y, r: ARC.DOT_R, color: COLOR.HR })
  },

  /*
   * fraction 0..1, measured from the TOP end of each arc downward.
   * An ARC with start === end can render as a full circle on some firmware,
   * so the sweep is floored at 1 degree.
   */
  updateArc(which, fraction) {
    let f = fraction
    if (!(f >= 0)) f = 0
    if (f > 1) f = 1

    const isLeft = which === 'left'
    const top = isLeft ? ARC.LEFT_TOP : ARC.RIGHT_TOP
    const bottom = isLeft ? ARC.LEFT_BOTTOM : ARC.RIGHT_BOTTOM
    const span = (bottom - top) * ARC.DIR
    let sweep = span * f
    if (Math.abs(sweep) < 1) sweep = span > 0 ? 1 : -1

    const edge = top + sweep
    const start = isLeft ? edge : top
    const end = isLeft ? top : edge

    U.setArcEnd(isLeft ? this.arcLeft : this.arcRight, {
      x: ARC_BOX.x, y: ARC_BOX.y, w: ARC_BOX.w, h: ARC_BOX.h,
      radius: ARC_BOX.radius,
      start, end,
      width: ARC.WIDTH,
      color: isLeft ? COLOR.ACCENT : COLOR.HR,
    })

    const p = U.pointOnCircle(SCREEN.CX, SCREEN.CY, ARC_R, edge)
    U.moveDot(
      isLeft ? this.dotLeft : this.dotRight,
      p.x, p.y, ARC.DOT_R,
      isLeft ? COLOR.ACCENT : COLOR.HR
    )
  },

  /* ---------------------------------------------------------------- layout */

  buildCommon() {
    // Heart glyph. Falls back to nothing if the asset is missing -- the screen
    // still works, it just loses its crown.
    U.image({ x: 214, y: 22, w: 52, h: 46, src: 'heart.png' })

    this.wTotalCap = U.text({
      x: 100, y: 72, w: 136, h: 22,
      size: 17, color: COLOR.DIMMER, text: 'STRENGTH',
    })
    this.wTotal = U.text({
      x: 100, y: 94, w: 136, h: 42,
      size: 32, color: COLOR.TEXT, text: '0:00',
    })

    this.wHrCap = U.text({
      x: 244, y: 72, w: 136, h: 22,
      size: 17, color: COLOR.DIMMER, text: 'HEART RATE',
    })
    // Number is right-aligned so the unit stays put as the value changes
    // width -- otherwise "99 BPM" and "128 BPM" would jitter against each other.
    this.wHr = U.text({
      x: 236, y: 94, w: 104, h: 42,
      size: 40, color: COLOR.HR, text: '--',
      align: U.ui.align.RIGHT,
    })
    this.wBpm = U.text({
      x: 344, y: 104, w: 56, h: 28,
      size: 18, color: COLOR.HR, text: 'BPM',
      align: U.ui.align.LEFT,
    })

    /*
     * Time of day, bottom centre, same position on every screen so your eye
     * learns one spot. Deliberately no seconds: two live timers already
     * compete for attention and a ticking third would win.
     */
    this.wClock = U.text({
      y: 434, h: 26, size: 22, color: COLOR.TEXT, text: '',
    })

    // Phase pill. Wider than before so "REST · 3" / "SET 12" stay one line.
    // Filled dark rather than outlined: a stroked rounded rect needs a widget
    // type that isn't guaranteed, and the fill reads the same.
    this.wPill = U.rect({
      x: 156, y: 146, w: 168, h: 44, radius: 22, color: 0x0d2f27,
    })
    this.wPillLabel = U.text({
      x: 156, y: 146, w: 168, h: 44,
      size: 25, color: COLOR.ACCENT, text: 'SET 1',
    })
  },

  buildSetLayout() {
    this.setGroup = []

    this.wReps = U.text({
      y: 196, h: 120, size: 102, color: COLOR.TEXT, text: '0',
    })
    this.wRepsCaption = U.text({
      y: 320, h: 24, size: 20, color: COLOR.DIM, text: 'REPS',
    })
    // Rules either side of the caption, as in the reference.
    this.wRuleL = U.rect({ x: 150, y: 331, w: 58, h: 2, color: COLOR.DIVIDER })
    this.wRuleR = U.rect({ x: 272, y: 331, w: 58, h: 2, color: COLOR.DIVIDER })

    this.wSetTime = U.text({
      y: 352, h: 46, size: 38, color: COLOR.TEXT, text: '0:00',
    })
    this.wSetTimeCaption = U.text({
      y: 398, h: 22, size: 18, color: COLOR.DIMMER, text: 'SET TIME',
    })
    // Hairline so SET TIME and the clock don't read as one stacked group.
    this.wClockRule = U.rect({
      x: 196, y: 428, w: 88, h: 1, color: 0x1c1c1e,
    })

    this.setGroup.push(
      this.wReps,
      this.wRepsCaption,
      this.wRuleL,
      this.wRuleR,
      this.wSetTime,
      this.wSetTimeCaption,
      this.wClockRule
    )
  },

  buildRestLayout() {
    this.restGroup = []
    const self = this

    this.wCountdown = U.text({
      y: 186, h: 110, size: 96, color: COLOR.ACCENT, text: '0:00',
    })
    this.restGroup.push(this.wCountdown)

    // Rep correction. Buttons rather than the crown, because crown-rotation
    // capture isn't reliably available to Mini Programs on every firmware.
    const minus = U.circleButton({
      x: 96, y: 304, w: 54, h: 52,
      color: COLOR.CHIP_OFF, textColor: COLOR.TEXT, size: 32, text: '-',
      onClick: function () { self.adjustReps(-1) },
    })
    this.wRestReps = U.text({
      x: 158, y: 304, w: 164, h: 52,
      size: 30, color: COLOR.TEXT, text: '0 reps',
    })
    const plus = U.circleButton({
      x: 330, y: 304, w: 54, h: 52,
      color: COLOR.CHIP_OFF, textColor: COLOR.TEXT, size: 32, text: '+',
      onClick: function () { self.adjustReps(1) },
    })
    this.restGroup.push(minus.bg, minus.label, this.wRestReps, plus.bg, plus.label)

    const shortSec = this.settings.restShort
    const longSec = this.settings.restLong

    const chipShort = U.circleButton({
      x: 104, y: 364, w: 124, h: 54,
      color: COLOR.CHIP_OFF, textColor: COLOR.TEXT, size: 28,
      text: shortSec + 's',
      onClick: function () { self.chooseRest(shortSec) },
    })
    const chipLong = U.circleButton({
      x: 252, y: 364, w: 124, h: 54,
      color: COLOR.CHIP_OFF, textColor: COLOR.TEXT, size: 28,
      text: longSec + 's',
      onClick: function () { self.chooseRest(longSec) },
    })
    this.chipShort = chipShort
    this.chipLong = chipLong
    this.restGroup.push(chipShort.bg, chipShort.label, chipLong.bg, chipLong.label)
  },

  /* ------------------------------------------------------------ transitions */

  applyPhase() {
    const s = session.state()
    const inSet = s.phase === PHASE.SET

    U.setVisibleAll(this.setGroup, inSet)
    U.setVisibleAll(this.restGroup, !inSet)

    if (inSet) {
      U.restScreenOnSet()
      this.detector.reset()
      this.detector.setCount(s.currentReps || 0)
      if (this.settings.repDetect) {
        const self = this
        this.detector.start(function (count) {
          session.setCurrentReps(count)
          self.wReps.setProperty(U.ui.prop.TEXT, String(count))
        })
      }
    } else {
      // Accelerometer OFF during rest -- biggest single battery saving, and it
      // stops phantom reps accumulating while you stand around.
      this.detector.stop()
      this.refreshChips()
      this.refreshRestReps()
      // Bright for a few seconds so you see the countdown, then auto-dim.
      U.restScreenOnRest()
    }
  },

  onAdvance() {
    if (this.confirming) return
    const s = session.state()
    // No confirmation buzz here. The screen changes completely -- pill, hero
    // number, controls -- which is feedback enough. Vibration is reserved for
    // things you need to notice while NOT looking at the watch.

    if (s.phase === PHASE.SET) {
      const reps = this.settings.repDetect ? this.detector.getCount() : 0
      this.detector.stop()
      // Capture the HR you finished the set on -- the baseline for recovery.
      session.finishSet(reps, hr.current())
      const secs = session.state().restSeconds
      const alarmId = restAlarm.schedule(secs)
      // alarmId 0 means the system refused the timer -- the screen-off backup
      // is gone and only the foreground tick will buzz.
      console.log('[rest] started ' + secs + 's, alarmId=' + alarmId)
    } else {
      restAlarm.cancel()
      haptics.stop()
      session.startNextSet()
    }
    this.applyPhase()
    this.tick()
  },

  chooseRest(seconds) {
    const s = session.state()
    if (s.phase !== PHASE.REST) return
    U.restScreenOnRest()
    haptics.tap()
    session.setRestSeconds(seconds)
    const remaining = Math.round(session.restRemainingMs() / 1000)
    if (remaining > 0) restAlarm.schedule(remaining)
    else restAlarm.cancel()
    this.refreshChips()
    this.tick()
  },

  refreshChips() {
    const s = session.state()
    const shortOn = s.restSeconds === this.settings.restShort
    try {
      this.chipShort.bg.setProperty(U.ui.prop.MORE, {
        color: shortOn ? COLOR.CHIP_ON : COLOR.CHIP_OFF,
      })
      this.chipLong.bg.setProperty(U.ui.prop.MORE, {
        color: !shortOn ? COLOR.CHIP_ON : COLOR.CHIP_OFF,
      })
      this.chipShort.label.setProperty(U.ui.prop.MORE, {
        color: shortOn ? 0x000000 : COLOR.TEXT,
      })
      this.chipLong.label.setProperty(U.ui.prop.MORE, {
        color: !shortOn ? 0x000000 : COLOR.TEXT,
      })
    } catch (e) {
      /* Recolouring unsupported -- chips still work, they just won't highlight */
    }
  },

  adjustReps(delta) {
    const s = session.state()
    if (s.phase !== PHASE.REST) return
    U.restScreenOnRest()
    // Deliberately silent. Correcting a rep count is a fiddly, repeated action
    // -- buzzing on every tap turns a small fix into a wrist massage.
    session.adjustLastSetReps(delta)
    this.refreshRestReps()
  },

  refreshRestReps() {
    const n = session.lastSetReps()
    this.wRestReps.setProperty(U.ui.prop.TEXT, n + (n === 1 ? ' rep' : ' reps'))
  },

  setPill(text, textColor, fill) {
    try {
      this.wPillLabel.setProperty(U.ui.prop.TEXT, text)
      this.wPillLabel.setProperty(U.ui.prop.MORE, { color: textColor })
      this.wPill.setProperty(U.ui.prop.MORE, {
        x: 156, y: 146, w: 168, h: 44, radius: 22, color: fill,
      })
    } catch (e) {}
  },

  /* ------------------------------------------------------------------ tick */

  tick() {
    const s = session.state()
    const now = Date.now()
    const hrValue = hr.current()

    // STRENGTH time, not session total: switching to cardio banks this and the
    // number stops. It resumes if you come back.
    this.wTotal.setProperty(U.ui.prop.TEXT, clock(session.strengthMs()))
    this.wClock.setProperty(U.ui.prop.TEXT, timeOfDay(CLOCK_24H))
    this.wHr.setProperty(U.ui.prop.TEXT, bpm(hrValue))

    // Right arc: heart rate across its display range.
    this.updateArc(
      'right',
      hrValue > 0 ? (hrValue - ARC.HR_MIN) / (ARC.HR_MAX - ARC.HR_MIN) : 0
    )

    if (s.phase === PHASE.SET) {
      const setMs = session.phaseMs()
      this.setPill('SET ' + s.setIndex, COLOR.ACCENT, 0x0d2f27)
      this.wSetTime.setProperty(U.ui.prop.TEXT, clock(setMs))
      if (this.settings.repDetect) {
        this.wReps.setProperty(U.ui.prop.TEXT, String(this.detector.getCount()))
      } else {
        this.wReps.setProperty(U.ui.prop.TEXT, '-')
      }
      // Left arc fills as the set runs.
      this.updateArc('left', setMs / 1000 / ARC.SET_FULL_S)
    } else {
      const remaining = session.restRemainingMs()
      const totalRest = s.restSeconds * 1000

      // Heart-rate recovery samples, 30s and 60s into the rest.
      const restElapsed = now - s.phaseStartedAt
      if (restElapsed >= 30000 && session.captureRecovery(30, hr.current())) {
        session.persist()
      }
      if (restElapsed >= 60000 && session.captureRecovery(60, hr.current())) {
        session.persist()
      }

      if (remaining > 0) {
        this.wCountdown.setProperty(U.ui.prop.TEXT, mmss(remaining))
        this.setCountdownColor(COLOR.ACCENT)
        // Same pill slot as SET N -- setIndex is still the set you just finished
        // until startNextSet() runs.
        this.setPill('REST · ' + s.setIndex, COLOR.ACCENT, 0x0d2f27)
        // Left arc DRAINS -- how much rest is left, without reading a number.
        this.updateArc('left', remaining / totalRest)
      } else {
        // Overtime: count UP in red. We deliberately do not auto-start the next
        // set -- starting a set you aren't doing corrupts the log.
        this.wCountdown.setProperty(U.ui.prop.TEXT, '+' + mmss(-remaining))
        this.setCountdownColor(COLOR.DANGER)
        this.setPill('OT · ' + s.setIndex, COLOR.DANGER, 0x3a1210)
        this.updateArc('left', 0)

        if (!s.restBuzzedAt) {
          s.restBuzzedAt = now
          // Bring the screen up with the buzz so OT is readable at a glance.
          U.restScreenOnRest()
          const ok = haptics.restDone()
          const st = haptics.status()
          console.log(
            '[rest] countdown hit zero -- buzz fired=' + ok +
            ' hasVibrator=' + st.hasVibrator +
            ' modeStyle=' + st.modeStyle +
            ' err=' + st.lastError
          )
          session.persist()
        }
      }
    }

    if (now - this.lastPersistAt > PERSIST_EVERY_MS) {
      this.lastPersistAt = now
      session.persist()
    }
  },

  setCountdownColor(color) {
    try {
      this.wCountdown.setProperty(U.ui.prop.MORE, { color })
    } catch (e) {}
  },

  /* --------------------------------------------------------------- ending */

  /*
   * In-workout menu. Opened by the upper-right key if the system lets us have
   * it, and by hold-anywhere regardless.
   *
   * RESUME is deliberately first and highlighted: the menu must be safe to
   * open by accident. Nothing here ends a workout except FINISH, so no extra
   * confirmation step is needed.
   */
  onEndRequested() {
    if (this.confirming) return
    this.confirming = true
    U.restScreenBright()
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
        text: 'CARDIO',
        onSelect: function () {
          self.dismissOverlay()
          self.goCardio()
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

  /* Switch to cardio without ending the workout -- both halves land in one
   * recap. Any set in progress is banked by switchMode(). */
  goCardio() {
    restAlarm.cancel()
    haptics.stop()
    this.detector.stop()
    U.restScreenDispose()
    session.switchMode(MODE.CARDIO)
    router.replace({ url: 'page/cardio' })
  },

  dismissOverlay() {
    if (this.overlay) {
      this.overlay.destroy()
      this.overlay = null
    }
    this.confirming = false
    // If we closed the menu during rest, re-arm auto-dim.
    if (session.state().phase === PHASE.REST) U.restScreenOnRest()
  },

  endWorkout() {
    restAlarm.cancel()
    haptics.stop()
    this.detector.stop()
    U.restScreenDispose()
    session.end()
    router.replace({ url: 'page/summary' })
  },

  /* ------------------------------------------------------------- lifecycle */

  onResume() {
    U.keepAwake()
    if (session.state().phase === PHASE.REST) U.restScreenOnRest()
    else U.restScreenOnSet()
    if (this.timer) this.tick()
  },

  onDestroy() {
    // Tear down EVERY listener. A leaked HR or accelerometer listener keeps
    // sampling after the page is gone and will visibly cost battery.
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.detector) this.detector.stop()
    hr.stop()
    keys.release()
    if (this.tap) this.tap.destroy()
    this.dismissOverlay()
    session.persist()
    U.restScreenDispose()
    U.releaseAwake()
  },
})
