import * as router from '@zos/router'
import * as U from '../utils/ui'
import * as haptics from '../utils/haptics'
import { getSettings } from '../utils/store'
import { COLOR, TICK_MS } from '../utils/constants'
import { getRoutine } from '../utils/posture-routines'
import { mmss } from '../utils/format'

/*
 * Guided posture player.
 *
 * Not a rest timer: one step on screen, tap to advance.
 *   - reps steps: show prescription, tap when done
 *   - timed steps: countdown, tap to skip/complete early
 * Long-press ends the session (with confirm).
 */

Page({
  onInit(params) {
    this.launchParam = params || ''
  },

  build() {
    U.keepAwake()
    const settings = getSettings()
    haptics.configure(settings.alertLevel)

    this.confirming = false
    this.overlay = null
    this.tickTimer = null
    this.routine = null
    this.stepIndex = 0
    this.startedAt = 0
    this.timedEndsAt = 0
    this.done = false

    this.bg = U.background()

    const routineId = this.parseRoutineId(this.launchParam)
    if (!routineId) {
      this.buildPicker()
      return
    }

    this.routine = getRoutine(routineId)
    if (!this.routine) {
      this.buildPicker()
      return
    }

    this.startedAt = Date.now()
    this.buildPlayer()
    this.showStep(0)
    this.bindTap()
    this.startTick()
  },

  parseRoutineId(params) {
    if (!params || typeof params !== 'string') return null
    const m = params.match(/(?:^|&)routine=([AB])(?:&|$)/)
    return m ? m[1] : null
  },

  buildPicker() {
    U.text({
      y: 70,
      h: 36,
      size: 28,
      color: COLOR.DIM,
      text: 'POSTURE',
    })
    U.text({
      y: 110,
      h: 32,
      size: 24,
      color: COLOR.DIMMER,
      text: 'Pick a home routine',
    })

    const self = this
    U.circleButton({
      x: 70,
      y: 168,
      w: 340,
      h: 88,
      color: 0x1c1c1e,
      textColor: COLOR.TEXT,
      size: 32,
      text: 'A · Open & Lift',
      onClick: function () {
        router.replace({ url: 'page/posture', params: 'routine=A' })
      },
    })
    U.circleButton({
      x: 70,
      y: 272,
      w: 340,
      h: 88,
      color: 0x1c1c1e,
      textColor: COLOR.TEXT,
      size: 32,
      text: 'B · Control & Reset',
      onClick: function () {
        router.replace({ url: 'page/posture', params: 'routine=B' })
      },
    })
    U.circleButton({
      x: 150,
      y: 386,
      w: 180,
      h: 52,
      color: 0x000000,
      textColor: COLOR.DIM,
      size: 26,
      text: 'Back',
      onClick: function () {
        router.replace({ url: 'page/index' })
      },
    })
  },

  buildPlayer() {
    this.wProgress = U.text({
      y: 56,
      h: 32,
      size: 24,
      color: COLOR.DIM,
      text: '',
    })
    this.wName = U.text({
      y: 110,
      h: 90,
      size: 34,
      color: COLOR.TEXT,
      text: '',
    })
    this.wRx = U.text({
      y: 210,
      h: 56,
      size: 42,
      color: COLOR.ACCENT,
      text: '',
    })
    this.wCue = U.text({
      y: 275,
      h: 50,
      size: 24,
      color: COLOR.DIM,
      text: '',
    })
    this.wHint = U.text({
      y: 360,
      h: 36,
      size: 22,
      color: COLOR.DIMMER,
      text: 'tap = next · hold = end',
    })

    // Done layout widgets (hidden until finish)
    this.wDoneTitle = U.text({
      y: 100,
      h: 48,
      size: 40,
      color: COLOR.ACCENT,
      text: 'DONE',
    })
    this.wDoneSub = U.text({
      y: 160,
      h: 80,
      size: 28,
      color: COLOR.TEXT,
      text: '',
    })
    this.doneHome = U.circleButton({
      x: 100,
      y: 280,
      w: 280,
      h: 80,
      color: COLOR.ACCENT,
      textColor: 0x000000,
      size: 32,
      text: 'HOME',
      onClick: function () {
        router.replace({ url: 'page/index' })
      },
    })
    U.setVisibleAll(
      [this.wDoneTitle, this.wDoneSub, this.doneHome.bg, this.doneHome.label],
      false
    )
  },

  bindTap() {
    const self = this
    this.tap = U.tapLayer(
      [this.bg, this.wProgress, this.wName, this.wRx, this.wCue, this.wHint],
      function () {
        if (self.confirming || self.done) return
        self.advance()
      },
      function () {
        if (self.confirming || self.done) return
        self.requestEnd()
      }
    )
  },

  showStep(index) {
    const steps = this.routine.steps
    if (index >= steps.length) {
      this.finish()
      return
    }
    this.stepIndex = index
    const step = steps[index]
    this.wProgress.setProperty(U.ui.prop.TEXT, index + 1 + ' / ' + steps.length)
    this.wName.setProperty(U.ui.prop.TEXT, step.name)
    this.wCue.setProperty(U.ui.prop.TEXT, step.cue || '')
    this.wHint.setProperty(U.ui.prop.TEXT, 'tap = next · hold = end')

    if (step.kind === 'timed') {
      this.timedEndsAt = Date.now() + step.seconds * 1000
      this.wRx.setProperty(U.ui.prop.TEXT, mmss(step.seconds * 1000))
    } else {
      this.timedEndsAt = 0
      this.wRx.setProperty(U.ui.prop.TEXT, step.rx || '')
    }
  },

  advance() {
    haptics.tap()
    this.showStep(this.stepIndex + 1)
  },

  startTick() {
    const self = this
    this.tickTimer = setInterval(function () {
      self.onTick()
    }, TICK_MS)
  },

  onTick() {
    if (this.done || this.confirming || !this.timedEndsAt) return
    const left = this.timedEndsAt - Date.now()
    if (left <= 0) {
      this.timedEndsAt = 0
      this.wRx.setProperty(U.ui.prop.TEXT, '0:00')
      haptics.tap()
      this.showStep(this.stepIndex + 1)
      return
    }
    this.wRx.setProperty(U.ui.prop.TEXT, mmss(left))
  },

  requestEnd() {
    if (this.confirming) return
    this.confirming = true
    const self = this
    this.overlay = U.confirmOverlay({
      title: 'End posture?',
      confirmText: 'END',
      onConfirm: function () {
        self.destroyOverlay()
        self.finish(true)
      },
      onCancel: function () {
        self.destroyOverlay()
      },
    })
  },

  destroyOverlay() {
    if (this.overlay) {
      this.overlay.destroy()
      this.overlay = null
    }
    this.confirming = false
  },

  finish(early) {
    this.done = true
    this.timedEndsAt = 0
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    if (this.tap) {
      this.tap.destroy()
      this.tap = null
    }

    const ms = Date.now() - this.startedAt
    const completed = early ? this.stepIndex : this.routine.steps.length
    U.setVisibleAll(
      [this.wProgress, this.wName, this.wRx, this.wCue, this.wHint],
      false
    )
    this.wDoneSub.setProperty(
      U.ui.prop.TEXT,
      this.routine.name +
        (early ? ' · stopped' : '') +
        '  ·  ' +
        mmss(ms) +
        '  ·  ' +
        completed +
        '/' +
        this.routine.steps.length
    )
    U.setVisibleAll(
      [this.wDoneTitle, this.wDoneSub, this.doneHome.bg, this.doneHome.label],
      true
    )
    haptics.tap()
  },

  onDestroy() {
    if (this.tickTimer) clearInterval(this.tickTimer)
    if (this.tap) this.tap.destroy()
    this.destroyOverlay()
    U.releaseAwake()
  },
})
