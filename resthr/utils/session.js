import * as store from './store'
import { MODE, PHASE, SESSION_STALE_MS, RESUME_WINDOW_MS } from './constants'
import { zoneIndexFor } from './zones'
import * as vitals from './vitals'

/* ============================================================================
 * Session state.
 *
 * RULE 1: every duration in this app is derived from a wall-clock timestamp
 * (Date.now()), never from accumulated setInterval ticks. Ticks stop when the
 * Mini Program is suspended; the clock doesn't. This is what makes "screen went
 * off for four minutes" produce a correct elapsed time instead of a frozen one.
 *
 * RULE 2 -- THE ONE THAT WILL BITE YOU: each page in a Zepp OS Mini Program
 * runs in its OWN JavaScript context. Pages are bundled separately, so every
 * page gets a private copy of this module. Module-level state is NOT shared
 * across a router.replace().
 *
 * That means /data/session.json is the real source of truth between pages, not
 * the `s` object below. Every page MUST call ensureLoaded() at the top of
 * build() before reading state, or it will see a blank session.
 *
 * Symptom if you forget: the page reads startedAt === 0, bounces back to the
 * mode picker, and you get an infinite flash loop between screens.
 * ==========================================================================*/

const empty = () => ({
  active: false,
  mode: null,
  startedAt: 0,
  endedAt: 0,
  updatedAt: 0, // last time the session was written -- drives resumability

  // Time attributed to each mode. A single session can contain both: switch
  // via the in-workout menu and lifting + cardio land in one recap.
  modeStartedAt: 0,
  strengthMs: 0,
  cardioMs: 0,

  // strength
  phase: PHASE.SET,
  phaseStartedAt: 0,
  setIndex: 1,
  currentReps: 0, // reps counted so far in the in-progress set
  restSeconds: 60,
  restEndsAt: 0,
  restBuzzedAt: 0,
  sets: [], // [{ index, reps, durationMs }]

  // heart rate stats (accumulated across the whole session)
  hrSum: 0,
  hrCount: 0,
  hrMax: 0,
  hrMin: 0,
  lastHrAt: 0,

  // Time in each of the five display bands, in ms, plus anything under band 1.
  zoneMs: [0, 0, 0, 0, 0],
  belowZoneMs: 0,

  // Daily-counter snapshot taken at start, for calorie/step/distance deltas.
  vitalsStart: null,
})

let s = empty()

export function state() {
  return s
}

export function persist() {
  if (!s.active && !s.endedAt) return
  s.updatedAt = Date.now()
  store.writeSession(s)
}

export function restore() {
  const saved = store.readSession()
  if (!saved || !saved.startedAt) return false
  // Hard ceiling first, then the real test: has anything touched this session
  // recently? An abandoned workout is cleared rather than offered back.
  const idleFor = Date.now() - (saved.updatedAt || saved.startedAt)
  if (Date.now() - saved.startedAt > SESSION_STALE_MS ||
      (saved.active && idleFor > RESUME_WINDOW_MS)) {
    store.clearSession()
    return false
  }
  s = Object.assign(empty(), saved)
  return true
}

/*
 * Call this FIRST in every page's build().
 *
 * If this context already has live state, keep it. Otherwise pull the session
 * back off disk. Idempotent and cheap -- one small file read at most once per
 * page load.
 */
export function ensureLoaded() {
  if (s.startedAt) return true
  return restore()
}

/*
 * Fallback used by the mode pages when neither the in-memory state nor the
 * saved file produced a session, but the page was launched with start=1.
 * Prevents a storage failure from turning into an infinite bounce back to the
 * mode picker. Returns true if it started something.
 */
export function beginFromParams(mode, params) {
  if (s.startedAt) return false
  if (!params || String(params).indexOf('start=1') < 0) return false
  let rest = 60
  const m = String(params).match(/rest=(\d+)/)
  if (m) rest = parseInt(m[1], 10) || 60
  begin(mode, rest)
  return true
}

export function hasResumable() {
  if (!s.active || !s.startedAt) return false
  const idleFor = Date.now() - (s.updatedAt || s.startedAt)
  return idleFor <= RESUME_WINDOW_MS
}

export function discard() {
  s = empty()
  store.clearSession()
}

/* --------------------------------------------------------------------------
 * Lifecycle
 * ------------------------------------------------------------------------*/

export function begin(mode, restSeconds) {
  const now = Date.now()
  s = empty()
  s.active = true
  s.mode = mode
  s.startedAt = now
  s.modeStartedAt = now
  s.phaseStartedAt = now
  s.phase = PHASE.SET
  s.setIndex = 1
  s.restSeconds = restSeconds || 60
  // Snapshot the daily counters so we can report a session delta later.
  s.vitalsStart = vitals.snapshot()
  persist()
  return s
}

/* Bank the elapsed time against whichever mode we've been in. */
function accrueMode(now) {
  if (!s.modeStartedAt) return
  const d = now - s.modeStartedAt
  if (d > 0) {
    if (s.mode === MODE.CARDIO) s.cardioMs += d
    else s.strengthMs += d
  }
  s.modeStartedAt = now
}

/*
 * Switch modes mid-workout without ending anything. Lifting then cardio ends
 * up in one session and one recap, which is how people actually train.
 *
 * A set in progress is banked first so switching doesn't silently bin your
 * work -- but only if it lasted long enough to be a real set.
 */
export function switchMode(mode) {
  const now = Date.now()
  if (mode === s.mode) return s

  if (s.mode !== MODE.CARDIO && s.phase === PHASE.SET) {
    if (now - s.phaseStartedAt > 5000) {
      s.sets.push({
        index: s.setIndex,
        reps: s.currentReps || 0,
        durationMs: now - s.phaseStartedAt,
      })
    }
    s.currentReps = 0
  }

  accrueMode(now)
  s.mode = mode
  s.restEndsAt = 0
  s.restBuzzedAt = 0

  if (mode === MODE.CARDIO) {
    s.phase = null
  } else {
    s.phase = PHASE.SET
    s.setIndex = s.sets.length + 1
    s.phaseStartedAt = now
  }
  persist()
  return s
}

export function end() {
  accrueMode(Date.now())
  s.active = false
  s.endedAt = Date.now()
  persist()
  return s
}

/* Time spent actually under load: the sum of recorded set durations. */
export function workMs() {
  let n = 0
  for (let i = 0; i < s.sets.length; i++) n += s.sets[i].durationMs
  return n
}

/* Strength time that wasn't a set -- i.e. resting between them. */
export function restMs() {
  const r = strengthMs() - workMs()
  return r > 0 ? r : 0
}

export function strengthMs() {
  let n = s.strengthMs
  // Include the currently-running mode so the recap is right even if end()
  // hasn't been called yet.
  if (s.active && s.mode !== MODE.CARDIO && s.modeStartedAt) {
    n += Date.now() - s.modeStartedAt
  }
  return n
}

export function cardioMs() {
  let n = s.cardioMs
  if (s.active && s.mode === MODE.CARDIO && s.modeStartedAt) {
    n += Date.now() - s.modeStartedAt
  }
  return n
}

/* Mean rest actually taken between sets, in ms. */
export function avgRestMs() {
  const gaps = s.sets.length - 1
  if (gaps < 1) return 0
  return Math.round(restMs() / gaps)
}

/* --------------------------------------------------------------------------
 * Heart-rate recovery
 *
 * How far your heart rate falls in the first 30 and 60 seconds after a set.
 * This is a real conditioning marker, and this app is unusually placed to
 * measure it because it knows exactly when each set ended -- the built-in
 * workout app doesn't.
 *
 * Caveats worth remembering when reading the number: wrist optical HR lags
 * real HR by 10-20s, and sampling stops if the screen sleeps, so a set can
 * simply have no reading. Missing samples are skipped rather than guessed.
 * ------------------------------------------------------------------------*/

/* Called from the rest tick. `mark` is 30 or 60. */
export function captureRecovery(mark, hrValue) {
  if (!hrValue || hrValue <= 0) return false
  if (!s.sets.length) return false
  const last = s.sets[s.sets.length - 1]
  if (!last.hrEnd) return false
  const key = mark === 30 ? 'hr30' : 'hr60'
  if (last[key]) return false
  last[key] = hrValue
  return true
}

/*
 * Returns { mark, avg, best, early, late, count } or null.
 *
 * Prefers the 60-second figure when we have at least two samples, since that's
 * the conventional measure; falls back to 30 seconds, which survives short
 * rests far more often.
 */
export function recoveryStats() {
  const at = function (key) {
    const out = []
    for (let i = 0; i < s.sets.length; i++) {
      const set = s.sets[i]
      if (set.hrEnd && set[key] && set.hrEnd > set[key]) {
        out.push(set.hrEnd - set[key])
      }
    }
    return out
  }

  let mark = 60
  let drops = at('hr60')
  if (drops.length < 2) {
    const d30 = at('hr30')
    if (d30.length > drops.length) {
      mark = 30
      drops = d30
    }
  }
  if (!drops.length) return null

  let sum = 0
  let best = 0
  for (let i = 0; i < drops.length; i++) {
    sum += drops[i]
    if (drops[i] > best) best = drops[i]
  }

  // Split the session in half to show whether recovery decayed as you tired.
  let early = 0
  let late = 0
  if (drops.length >= 4) {
    const h = Math.floor(drops.length / 2)
    let a = 0
    let b = 0
    for (let i = 0; i < h; i++) a += drops[i]
    for (let i = drops.length - h; i < drops.length; i++) b += drops[i]
    early = Math.round(a / h)
    late = Math.round(b / h)
  }

  return {
    mark,
    avg: Math.round(sum / drops.length),
    best,
    early,
    late,
    count: drops.length,
  }
}

/* Session deltas against the snapshot taken at begin(). null if unavailable. */
export function caloriesBurned() {
  return vitals.since(s.vitalsStart, 'cal', vitals.caloriesToday())
}

export function stepsTaken() {
  return vitals.since(s.vitalsStart, 'steps', vitals.stepsToday())
}

export function distanceCovered() {
  return vitals.since(s.vitalsStart, 'dist', vitals.distanceToday())
}

export function totalMs() {
  if (!s.startedAt) return 0
  const until = s.endedAt || Date.now()
  return until - s.startedAt
}

export function phaseMs() {
  if (!s.phaseStartedAt) return 0
  return Date.now() - s.phaseStartedAt
}

/* --------------------------------------------------------------------------
 * Strength transitions
 * ------------------------------------------------------------------------*/

/* Track reps counted in the set that is currently in progress. Persisted on a
 * throttle by the page (not on every rep) to avoid a file write per curl. */
export function setCurrentReps(n) {
  s.currentReps = n < 0 ? 0 : n
}

/* Finish the current set, record it, and start the rest countdown. */
export function finishSet(reps, hrAtEnd) {
  const now = Date.now()
  s.sets.push({
    index: s.setIndex,
    reps: reps || 0,
    durationMs: now - s.phaseStartedAt,
    // Heart-rate recovery: the bpm you finished on, then samples taken 30s and
    // 60s into the rest that follows. Filled in by the strength page's tick.
    hrEnd: hrAtEnd || 0,
    hr30: 0,
    hr60: 0,
  })
  s.currentReps = 0
  s.phase = PHASE.REST
  s.phaseStartedAt = now
  s.restEndsAt = now + s.restSeconds * 1000
  s.restBuzzedAt = 0
  persist()
  return s
}

/* Leave rest, begin the next set. */
export function startNextSet() {
  const now = Date.now()
  s.setIndex = s.sets.length + 1
  s.currentReps = 0
  s.phase = PHASE.SET
  s.phaseStartedAt = now
  s.restEndsAt = 0
  s.restBuzzedAt = 0
  persist()
  return s
}

/* Change the rest preset mid-rest. Re-anchors the countdown to the moment rest
 * STARTED, not to now -- switching 60 -> 90 forty seconds in should leave you
 * 50 seconds, not 90. */
export function setRestSeconds(seconds) {
  s.restSeconds = seconds
  if (s.phase === PHASE.REST && s.phaseStartedAt) {
    s.restEndsAt = s.phaseStartedAt + seconds * 1000
    // If the new (shorter) target is already in the past we're immediately in
    // overtime; clearing the buzz flag would re-fire the alert, so leave it.
    if (s.restEndsAt > Date.now()) s.restBuzzedAt = 0
  }
  persist()
  return s
}

export function restRemainingMs() {
  if (!s.restEndsAt) return 0
  return s.restEndsAt - Date.now()
}

/* Correct the rep count of the set that was just completed (used by the crown
 * during rest). */
export function adjustLastSetReps(delta) {
  if (!s.sets.length) return 0
  const last = s.sets[s.sets.length - 1]
  last.reps = Math.max(0, last.reps + delta)
  persist()
  return last.reps
}

export function lastSetReps() {
  if (!s.sets.length) return 0
  return s.sets[s.sets.length - 1].reps
}

/* --------------------------------------------------------------------------
 * Heart rate + zone accounting
 *
 * Call on every HR sample. dt is derived from the gap between samples, so a
 * suspension gap is naturally excluded from zone totals rather than being
 * wrongly attributed to whatever zone we were in when the screen went off.
 * ------------------------------------------------------------------------*/
export function recordHr(value, bounds) {
  if (!value || value <= 0) return
  const now = Date.now()

  s.hrSum += value
  s.hrCount++
  if (value > s.hrMax) s.hrMax = value
  if (!s.hrMin || value < s.hrMin) s.hrMin = value

  if (s.lastHrAt) {
    let dt = now - s.lastHrAt
    // Cap the increment so a long suspension doesn't dump minutes into one
    // bucket based on a single stale reading.
    if (dt > 5000) dt = 0
    if (dt > 0 && bounds) {
      const i = zoneIndexFor(bounds, value)
      if (i < 0) s.belowZoneMs += dt
      else s.zoneMs[i] += dt
    }
  }
  s.lastHrAt = now
}

/* Time in zone 2 specifically -- the only band the app actually polices. */
export function zoneInMs() {
  return s.zoneMs[1]
}

export function avgHr() {
  if (!s.hrCount) return 0
  return Math.round(s.hrSum / s.hrCount)
}

export function totalReps() {
  let n = 0
  for (let i = 0; i < s.sets.length; i++) n += s.sets[i].reps
  return n
}

export function zoneTrackedMs() {
  let n = s.belowZoneMs
  for (let i = 0; i < 5; i++) n += s.zoneMs[i]
  return n
}

export { MODE, PHASE }
