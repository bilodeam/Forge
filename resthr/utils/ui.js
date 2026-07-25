import * as ui from '@zos/ui'
import * as display from '@zos/display'
import { COLOR, SCREEN, BRIGHT_TIME_MS, LONG_PRESS_MS } from './constants'

/*
 * Thin wrappers over @zos/ui. There is no flexbox and no layout engine here --
 * every widget is absolutely positioned. Text widgets default to full screen
 * width with centre alignment, which is the only sane default on a round
 * display: short centred strings never clip against the bezel.
 */

export function background(color) {
  return ui.createWidget(ui.widget.FILL_RECT, {
    x: 0,
    y: 0,
    w: SCREEN.W,
    h: SCREEN.H,
    color: color === undefined ? COLOR.BG : color,
  })
}

/* Remember the widget's authored Y so setVisible() has somewhere to put it
 * back if it has to fall back to parking widgets off-screen. */
function stampHome(widget, y) {
  try {
    widget.__homeY = y
  } catch (e) {}
  return widget
}

export function text(opts) {
  return stampHome(
    ui.createWidget(ui.widget.TEXT, {
      x: opts.x === undefined ? 0 : opts.x,
      y: opts.y,
      w: opts.w === undefined ? SCREEN.W : opts.w,
      h: opts.h === undefined ? 40 : opts.h,
      color: opts.color === undefined ? COLOR.TEXT : opts.color,
      text_size: opts.size === undefined ? 32 : opts.size,
      align_h: opts.align === undefined ? ui.align.CENTER_H : opts.align,
      align_v: ui.align.CENTER_V,
      text_style: ui.text_style.NONE,
      text: opts.text === undefined ? '' : opts.text,
    }),
    opts.y
  )
}

export function rect(opts) {
  return stampHome(
    ui.createWidget(ui.widget.FILL_RECT, {
      x: opts.x,
      y: opts.y,
      w: opts.w,
      h: opts.h,
      radius: opts.radius === undefined ? 0 : opts.radius,
      color: opts.color,
    }),
    opts.y
  )
}

/*
 * Arc along the screen edge.
 *
 * ANGLES: 0 degrees is the 3 o'clock direction. Zepp OS sweeps from
 * start_angle to end_angle; on this device that appears to run clockwise, but
 * it is the one thing here I could not verify without hardware. If the arcs
 * render mirrored or inside-out, flip ARC.DIR in constants.js -- that's the
 * single switch, no other maths changes.
 */
export function arc(opts) {
  return ui.createWidget(ui.widget.ARC, {
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h: opts.h,
    radius: opts.radius,
    start_angle: opts.start,
    end_angle: opts.end,
    line_width: opts.width,
    color: opts.color,
  })
}

export function setArcEnd(widget, opts) {
  if (!widget) return
  try {
    widget.setProperty(ui.prop.MORE, {
      x: opts.x,
      y: opts.y,
      w: opts.w,
      h: opts.h,
      radius: opts.radius,
      start_angle: opts.start,
      end_angle: opts.end,
      line_width: opts.width,
      color: opts.color,
    })
  } catch (e) {}
}

/* A filled circle. Built from a rounded FILL_RECT rather than widget.CIRCLE so
 * it can't depend on a widget type that may not exist on every firmware. */
export function dot(opts) {
  return rect({
    x: opts.cx - opts.r,
    y: opts.cy - opts.r,
    w: opts.r * 2,
    h: opts.r * 2,
    radius: opts.r,
    color: opts.color,
  })
}

export function moveDot(widget, cx, cy, r, color) {
  if (!widget) return
  try {
    widget.setProperty(ui.prop.MORE, {
      x: cx - r,
      y: cy - r,
      w: r * 2,
      h: r * 2,
      radius: r,
      color,
    })
  } catch (e) {}
}

export function image(opts) {
  try {
    return ui.createWidget(ui.widget.IMG, {
      x: opts.x,
      y: opts.y,
      w: opts.w,
      h: opts.h,
      src: opts.src,
      auto_scale: true,
    })
  } catch (e) {
    return null
  }
}

/* Point on a circle. Angle in degrees, 0 = 3 o'clock, positive = clockwise. */
export function pointOnCircle(cx, cy, radius, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) }
}

export function circleButton(opts) {
  const group = rect({
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h: opts.h,
    radius: opts.radius === undefined ? Math.floor(opts.h / 2) : opts.radius,
    color: opts.color,
  })
  const label = text({
    x: opts.x,
    y: opts.y,
    w: opts.w,
    h: opts.h,
    size: opts.size === undefined ? 30 : opts.size,
    color: opts.textColor === undefined ? COLOR.TEXT : opts.textColor,
    text: opts.text,
  })
  if (opts.onClick) {
    group.addEventListener(ui.event.CLICK_UP, opts.onClick)
    label.addEventListener(ui.event.CLICK_UP, opts.onClick)
  }
  return { bg: group, label }
}

/*
 * Tap / long-press handling bound across a set of existing widgets.
 *
 *   short tap   -> onTap()       (advance the state machine)
 *   hold 800ms  -> onLongPress() (end workout confirmation)
 *
 * WHY NOT A TRANSPARENT FULL-SCREEN OVERLAY: that would depend on FILL_RECT
 * honouring `alpha: 0` while still receiving touch. If a firmware ignored the
 * alpha we'd paint an opaque black rect over the entire UI -- a spectacular
 * failure mode for a one-line assumption. Binding to the background rect plus
 * the display widgets that sit on it achieves the same "tap anywhere" feel
 * with nothing to go wrong visually.
 *
 * Interactive controls (chips, +/- buttons) are deliberately NOT passed in, so
 * they keep their own handlers. Because the same physical tap can reach more
 * than one bound widget, every trigger goes through a short debounce.
 *
 * `targets` is an array of widgets; nulls are ignored so callers can splat in
 * optional widgets without filtering first.
 */
const TAP_DEBOUNCE_MS = 300

export function tapLayer(targets, onTap, onLongPress) {
  let timer = null
  let fired = false
  let lastFireAt = 0

  function accept() {
    const now = Date.now()
    if (now - lastFireAt < TAP_DEBOUNCE_MS) return false
    lastFireAt = now
    return true
  }

  function down() {
    fired = false
    if (timer) clearTimeout(timer)
    if (!onLongPress) return
    timer = setTimeout(function () {
      timer = null
      fired = true
      if (accept()) onLongPress()
    }, LONG_PRESS_MS)
  }

  function up() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (fired) {
      // Releasing after a long press must not also count as a tap.
      fired = false
      return
    }
    if (onTap && accept()) onTap()
  }

  for (let i = 0; i < targets.length; i++) {
    const w = targets[i]
    if (!w) continue
    try {
      w.addEventListener(ui.event.CLICK_DOWN, down)
      w.addEventListener(ui.event.CLICK_UP, up)
    } catch (e) {}
  }

  return {
    destroy: function () {
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}

/*
 * Hold the screen awake for the life of this page. The setting resets on page
 * destruction, so every page that should stay lit calls this in build().
 *
 * If you'd rather the watch behave normally and sleep on wrist-drop, delete
 * the setPageBrightTime call -- everything still works, you just lose live HR
 * while suspended, and the rest buzz still fires because it's alarm-backed.
 */
export function keepAwake() {
  try {
    display.setPageBrightTime({ brightTime: BRIGHT_TIME_MS })
  } catch (e) {}
  try {
    // Relaunch the Mini Program (rather than the watchface) when the screen
    // wakes, so a wrist-raise mid-rest puts you back on the timer.
    display.setWakeUpRelaunch({ relaunch: true })
  } catch (e) {}
}

export function releaseAwake() {
  try {
    display.setPageBrightTime({ brightTime: 0 })
  } catch (e) {}
  try {
    display.setWakeUpRelaunch({ relaunch: false })
  } catch (e) {}
}

/*
 * Show/hide a widget.
 *
 * prop.VISIBLE is the documented route. We test for its EXISTENCE rather than
 * relying on a try/catch, because setProperty(undefined, value) fails silently
 * on some firmware -- it wouldn't throw, so the catch would never run and both
 * layouts would end up drawn on top of each other.
 *
 * Fallback parks the widget off-screen, which is visually equivalent. Callers
 * must therefore go through here rather than setting Y directly, and each
 * widget's real Y is remembered on first hide.
 */
const HIDDEN_Y = 2000

export function setVisible(widget, visible) {
  if (!widget) return

  if (ui.prop && ui.prop.VISIBLE !== undefined) {
    try {
      widget.setProperty(ui.prop.VISIBLE, !!visible)
      return
    } catch (e) {
      /* fall through to the offscreen approach */
    }
  }

  try {
    if (visible) {
      if (widget.__homeY !== undefined) {
        widget.setProperty(ui.prop.Y, widget.__homeY)
      }
    } else {
      widget.setProperty(ui.prop.Y, HIDDEN_Y)
    }
  } catch (e) {}
}

export function setVisibleAll(widgets, visible) {
  if (!widgets) return
  for (let i = 0; i < widgets.length; i++) setVisible(widgets[i], visible)
}

/*
 * Modal confirmation drawn by hand rather than via @zos/interaction's dialog,
 * so it matches the rest of the app and we control exactly where the tap
 * targets are. Returns a handle with destroy().
 *
 * Created after everything else on the page, so it sits on top in z-order.
 * The caller must also set a "confirming" flag that makes the underlying tap
 * layer ignore input while this is open.
 */
/*
 * Full-screen action menu, used mid-workout.
 *
 * Four rows of 76px at x=90 w=300. That column survives the bezel at both the
 * top row (y=60, chord 316px) and the bottom row (y=394, chord 368px), which
 * is why the rows aren't wider.
 *
 * items: [{ text, fill, textColor, onSelect }]
 * Returns a handle with destroy().
 */
export function menuOverlay(items) {
  const parts = []

  const scrim = rect({ x: 0, y: 0, w: SCREEN.W, h: SCREEN.H, color: COLOR.BG })
  scrim.addEventListener(ui.event.CLICK_UP, function () {})
  parts.push(scrim)

  const TOP = 60
  const PITCH = 86
  const H = 76

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const btn = circleButton({
      x: 90,
      y: TOP + i * PITCH,
      w: 300,
      h: H,
      radius: 38,
      color: it.fill === undefined ? COLOR.CHIP_OFF : it.fill,
      textColor: it.textColor === undefined ? COLOR.TEXT : it.textColor,
      size: 30,
      text: it.text,
      onClick: it.onSelect,
    })
    parts.push(btn.bg, btn.label)
  }

  return {
    destroy: function () {
      for (let i = 0; i < parts.length; i++) {
        try {
          ui.deleteWidget(parts[i])
        } catch (e) {}
      }
      parts.length = 0
    },
  }
}

export function confirmOverlay(opts) {
  const parts = []

  const scrim = rect({
    x: 0,
    y: 0,
    w: SCREEN.W,
    h: SCREEN.H,
    color: COLOR.BG,
  })
  // Swallow taps that miss the buttons.
  scrim.addEventListener(ui.event.CLICK_UP, function () {})
  parts.push(scrim)

  parts.push(
    text({
      y: 128,
      h: 48,
      size: 36,
      color: COLOR.TEXT,
      text: opts.title || 'Are you sure?',
    })
  )

  const yes = circleButton({
    x: 80,
    y: 208,
    w: 320,
    h: 88,
    color: COLOR.DANGER,
    textColor: COLOR.TEXT,
    size: 32,
    text: opts.confirmText || 'END WORKOUT',
    onClick: opts.onConfirm,
  })
  parts.push(yes.bg, yes.label)

  const no = circleButton({
    x: 120,
    y: 314,
    w: 240,
    h: 76,
    color: COLOR.CHIP_OFF,
    textColor: COLOR.TEXT,
    size: 30,
    text: 'Cancel',
    onClick: opts.onCancel,
  })
  parts.push(no.bg, no.label)

  return {
    destroy: function () {
      for (let i = 0; i < parts.length; i++) {
        try {
          ui.deleteWidget(parts[i])
        } catch (e) {}
      }
      parts.length = 0
    },
  }
}

export { ui }
