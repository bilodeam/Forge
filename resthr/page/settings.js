import * as router from '@zos/router'
import * as U from '../utils/ui'
import * as haptics from '../utils/haptics'
import { getSettings, saveSettings } from '../utils/store'
import { COLOR, SETTING_LIMITS, ALERT_LEVELS } from '../utils/constants'

/* ============================================================================
 * Settings.
 *
 * Taller than the screen, so it relies on the default vertical page scrolling.
 * Controls are kept inside x = 76..404 because rows scrolled to the very top
 * or bottom of a round display lose horizontal room fast.
 *
 * Every change writes straight through to /data/settings.json -- there is no
 * save button and no cancel.
 * ==========================================================================*/

const ROW_TOP = 92
const ROW_PITCH = 88

Page({
  build() {
    this.settings = getSettings()
    this.rows = {}

    U.background()

    U.text({
      y: 30,
      h: 44,
      size: 30,
      color: COLOR.DIM,
      text: 'Settings',
    })

    const self = this

    this.numberRow(0, 'REST A (default)', 'restShort', SETTING_LIMITS.rest, function (v) {
      return v + 's'
    })
    this.numberRow(1, 'REST B (alternate)', 'restLong', SETTING_LIMITS.rest, function (v) {
      return v + 's'
    })
    this.numberRow(2, 'ZONE 2 LOW', 'zoneLow', SETTING_LIMITS.zone, function (v) {
      return v + ' bpm'
    })
    this.numberRow(3, 'ZONE 2 HIGH', 'zoneHigh', SETTING_LIMITS.zone, function (v) {
      return v + ' bpm'
    })
    this.toggleRow(4, 'REP DETECTION', 'repDetect')
    this.alertLevelRow(5)
    this.testBuzzRow(6)
    this.toggleRow(7, 'KEY DEBUG', 'keyDebug')

    U.circleButton({
      x: 140,
      y: ROW_TOP + 8 * ROW_PITCH + 8,
      w: 200,
      h: 68,
      color: COLOR.CHIP_OFF,
      textColor: COLOR.TEXT,
      size: 28,
      text: 'Back',
      onClick: function () {
        haptics.tap()
        router.back()
      },
    })
  },

  numberRow(index, caption, key, limits, format) {
    const y = ROW_TOP + index * ROW_PITCH
    const self = this

    U.text({
      y,
      h: 24,
      size: 19,
      color: COLOR.DIMMER,
      text: caption,
    })

    const valueY = y + 26

    U.circleButton({
      x: 76,
      y: valueY,
      w: 56,
      h: 56,
      color: COLOR.CHIP_OFF,
      textColor: COLOR.TEXT,
      size: 32,
      text: '-',
      onClick: function () {
        self.bump(key, -limits.step, limits, format)
      },
    })

    this.rows[key] = U.text({
      x: 142,
      y: valueY,
      w: 196,
      h: 56,
      size: 34,
      color: COLOR.TEXT,
      text: format(this.settings[key]),
    })

    U.circleButton({
      x: 348,
      y: valueY,
      w: 56,
      h: 56,
      color: COLOR.CHIP_OFF,
      textColor: COLOR.TEXT,
      size: 32,
      text: '+',
      onClick: function () {
        self.bump(key, limits.step, limits, format)
      },
    })
  },

  bump(key, delta, limits, format) {
    let next = this.settings[key] + delta
    if (next < limits.min) next = limits.min
    if (next > limits.max) next = limits.max

    // Keep the zone band coherent: low must stay below high.
    if (key === 'zoneLow' && next >= this.settings.zoneHigh) {
      next = this.settings.zoneHigh - 1
    }
    if (key === 'zoneHigh' && next <= this.settings.zoneLow) {
      next = this.settings.zoneLow + 1
    }

    if (next === this.settings[key]) return
    haptics.tap()
    this.settings = saveSettings({ [key]: next })
    this.rows[key].setProperty(U.ui.prop.TEXT, format(next))
  },

  /*
   * Alert strength. Zepp OS has no numeric vibration intensity -- only named
   * scenes -- so this cycles between three presets that differ in scene and
   * repeat count rather than sliding a dial. Tapping it also previews the
   * end-of-rest alert at the newly selected level, so you can compare without
   * leaving the row.
   */
  alertLevelRow(index) {
    const y = ROW_TOP + index * ROW_PITCH
    const self = this

    U.text({
      y,
      h: 24,
      size: 19,
      color: COLOR.DIMMER,
      text: 'ALERT STRENGTH',
    })

    const btn = U.circleButton({
      x: 130,
      y: y + 26,
      w: 220,
      h: 56,
      color: COLOR.CHIP_OFF,
      textColor: COLOR.TEXT,
      size: 26,
      text: ALERT_LEVELS[this.settings.alertLevel],
      onClick: function () {
        const next = (self.settings.alertLevel + 1) % ALERT_LEVELS.length
        self.settings = saveSettings({ alertLevel: next })
        btn.label.setProperty(U.ui.prop.TEXT, ALERT_LEVELS[next])
        // Preview immediately at the new level.
        haptics.configure(next)
        haptics.restDone()
      },
    })
  },

  /*
   * Diagnostic: fires the exact end-of-rest alert on demand.
   *
   * This exists to separate "the vibrator doesn't work" from "the rest timer
   * didn't reach zero". If this button buzzes but rest doesn't, the bug is in
   * the timer or the alarm. If this button does nothing either, it's the
   * vibrator API and the status line below tells you which part failed.
   */
  testBuzzRow(index) {
    const y = ROW_TOP + index * ROW_PITCH
    const self = this

    U.text({
      y,
      h: 24,
      size: 19,
      color: COLOR.DIMMER,
      text: 'END-OF-REST ALERT',
    })

    const status = U.text({
      y: y + 84,
      h: 22,
      size: 16,
      color: COLOR.DIMMER,
      text: '',
    })

    U.circleButton({
      x: 130,
      y: y + 26,
      w: 220,
      h: 56,
      color: COLOR.CHIP_OFF,
      textColor: COLOR.ACCENT,
      size: 28,
      text: 'TEST BUZZ',
      onClick: function () {
        haptics.configure(self.settings.alertLevel)
        const ok = haptics.restDone()
        const st = haptics.status()
        console.log(
          '[haptics] fired=' + ok +
          ' hasVibrator=' + st.hasVibrator +
          ' modeStyle=' + st.modeStyle +
          ' strongReminder=' + st.strongReminder +
          ' lastError=' + st.lastError
        )
        status.setProperty(
          U.ui.prop.TEXT,
          ok ? 'sent (' + st.modeStyle + ')' : 'FAILED - see console'
        )
      },
    })
  },

  toggleRow(index, caption, key) {
    const y = ROW_TOP + index * ROW_PITCH
    const self = this

    U.text({
      y,
      h: 24,
      size: 19,
      color: COLOR.DIMMER,
      text: caption,
    })

    const btn = U.circleButton({
      x: 130,
      y: y + 26,
      w: 220,
      h: 56,
      color: this.settings[key] ? COLOR.CHIP_ON : COLOR.CHIP_OFF,
      textColor: this.settings[key] ? 0x000000 : COLOR.TEXT,
      size: 28,
      text: this.settings[key] ? 'ON' : 'OFF',
      onClick: function () {
        haptics.tap()
        const next = !self.settings[key]
        self.settings = saveSettings({ [key]: next })
        btn.label.setProperty(U.ui.prop.TEXT, next ? 'ON' : 'OFF')
        try {
          btn.bg.setProperty(U.ui.prop.MORE, {
            color: next ? COLOR.CHIP_ON : COLOR.CHIP_OFF,
          })
          btn.label.setProperty(U.ui.prop.MORE, {
            color: next ? 0x000000 : COLOR.TEXT,
          })
        } catch (e) {}
      },
    })
  },
})
