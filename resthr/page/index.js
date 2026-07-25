import * as router from '@zos/router'
import * as U from '../utils/ui'
import * as session from '../utils/session'
import * as hr from '../utils/hr'
import * as haptics from '../utils/haptics'
import { getSettings } from '../utils/store'
import { COLOR, MODE } from '../utils/constants'
import { clock } from '../utils/format'

/*
 * Mode select. Also the recovery point: if a session is still marked active
 * (you pressed the crown mid-workout, or the watch rebooted) we offer to
 * resume it rather than silently throwing away your sets.
 *
 * HAPTICS POLICY: nothing on this screen buzzes except Discard.
 *
 * Vibration is for confirming actions you take WITHOUT looking -- ending a set
 * mid-lift, switching rest length with sweaty hands. On the mode picker you're
 * already looking at the watch and the screen visibly changes, so a buzz adds
 * nothing. Discard keeps its buzz because it destroys a workout.
 */

Page({
  state: {},

  build() {
    // Pages don't share module state -- pull the session off disk first.
    session.ensureLoaded()

    U.background()

    // A session survived. Offer resume / discard instead of the mode picker.
    if (session.hasResumable()) {
      this.buildResume()
      return
    }
    this.buildModePicker()
  },

  buildModePicker() {
    U.text({
      y: 52,
      h: 36,
      size: 28,
      color: COLOR.DIM,
      text: 'RestHR',
    })

    const self = this

    U.circleButton({
      x: 70,
      y: 100,
      w: 340,
      h: 78,
      color: 0x1c1c1e,
      textColor: COLOR.TEXT,
      size: 32,
      text: 'STRENGTH',
      onClick: function () {
        self.startWorkout(MODE.STRENGTH)
      },
    })

    U.circleButton({
      x: 70,
      y: 190,
      w: 340,
      h: 78,
      color: 0x1c1c1e,
      textColor: COLOR.TEXT,
      size: 32,
      text: 'CARDIO',
      onClick: function () {
        self.startWorkout(MODE.CARDIO)
      },
    })

    U.circleButton({
      x: 70,
      y: 280,
      w: 340,
      h: 78,
      color: 0x1c1c1e,
      textColor: COLOR.TEXT,
      size: 32,
      text: 'POSTURE',
      onClick: function () {
        router.replace({ url: 'page/posture' })
      },
    })

    U.circleButton({
      x: 165,
      y: 380,
      w: 150,
      h: 52,
      color: 0x000000,
      textColor: COLOR.DIM,
      size: 26,
      text: 'Settings',
      onClick: function () {
        router.push({ url: 'page/settings' })
      },
    })
  },

  buildResume() {
    const s = session.state()
    const label = s.mode === MODE.CARDIO ? 'Cardio' : 'Strength'

    U.text({ y: 74, h: 36, size: 28, color: COLOR.DIM, text: 'Workout in progress' })
    U.text({
      y: 120,
      h: 48,
      size: 38,
      color: COLOR.TEXT,
      text: label + ' - ' + clock(session.totalMs()),
    })
    U.text({
      y: 168,
      h: 36,
      size: 26,
      color: COLOR.DIMMER,
      text:
        s.mode === MODE.CARDIO
          ? 'still running'
          : s.sets.length + ' set' + (s.sets.length === 1 ? '' : 's') + ' logged',
    })

    U.circleButton({
      x: 80,
      y: 226,
      w: 320,
      h: 88,
      color: COLOR.ACCENT,
      textColor: 0x000000,
      size: 34,
      text: 'RESUME',
      onClick: function () {
        router.replace({
          url: s.mode === MODE.CARDIO ? 'page/cardio' : 'page/strength',
        })
      },
    })

    U.circleButton({
      x: 110,
      y: 330,
      w: 260,
      h: 72,
      color: 0x1c1c1e,
      textColor: COLOR.DANGER,
      size: 28,
      text: 'Discard',
      onClick: function () {
        haptics.tap()
        session.discard()
        // Rebuild the page as a fresh mode picker.
        router.replace({ url: 'page/index' })
      },
    })
  },

  startWorkout(mode) {
    const settings = getSettings()
    hr.reset()
    session.begin(mode, settings.restShort)
    // The session is handed over via /data/session.json, but we also pass it as
    // a launch param. If the filesystem write ever fails, the target page can
    // still start a workout from this instead of bouncing straight back here.
    router.replace({
      url: mode === MODE.CARDIO ? 'page/cardio' : 'page/strength',
      params: 'start=1&rest=' + settings.restShort,
    })
  },

  onDestroy() {
    // Nothing sensor-wise runs on this page, but stay in the habit.
    hr.stop()
  },
})
