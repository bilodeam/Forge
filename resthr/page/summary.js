import * as router from '@zos/router'
import * as U from '../utils/ui'
import * as session from '../utils/session'
import * as hr from '../utils/hr'
import * as haptics from '../utils/haptics'
import { COLOR, ZONE_BAR } from '../utils/constants'
import { paiToday } from '../utils/vitals'
import { clock, mmss, pct, bpm } from '../utils/format'

/* ============================================================================
 * Post-workout recap.
 *
 * SHAPE: the first 480px is a glance screen -- headline numbers, no scrolling
 * needed. Everything below the fold is the deep dive. The "more below" cue at
 * y=430 is what stops the fold from hiding the fact that there IS more.
 *
 * Sections that didn't happen are skipped entirely. A cardio block reading
 * "0:00 / 0%" after a pure lifting session is noise pretending to be data.
 *
 * WHAT'S HERE AND WHY:
 *   Recovery   - bpm your heart drops in the first 30/60s after a set. A real
 *                conditioning marker, and one only this app can compute because
 *                it alone knows when your sets ended. Early-vs-late shows
 *                fatigue accumulating.
 *   Density    - work as a share of lifting time. Says whether the session was
 *                brisk or leisurely; the reason work/rest are split at all.
 *   Heart rate - ONE section for the whole workout. Average, max, and where
 *                your heart rate actually lived across all five bands. Not
 *                split by mode: your heart doesn't know whether the app was
 *                showing you sets or a zone bar.
 *   Fatigue    - reps per set. Drop-off is the shape of the session.
 *   Calories   - a DELTA of the daily counter, not a measurement. Includes
 *                anything else you did in the window.
 *   PAI        - today's total, deliberately not deltaed: the watch recomputes
 *                PAI lazily, so a session delta would usually read 0.
 * ==========================================================================*/

/* Scale each RGB channel -- used to grey out zones with no time in them. */
function dimColor(color, factor) {
  const r = Math.round(((color >> 16) & 0xff) * factor)
  const g = Math.round(((color >> 8) & 0xff) * factor)
  const b = Math.round((color & 0xff) * factor)
  return (r << 16) | (g << 8) | b
}

const COL_L = 80
const COL_R = 250
const COL_W = 150
const FOLD = 480

Page({
  build() {
    session.ensureLoaded()

    const s = session.state()
    const sets = s.sets.length
    const cardioMs = session.cardioMs()
    const hasStrength = sets > 0
    const hasCardio = cardioMs > 2000

    this.targets = []
    this.targets.push(U.background())

    /* ================= GLANCE SCREEN (first 480px, no scroll) ============= */

    // y=48 not y=40: at the top of a round screen the chord narrows fast, and
    // "WORKOUT COMPLETE" is the widest string on the glance screen.
    this.add(U.text({
      y: 48, h: 24, size: 19, color: COLOR.DIMMER, text: 'WORKOUT COMPLETE',
    }))
    this.add(U.text({
      y: 68, h: 84, size: 72, color: COLOR.ACCENT, text: clock(session.totalMs()),
    }))
    this.add(U.text({
      y: 154, h: 22, size: 17, color: COLOR.DIMMER, text: 'TOTAL TIME',
    }))

    const cal = session.caloriesBurned()
    const recovery = session.recoveryStats()

    // Row 1 adapts: lifting headline if you lifted, cardio headline if not.
    if (hasStrength) {
      this.statRow(196, { value: String(sets), caption: 'SETS' },
                        { value: String(session.totalReps()), caption: 'REPS' })
    } else {
      this.statRow(196, { value: mmss(cardioMs), caption: 'DURATION' },
                        { value: pct(session.zoneInMs(), session.zoneTrackedMs()), caption: 'IN ZONE 2' })
    }

    // Row 2: the two numbers you'd want regardless of what you did.
    this.statRow(
      284,
      {
        value: cal === null ? '--' : String(cal),
        caption: 'CALORIES',
      },
      {
        value: bpm(session.avgHr()),
        caption: 'AVG HR',
        color: COLOR.HR,
      }
    )

    this.add(U.text({
      y: 400, h: 24, size: 18, color: COLOR.DIMMER, text: 'scroll for detail',
    }))
    this.add(U.text({
      y: 424, h: 26, size: 22, color: COLOR.DIVIDER, text: '. . .',
    }))

    /* ===================== DETAIL (below the fold) ======================== */

    let y = FOLD + 20

    if (recovery) {
      y = this.section(y, 'RECOVERY', COLOR.ACCENT)
      y = this.statRow(
        y,
        { value: '-' + recovery.avg, caption: 'AVG DROP (' + recovery.mark + 's)' },
        { value: '-' + recovery.best, caption: 'BEST DROP' }
      )
      // Early vs late is the fatigue signal: recovery decaying through the
      // session means you were working closer to your limit as it went on.
      if (recovery.early && recovery.late) {
        y = this.insight(
          y,
          'EARLY -' + recovery.early + '   ->   LATE -' + recovery.late
        )
      }
      y = this.insight(y, 'from ' + recovery.count + ' of ' + sets + ' sets')
      y += 10
    }

    if (hasStrength) {
      y = this.section(y, 'STRENGTH', COLOR.ACCENT)
      const work = session.workMs()
      const rest = session.restMs()
      y = this.statRow(
        y,
        { value: mmss(work), caption: 'WORK' },
        { value: mmss(rest), caption: 'REST' }
      )
      const denom = work + rest
      const density = denom > 0 ? Math.round((work / denom) * 100) : 0
      y = this.insight(y, 'DENSITY ' + density + '%')
      const avgRest = session.avgRestMs()
      if (avgRest > 0) {
        y = this.insight(
          y,
          'AVG REST ' + mmss(avgRest) + '  ( target ' + s.restSeconds + 's )'
        )
      }
      y += 10

      // Fatigue curve: reps per set, most recent 12.
      if (sets >= 2) {
        y = this.section(y, 'FATIGUE', COLOR.ACCENT)
        y = this.repBars(y, s.sets)
        y += 10
      }
    }

    /*
     * Cardio covers movement only. Heart rate is deliberately NOT reported
     * here -- it lives in one place, below, covering the whole workout.
     */
    if (hasCardio) {
      const dist = session.distanceCovered()
      const steps = session.stepsTaken()
      const hasDist = dist !== null && dist > 50

      y = this.section(y, 'CARDIO', COLOR.ACCENT)
      y = this.statRow(
        y,
        { value: mmss(cardioMs), caption: 'DURATION' },
        hasDist
          ? { value: (dist / 1000).toFixed(2), caption: 'KM' }
          : { value: steps === null ? '--' : String(steps), caption: 'STEPS' }
      )
      if (hasDist && steps !== null) {
        y = this.insight(y, steps + ' steps')
      }
      y += 10
    }

    /*
     * ONE heart-rate section for the entire workout -- lifting and cardio
     * together. Splitting HR by mode would mean two averages, two zone charts
     * and no single answer to "how hard was that session", which is the
     * question the number exists to answer. Your heart doesn't know which mode
     * the app was in.
     */
    y = this.section(y, 'HEART RATE', COLOR.HR)
    y = this.statRow(
      y,
      { value: bpm(session.avgHr()), caption: 'AVERAGE', color: COLOR.HR },
      { value: bpm(s.hrMax), caption: 'MAX', color: COLOR.HR }
    )
    y += 6
    y = this.zoneChart(y, s)

    const pai = paiToday()
    if (pai !== null) {
      y = this.insight(y, 'PAI TODAY ' + Math.round(pai))
    }

    y += 18
    this.add(U.text({
      y, h: 26, size: 20, color: COLOR.DIMMER, text: 'Tap to finish',
    }))

    const self = this
    this.tap = U.tapLayer(this.targets, function () { self.finish() }, null)
  },

  add(widget) {
    this.targets.push(widget)
    return widget
  },

  section(y, label, color) {
    this.add(U.rect({ x: 80, y: y + 15, w: 62, h: 1, color: COLOR.DIVIDER }))
    this.add(U.rect({ x: 338, y: y + 15, w: 62, h: 1, color: COLOR.DIVIDER }))
    this.add(U.text({ y, h: 30, size: 21, color, text: label }))
    return y + 46
  },

  statRow(y, left, right) {
    const cells = [{ x: COL_L, d: left }, { x: COL_R, d: right }]
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      this.add(U.text({
        x: c.x, y, w: COL_W, h: 46, size: 38,
        color: c.d.color === undefined ? COLOR.TEXT : c.d.color,
        text: c.d.value,
      }))
      this.add(U.text({
        x: c.x, y: y + 46, w: COL_W, h: 22, size: 16,
        color: COLOR.DIMMER, text: c.d.caption,
      }))
    }
    return y + 80
  },

  insight(y, text) {
    this.add(U.text({
      x: 70, y, w: 340, h: 28, size: 19, color: COLOR.DIM, text,
    }))
    return y + 32
  },

  /*
   * Reps per set as vertical bars. Capped at the last 12 sets -- beyond that
   * the bars get too thin to read and the early sets matter least.
   */
  repBars(y, sets) {
    const shown = sets.length > 12 ? sets.slice(sets.length - 12) : sets
    let max = 1
    for (let i = 0; i < shown.length; i++) {
      if (shown[i].reps > max) max = shown[i].reps
    }

    const X = 80
    const W = 320
    const H = 76
    const gap = 4
    const bw = Math.max(6, Math.floor(W / shown.length) - gap)

    for (let i = 0; i < shown.length; i++) {
      const h = Math.max(3, Math.round((shown[i].reps / max) * H))
      this.add(U.rect({
        x: X + i * (bw + gap),
        y: y + (H - h),
        w: bw,
        h,
        radius: 3,
        color: COLOR.ACCENT,
      }))
    }

    this.add(U.text({
      x: 70, y: y + H + 6, w: 340, h: 24, size: 16, color: COLOR.DIMMER,
      text: 'SET 1 to ' + sets.length + '   peak ' + max + ' reps',
    }))
    return y + H + 36
  },

  /*
   * Zone spread: one row per band, covering the WHOLE session -- lifting and
   * cardio together, since recordHr() runs on both screens.
   *
   * Why rows and not a stacked bar: on a lifting day most of your heart rate
   * sits below zone 1, so a stacked bar becomes one grey slab with slivers of
   * colour. You can't compare bands, can't read values, and the dominant band
   * swallows the rest. Rows give every zone its own baseline.
   *
   * Bars are scaled to the LARGEST band, not to total time. Scaling to total
   * would squash everything into the left edge on exactly the sessions where
   * you most want to see the distribution. Absolute values are carried by the
   * time column instead, so nothing is lost.
   *
   * Empty zones still get a row. "You never reached zone 5" is information.
   */
  zoneChart(y, s) {
    const total = session.zoneTrackedMs()

    if (total <= 0) {
      this.add(U.text({
        x: 70, y, w: 340, h: 26, size: 18, color: COLOR.DIMMER,
        text: 'no heart-rate data',
      }))
      return y + 34
    }

    // Highest zone at the top, so the chart reads like effort descending.
    const rows = []
    for (let i = 4; i >= 0; i--) {
      rows.push({
        label: 'Z' + (i + 1),
        ms: s.zoneMs[i],
        color: ZONE_BAR.COLORS[i],
      })
    }
    rows.push({ label: '<Z1', ms: s.belowZoneMs, color: 0x4a4a4c })

    let max = 1
    let peak = -1
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].ms > max) max = rows[i].ms
      if (peak < 0 || rows[i].ms > rows[peak].ms) peak = i
    }

    const BADGE_X = 76
    const BADGE_W = 40
    const TRACK_X = 126
    const TRACK_W = 186
    const TRACK_H = 10
    const ROW_H = 30
    const PITCH = 40

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const ry = y + i * PITCH
      const active = r.ms > 0

      // Colour chip carries the zone identity; dimmed when unused.
      this.add(U.rect({
        x: BADGE_X, y: ry, w: BADGE_W, h: ROW_H, radius: 8,
        color: active ? r.color : dimColor(r.color, 0.28),
      }))
      this.add(U.text({
        x: BADGE_X, y: ry, w: BADGE_W, h: ROW_H, size: 16,
        color: active ? 0x000000 : 0x6a6a6c, text: r.label,
      }))

      this.add(U.rect({
        x: TRACK_X, y: ry + 10, w: TRACK_W, h: TRACK_H, radius: 5,
        color: 0x1c1c1e,
      }))
      if (active) {
        const w = Math.max(6, Math.round((r.ms / max) * TRACK_W))
        this.add(U.rect({
          x: TRACK_X, y: ry + 10, w, h: TRACK_H, radius: 5, color: r.color,
        }))
      }

      this.add(U.text({
        x: 318, y: ry, w: 86, h: ROW_H, size: 18,
        color: active ? COLOR.TEXT : COLOR.DIMMER,
        text: active ? mmss(r.ms) : '--',
        align: U.ui.align.RIGHT,
      }))
    }

    let next = y + rows.length * PITCH + 4

    // One line of meaning rather than six numbers to interpret yourself.
    if (peak >= 0 && rows[peak].ms > 0) {
      const share = Math.round((rows[peak].ms / total) * 100)
      this.add(U.text({
        x: 70, y: next, w: 340, h: 26, size: 18, color: COLOR.DIM,
        text: 'MOSTLY ' + rows[peak].label + '  -  ' + share + '% of session',
      }))
      next += 30
    }

    return next
  },

  finish() {
    haptics.tap()
    hr.reset()
    session.discard()
    router.replace({ url: 'page/index' })
  },

  onDestroy() {
    if (this.tap) this.tap.destroy()
    hr.stop()
  },
})
