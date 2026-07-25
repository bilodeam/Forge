import * as interaction from '@zos/interaction'

/* ============================================================================
 * Physical button handling.
 *
 * The Amazfit Balance has two physical keys. Zepp OS reports them through
 * @zos/interaction as numeric key constants, but WHICH constant maps to WHICH
 * physical key varies by device and firmware.
 *
 * STRATEGY: allow-list the advance key, catch-all everything else.
 *
 * The first version of this file listed specific constants for BOTH actions,
 * which meant a key reporting anything unexpected was silently dropped. Since
 * we only need to distinguish one action from another, it's far more robust to
 * name only the advance keys and treat every other key as "open the menu".
 *
 * KEY_BACK is deliberately excluded from the catch-all: hijacking back would
 * trap you in the app with no way out.
 *
 * If the firmware reserves a key entirely (the crown often is, since it's the
 * system's return-to-watchface control), we never see the event at all and no
 * amount of constant-matching helps. The hold-anywhere gesture is the
 * guaranteed path to the menu for exactly that reason.
 *
 * Note: onKey allows only ONE registration app-wide -- registering again
 * silently kills the previous handler. Hence the single module-level slot and
 * the explicit release() in every page's onDestroy.
 * ==========================================================================*/

/* Keys that advance the set/rest state machine (the lower-right button). */
const ADVANCE_KEYS = ['KEY_DOWN', 'KEY_SHORTCUT']

/* Never intercepted -- leaves the system's exit route intact. */
const PASS_THROUGH_KEYS = ['KEY_BACK']

function codesFor(names) {
  const out = []
  for (let i = 0; i < names.length; i++) {
    const v = interaction[names[i]]
    if (typeof v === 'number') out.push(v)
  }
  return out
}

/* Human-readable name for a key code, for the debug readout. */
export function keyName(code) {
  const names = [
    'KEY_UP', 'KEY_DOWN', 'KEY_SELECT', 'KEY_BACK', 'KEY_HOME',
    'KEY_SHORTCUT', 'KEY_POWER', 'KEY_APP',
  ]
  for (let i = 0; i < names.length; i++) {
    if (interaction[names[i]] === code) return names[i]
  }
  return 'KEY_' + code
}

/* Every key constant this firmware actually exposes -- useful when debugging. */
export function availableKeys() {
  const names = [
    'KEY_UP', 'KEY_DOWN', 'KEY_SELECT', 'KEY_BACK', 'KEY_HOME',
    'KEY_SHORTCUT', 'KEY_POWER', 'KEY_APP',
  ]
  const out = []
  for (let i = 0; i < names.length; i++) {
    if (typeof interaction[names[i]] === 'number') {
      out.push(names[i] + '=' + interaction[names[i]])
    }
  }
  return out.join(' ')
}

let registered = false

/*
 * handlers = { onAdvance, onEnd, onDebug }
 *
 * onDebug(name, code, event) fires for EVERY key event received, before any
 * routing, so you can see what the hardware is actually sending.
 */
export function capture(handlers) {
  const advance = codesFor(ADVANCE_KEYS)
  const passThrough = codesFor(PASS_THROUGH_KEYS)
  const CLICK = interaction.KEY_EVENT_CLICK
  const LONG = interaction.KEY_EVENT_LONG_PRESS

  try {
    interaction.onKey(function (key, keyEvent) {
      if (handlers.onDebug) {
        handlers.onDebug(keyName(key), key, keyEvent)
      }
      console.log('[keys] ' + keyName(key) + ' (' + key + ') event=' + keyEvent)

      if (keyEvent !== CLICK && keyEvent !== LONG) return false
      if (passThrough.indexOf(key) >= 0) return false

      if (advance.indexOf(key) >= 0) {
        if (handlers.onAdvance) handlers.onAdvance()
        return true
      }

      // Catch-all: any other key opens the menu. The menu is non-destructive
      // (RESUME first), so a wrong guess here costs one tap.
      if (handlers.onEnd) {
        handlers.onEnd()
        return true
      }
      return false
    })
    registered = true
  } catch (e) {
    registered = false
    console.log('[keys] onKey registration FAILED: ' + e)
  }
  return registered
}

export function release() {
  if (!registered) return
  try {
    if (interaction.offKey) interaction.offKey()
  } catch (e) {}
  registered = false
}
