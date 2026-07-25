import * as alarm from '@zos/alarm'

/* ============================================================================
 * Alarm-backed rest countdown.
 *
 * setTimeout does not survive suspension. If the screen goes off mid-rest, our
 * JS stops running and a setTimeout-based buzz never fires. @zos/alarm is a
 * system-level timer that wakes the Mini Program, so the end-of-rest alert
 * still lands.
 *
 * We schedule one alarm per rest period and cancel it the moment rest ends by
 * any other route (you tapped early, you changed the preset, you ended the
 * workout). Leaving stale alarms around means getting buzzed halfway through
 * your next set.
 *
 * store: false is deliberate -- a rest timer that survives a device reboot is
 * a rest timer buzzing at you tomorrow morning.
 * ==========================================================================*/

let currentId = 0

export function schedule(seconds) {
  cancel()
  if (!seconds || seconds <= 0) return 0
  try {
    currentId = alarm.set({
      url: 'page/strength',
      delay: Math.max(1, Math.round(seconds)),
      param: 'rest_done',
      store: false,
      repeat_type: alarm.REPEAT_ONCE,
    })
  } catch (e) {
    currentId = 0
  }
  return currentId
}

export function cancel() {
  if (!currentId) return
  try {
    alarm.cancel(currentId)
  } catch (e) {}
  currentId = 0
}

export function activeId() {
  return currentId
}
