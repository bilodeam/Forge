/*
 * Home posture routines for rounded shoulders.
 * No band required. Foam roller used for thoracic work.
 *
 * kind:
 *   'reps'  -- do the prescription, tap to advance
 *   'timed' -- countdown in seconds, tap skips / completes early
 */

export const ROUTINES = {
  A: {
    id: 'A',
    name: 'Open & Lift',
    blurb: 'Chest open · lower traps',
    steps: [
      {
        name: 'Foam roller T-spine',
        kind: 'reps',
        rx: '2 × 8',
        cue: 'Slow arches, support head',
      },
      {
        name: 'Doorway pec stretch',
        kind: 'timed',
        seconds: 90,
        cue: '30s low · mid · high',
      },
      {
        name: 'Floor angels',
        kind: 'reps',
        rx: '2 × 8',
        cue: 'Keep contact with floor',
      },
      {
        name: 'Prone Y raises',
        kind: 'reps',
        rx: '3 × 10–12',
        cue: 'Thumbs up, tiny lift',
      },
      {
        name: 'Prone T raises',
        kind: 'reps',
        rx: '3 × 10–12',
        cue: 'Arms out, squeeze mid-back',
      },
      {
        name: 'Wall slides',
        kind: 'reps',
        rx: '2 × 10–12',
        cue: 'Ribs down, stay on wall',
      },
      {
        name: 'Chin tucks',
        kind: 'reps',
        rx: '3 × 8',
        cue: '5s hold each · tall neck',
      },
      {
        name: 'Blade squeeze hold',
        kind: 'timed',
        seconds: 40,
        cue: 'Pinch blades 2 × 20s',
      },
      {
        name: 'Foam roller close',
        kind: 'reps',
        rx: '6 arches',
        cue: 'Easy range to finish',
      },
      {
        name: 'Front delt stretch',
        kind: 'timed',
        seconds: 60,
        cue: '30s each side',
      },
    ],
  },
  B: {
    id: 'B',
    name: 'Control & Reset',
    blurb: 'Scap control · lat length',
    steps: [
      {
        name: 'Foam roller roll',
        kind: 'timed',
        seconds: 40,
        cue: 'Mid-back only, slow',
      },
      {
        name: 'Foam roller T-spine',
        kind: 'reps',
        rx: '8 arches',
        cue: 'Support head',
      },
      {
        name: 'Thread the needle',
        kind: 'reps',
        rx: '6 / side',
        cue: 'Slow rotate under arm',
      },
      {
        name: 'Doorway pec stretch',
        kind: 'timed',
        seconds: 60,
        cue: '30s mid · high',
      },
      {
        name: 'Prone W raises',
        kind: 'reps',
        rx: '3 × 10–12',
        cue: 'Hands by ribs, blades down',
      },
      {
        name: 'Bent-over T raises',
        kind: 'reps',
        rx: '3 × 12',
        cue: 'Hinge, lift to T',
      },
      {
        name: 'Wall slides',
        kind: 'reps',
        rx: '3 × 8–10',
        cue: 'Slow control',
      },
      {
        name: 'Kneeling lat stretch',
        kind: 'timed',
        seconds: 90,
        cue: 'Hands on couch · sink chest',
      },
      {
        name: 'Chin tucks',
        kind: 'reps',
        rx: '3 × 6',
        cue: '8s hold each',
      },
      {
        name: 'Front delt stretch',
        kind: 'timed',
        seconds: 60,
        cue: '30s each side',
      },
    ],
  },
}

export function getRoutine(id) {
  return ROUTINES[id] || null
}
