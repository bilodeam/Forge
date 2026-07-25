/* ============================================================================
 * Five-band heart-rate model, shared by the cardio screen and the recap.
 *
 * READ THIS BEFORE TRUSTING ZONES 1, 3, 4 AND 5.
 *
 * The only heart-rate numbers the app has are your zone 2 bounds. The other
 * four bands are EXTRAPOLATED by repeating the width of zone 2 above and below
 * it -- with 120-135 that yields 105-120, 135-150, 150-165, 165-180.
 *
 * That is a display convention, not physiology. Every alert in the app is
 * driven purely by zoneLow and zoneHigh; nothing consults the derived bands
 * except the visualisation. Do not read zone 5 here as a real threshold.
 *
 * If you ever get properly tested boundaries, replace deriveZones() with them
 * and everything downstream follows.
 * ==========================================================================*/

/* Returns 6 boundaries: [z1lo, z2lo, z2hi, z3hi, z4hi, z5hi]. */
export function deriveZones(low, high) {
  const w = Math.max(5, high - low)
  return [low - w, low, high, high + w, high + 2 * w, high + 3 * w]
}

/* Which band contains `value`. -1 means below zone 1; 4 caps at zone 5. */
export function zoneIndexFor(bounds, value) {
  if (!value || value < bounds[0]) return -1
  for (let i = 0; i < 5; i++) {
    if (value >= bounds[i] && value < bounds[i + 1]) return i
  }
  return 4
}
