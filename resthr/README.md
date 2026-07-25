# RestHR

A Zepp OS Mini Program for the **Amazfit Balance**: a strength rest timer with
auto rep counting and live heart rate, plus a zone-2 cardio mode that buzzes
you when you drift out of the band.

Device App only — no Side Service, no phone-app settings page.

---

## Screen size correction

The Balance is **480 × 480**, not 466 × 466 (466 is the GTR 4). Every
coordinate in this project assumes 480, and `designWidth` in `app.json` is set
to match. If you port this to another watch, the layout constants in
`utils/constants.js` are the first thing to revisit.

---

## Toolchain

```bash
# One-time (needs Node.js 16+ installed first: https://nodejs.org)
npm install -g @zeppos/zeus-cli
zeus --version

# Then, inside this folder, pull the type definitions for editor autocomplete
cd resthr
npm install
```

You also need, on the phone side:

- A **Zepp developer account** (the same login you use for `zeus login`)
- Phone and this computer on the **same network**
- **Developer Mode** enabled — see below, it's hidden

### Enabling Developer Mode (it's an easter egg)

It is NOT in the device settings. In the Zepp app:

**Profile → Settings → About → tap the Zepp logo 7 times.**

A popup confirms it. Until you do this, the QR scanner simply does not exist
anywhere in the app, which makes it look like you're in the wrong menu.

Then, to install a preview build:

**Your device → Mini Program → `+` (top right) → Scan** → point at the QR code
printed by `zeus preview`.

## Running it

On Windows use **Command Prompt (cmd)**, not PowerShell — PowerShell blocks
npm's script wrapper by default.

```bash
cd resthr

# 1. Log in (once). Follow the prompt.
zeus login

# 2. Check state at any time: login status + simulator connection.
zeus status

# 3. On-watch preview. Prints a QR code in the terminal -- scan it with the
#    QR scanner inside the Zepp app. This is the only way to test HR, the
#    accelerometer, vibration and the physical buttons for real.
zeus preview

# 4. Release build (produces a .zab in dist/)
zeus build
```

`zeus preview` keeps a console attached — `console.log` output from the watch
shows up in your terminal, which is how you'll do the button-mapping check
below.

### About the simulator

`zeus dev` does **not** ship a simulator. It connects to the separate Zepp OS
Simulator application over a host/port, and will sit there prompting for a host
if that app isn't installed and running. Since the simulator can't produce real
heart rate, accelerometer or button data, `zeus preview` on the actual watch is
the more useful loop — skip `zeus dev` unless you're doing pure layout work and
have installed the simulator separately.

---

## TEST CHECKLIST — work through this at the gym

Nothing below has been confirmed on hardware. Tick them off in order; each one
tells you something the next depends on.

Before you start: **Settings → KEY DEBUG → ON**.

| # | Test | What you're looking for | If it fails |
|---|---|---|---|
| 1 | Settings → **TEST BUZZ** | Any vibration at all | Read the line under the button and the `[haptics]` line in the terminal. Tells us vibrator vs timer. |
| 2 | Settings → **ALERT STRENGTH**, cycle it | Three clearly different intensities | If all identical, the firmware ignores scene selection |
| 3 | Press the **lower-right button** on the set screen | Advances to rest | — |
| 4 | Press the **crown**, watch the amber readout at the bottom | A key name and code appears | **Nothing appears = the crown is reserved and cannot be intercepted.** Stop trying; tell me and I'll move the menu to a gesture we own |
| 5 | **Hold anywhere** ~1s on the set screen | Menu opens: RESUME / CARDIO / FINISH / SETTINGS | This is the fallback path — it must work |
| 6 | Look at the **edge arcs** during a set | Left teal arc grows from 10 o'clock downward; right pink arc tracks HR | If mirrored or filled backwards, flip `ARC.DIR` to `-1` in `utils/constants.js` |
| 7 | Do a set of **10 slow curls** | Rep count lands near 10 | Tune the `REP` block — see the rep detection section below |
| 8 | Let a rest **run to zero** with the screen on | One firm buzz, then red overtime counting up | — |
| 9 | Start a rest, **cover the screen** until it sleeps, wait it out | Buzz still fires (this is the `@zos/alarm` path) | Check the `alarmId` in the terminal — `0` means the system refused the timer |
| 10 | During rest, wait **30s+** without advancing | Recovery data is being captured (shows up in the recap) | Needs HR to be reading; check the HR number isn't `--` |
| 11 | Menu → **CARDIO** mid-workout | Switches without ending; your sets are preserved | — |
| 12 | Menu → **FINISH** | Recap: glance screen, then scroll for RECOVERY / STRENGTH / FATIGUE / CARDIO / HEART RATE | — |
| 13 | Check the recap's **CALORIES** and **PAI** | Real numbers, not `--` | `--` means a permission was declined at install |
| 14 | Press the **crown mid-workout**, reopen the app | Offered RESUME with your sets intact | — |

Also worth noting during the session: whether your heart rate actually sits
inside 120–135 at conversational effort. Those bounds are still inferred from
the interview, not measured.

## First things to verify on the actual watch

These three can't be validated in the simulator and are the most likely places
you'll need to adjust something.

### 1. Which physical button is which

Open `utils/keys.js`, set `DEBUG_KEYS = true`, run `zeus preview`, then press
each button and read the terminal. You'll get lines like `[keys] key=2 event=1`.
Map those numbers to the constant arrays at the top of the file.

Expected outcome: the **lower-right** button reports as `KEY_DOWN` or
`KEY_SHORTCUT` and works. The **upper-right crown** is reserved by the system
and probably won't reach us at all — pressing it will exit to the watchface.

That's fine, and it's why the app is designed around the touchscreen instead:

- **short tap anywhere** → end set / end rest
- **hold anywhere for 800ms** → end workout (with a confirm)

If the crown does exit the app mid-workout, nothing is lost — the session is
persisted to disk and you'll be offered **RESUME** the next time you open it.

### 2. Rep detection

All tuning lives in the `REP` block of `utils/constants.js`, commented
individually. Method: do a set of 10 slow, deliberate curls, then a set of 10
fast ones, and compare against the displayed count.

- **Under-counting** → lower `MIN_THRESHOLD`, then lower `ADAPTIVE_GAIN`
- **Over-counting / phantom reps** → raise `MIN_THRESHOLD` first
- **Fast reps being missed** → raise `REFRACTORY_MS`'s tolerance by lowering it,
  or switch `FREQ_MODE_NORMAL` to `FREQ_MODE_HIGH` in `utils/rep-detector.js`
  (costs battery)

Change one constant at a time. Expect it to be decent on curls, presses, rows
and pulldowns, and poor on short-range or slow grinding movements. The count is
correctable with the −/+ buttons during rest, and can be switched off entirely
in Settings.

### 3. Zone alert feel

`ZONE` in `utils/constants.js`:

- `BREACH_MS` (10s) — how long you must be out of the band before it buzzes
- `COOLDOWN_MS` (30s) — minimum gap between buzzes
- `GRACE_MS` (45s) — silence at the start while your HR climbs

If it feels twitchy, raise `BREACH_MS`. If it nags, raise `COOLDOWN_MS`.

Patterns are directional so you don't have to look:
**three short taps = too high**, **two long buzzes = too low**.

---

## Heart rate zone

Defaults to **120–135 bpm**, editable on the watch in Settings.

135 is your stated zone-2 ceiling, not a measured max HR. If you ever do a
proper max test, or get a lactate/ventilatory threshold number, come back and
adjust the bounds — everything the cardio mode does keys off these two values.

---

## What happens when the screen goes off

Mini Programs get suspended. `setTimeout` and `setInterval` stop. This project
is built around that instead of pretending otherwise:

- **Every duration is derived from `Date.now()`**, never accumulated from
  ticks. Elapsed time is always correct on resume, no matter how long you were
  away.
- **The end-of-rest buzz is backed by `@zos/alarm`** (`utils/rest-alarm.js`),
  a system-level timer that wakes the app. It fires with the screen off. The
  alarm is cancelled whenever rest ends any other way, so it can't go off
  mid-set.
- **The screen is held awake** during an active session via `setPageBrightTime`.
  If you'd rather it behave normally, delete the call in `ui.keepAwake()`.
- **HR and accelerometer sampling stop** while suspended. There'll be a gap in
  the average HR, and reps during that window aren't counted. Accepted.
- **Session state is written to disk** every 5 seconds and on every transition,
  so a crash, reboot or accidental crown press doesn't lose the workout.

Battery: an hour of screen-on plus continuous HR is a few percent on a Balance.
The accelerometer is the other meaningful cost, which is why it runs during
sets only and is stopped during rest.

---

## Settings

On the watch, scroll the Settings page:

| Setting | Notes |
|---|---|
| REST A / REST B | The two presets on the rest screen. A is the default. |
| ZONE 2 LOW / HIGH | Drives every heart-rate alert. Low is clamped below high. |
| REP DETECTION | Master switch for accelerometer rep counting. Off shows `-`. |
| ALERT STRENGTH | LIGHT / MEDIUM / STRONG. Tapping previews at the new level. |
| TEST BUZZ | Fires the exact end-of-rest alert on demand. Diagnostic. |
| KEY DEBUG | Shows a live readout of physical key events on the set screen. |

### Alert strength

Zepp OS exposes vibration as named *scenes*, not a numeric intensity, so the
three levels differ by scene and repeat count rather than by a dial:

- **LIGHT** — two short taps
- **MEDIUM** — one strong-reminder burst (four pulses over 1.2s)
- **STRONG** — that burst twice (default)

Applies to the end-of-rest alert and both zone alerts.

### When the app vibrates

Vibration means *"look at me"*, not *"I registered your tap"*. It fires only
for things you need to notice while **not** looking at the watch, plus one
destructive action:

- end of rest, and both zone alerts
- rest-length chips (you change these mid-set with sweaty hands)
- Discard, on the resume screen

It deliberately does **not** fire for: starting a workout, advancing set→rest,
correcting a rep count, or resuming. In each of those the screen changes
visibly and you're already looking at it.

## What the recap shows

One glance screen, then scroll for detail.

**Recovery** — how far your heart rate falls in the first 30 or 60 seconds
after a set. A real conditioning marker, and one this app is unusually placed
to measure because it knows exactly when each set ended. Prefers the 60s figure
and falls back to 30s when your rests are too short. `EARLY -23 -> LATE -15`
means recovery decayed as you tired. Caveats: wrist optical HR lags 10-20s, and
sampling stops if the screen sleeps, so some sets simply have no reading — those
are skipped, not guessed, and the count is shown.

**Density** — work as a share of lifting time. The number that says whether the
session was brisk or leisurely, and the reason WORK and REST are split.

**Heart rate** — ONE section for the whole workout, lifting and cardio
together, with a five-band chart. Bars scale to the largest band rather than to
total time, because scaling to total squashes everything left on exactly the
sessions where you want to see the shape. Absolute values live in the time
column.

**Calories** — a DELTA of the daily counter, not a measurement of this workout.
There is no per-session calorie API. Anything else you did in the window counts,
and it will disagree with the native workout app's estimate.

**PAI** — today's total, deliberately *not* deltaed. The watch recomputes PAI on
its own lazy schedule, so a session delta would usually read 0 and look broken.

### The five zones are mostly extrapolated

Only zone 2 comes from numbers you supplied. Zones 1, 3, 4 and 5 are derived by
repeating the width of zone 2 above and below it (120-135 gives 105-120,
135-150, 150-165, 165-180). That is a display convention, not physiology —
nothing in the app consults them except the chart. Every alert uses `zoneLow`
and `zoneHigh` only. Replace `deriveZones()` in `utils/zones.js` if you ever get
tested boundaries.

## Launching from the watchface

To put RestHR on the lower button instead of the default workout app:
**watch → Settings → Preferences → Press Lower Button → RestHR.**
`Long Press Upper Button` is a second assignable slot.

This only applies from the watchface. Once RestHR is open the lower button
belongs to the app and advances your sets.

## Zepp workout history

This app **does not write to your Zepp workout log**. A Mini Program can't. No
calories, no training load, no HR graph in the phone app afterwards.

If you want that record, start a normal workout in the native app first, then
open RestHR on top. The native recording keeps running underneath and you get
both.

---

## Project layout

```
resthr/
├── app.json                  permissions, target/shape, page list
├── package.json              name + @zeppos/device-types for editor hints
├── jsconfig.json             enables Zepp OS API autocomplete
├── app.js                    entry point, restores session on launch
├── assets/balance.r/icon.png   248x248, .r = round shape target
├── assets/balance/icon.png     duplicate, covers the other naming convention
├── page/
│   ├── index.js              mode select + resume-session recovery
│   ├── strength.js           SET ⇄ REST loop (both layouts, one page)
│   ├── cardio.js             single timer + zone-2 policing
│   ├── summary.js            post-workout card
│   └── settings.js           rest presets, zone bounds, rep toggle
└── utils/
    ├── constants.js          ← ALL TUNABLE VALUES LIVE HERE
    ├── session.js            workout state, timestamp-derived durations
    ├── store.js              JSON persistence over @zos/fs
    ├── hr.js                 heart rate listener lifecycle
    ├── rep-detector.js       accelerometer rep counting
    ├── rest-alarm.js         @zos/alarm wrapper for the rest buzz
    ├── haptics.js            vibration patterns
    ├── keys.js               physical button capture (best-effort)
    ├── ui.js                 widget helpers, tap layer, confirm overlay
    └── format.js             time/number formatting
```

### In-workout menu

Opened by the **upper-right key** (if the firmware lets a Mini Program have it)
or by **holding anywhere** on screen. Four items: RESUME, CARDIO/STRENGTH,
FINISH, SETTINGS.

RESUME is first and highlighted so an accidental open is harmless. Because the
menu is non-destructive, the upper key no longer needs a long press, and FINISH
has no second confirmation — choosing it from a menu is already deliberate.

Switching mode does **not** end the workout. Lifting and cardio accumulate in
one session and produce one recap; `switchMode()` banks any set in progress
first, provided it lasted more than 5 seconds.

### Resuming an interrupted workout

Resumability is judged on **time since the session was last written**
(`RESUME_WINDOW_MS`, 20 minutes), not time since it started. Leaving via the
crown exits without ending the workout, so sessions are routinely abandoned
rather than finished — gating on start time meant a workout from hours earlier
still looked live and demanded a discard on every launch. Anything untouched
for longer is cleared silently.

### Pages do not share memory

**Every page runs in its own JavaScript context.** Pages are bundled
separately, so each one gets a private copy of every module it imports.
Module-level state does not survive a `router.replace()`.

`/data/session.json` is the source of truth between pages, not the `s` object
inside `session.js`. Every page calls `session.ensureLoaded()` at the top of
`build()` before touching state.

If you forget, the symptom is distinctive: the page reads `startedAt === 0`,
hits its "no session" guard, bounces back to the mode picker, and you get an
infinite flash loop between two screens.

As a second line of defence, the mode picker also passes `start=1&rest=NN` as a
launch param, and `session.beginFromParams()` will start a workout from that if
storage ever fails. A failed disk write should degrade, not trap you.

### The one rule for adding sensors

Every `onCurrentChange` / `onChange` registration must have a matching
un-registration in the page's `onDestroy`. A leaked listener keeps sampling
after the page is gone and will visibly cost battery. `utils/hr.js` shows the
pattern.

---

## Device targeting

`app.json` targets by **screen shape**, which is what the Zeus CLI's own v3
templates do:

```json
"platforms": [{ "st": "r" }],
"designWidth": 480
```

`st: "r"` means "round", and `designWidth: 480` matches the Balance exactly.
Coordinates scale proportionally on other round watches, so this also happens
to be portable.

The alternative is pinning to specific `deviceSource` IDs. The Balance's are
**8519937** and **8519939** (global) and **8519936** (mainland China), from
[Zepp's device list](https://docs.zepp.com/docs/reference/related-resources/device-list/).
Only reach for that if you specifically want to stop the app installing on
other watches — shape targeting is the better default and is what the
toolchain generates.

### Icon paths

`"icon": "icon.png"` in app.json resolves relative to the target's asset
directory, and the directory name depends on how you target devices:

| Targeting style | Asset directory |
|---|---|
| `platforms: [{ "st": "r" }]` | `assets/<target>.r/` |
| `platforms: [{ deviceSource }]` | `assets/<target>/` |

Since this project uses shape targeting, the real path is
`assets/balance.r/icon.png`. A copy is kept at `assets/balance/icon.png` so
that switching back to deviceSource targeting doesn't break the build. Size is
248×248 RGBA, matching Zeus's own os3.0 template.

If you ever see *"The icon in app.json is empty or the image does not exist"*,
this table is the thing to check.

## Known-unverified

Everything here is statically verified (all six entry points bundle cleanly,
all imports resolve) but **has not been run through a real `zeus build`** —
that needs network access to Zepp's device manifest CDN. Expect the first
`zeus build` to be where any remaining config issue surfaces; the JS itself is
clean.

---

## The biggest missing feature: history

`session.discard()` runs the moment you tap to finish the recap. Only
`settings.json` and the in-progress `session.json` are ever written — **there is
no history file.**

That means the most interesting numbers in the app are thrown away. Recovery is
only meaningful as a trend: -19 today tells you nothing, -19 today against -14
six weeks ago tells you your conditioning improved. Same for density, avg rest
against target, and the fatigue curve.

Roughly what it needs:

1. `utils/history.js` — append a compact record per session to `history.json`,
   capped at ~60 entries (date, mode, total, sets, reps, density, avg recovery,
   avg/max HR, zone times). The recap already computes every one of these.
2. `page/history.js` — a list of recent sessions, and a simple plot of recovery
   and density over time.
3. An entry point on the mode picker.

This is the difference between a rest timer and a training log.

## Not in v1

Exercise names · weights · per-exercise rest · planned set/rep targets ·
HR-driven rest length · circuits, supersets, EMOM, intervals · cardio laps or
splits · HR zones other than zone 2 · sound alerts · workout history or export ·
GPS · phone-app settings.
