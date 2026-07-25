/* Small formatting helpers. All inputs are milliseconds unless noted. */

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

/* 0:47 / 12:03 / 1:04:22 -- drops the hour component until it's needed */
export function clock(ms) {
  if (!ms || ms < 0) ms = 0
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s)
  return m + ':' + pad2(s)
}

/* Always mm:ss, used for countdowns where a jumping width looks bad */
export function mmss(ms) {
  if (!ms || ms < 0) ms = 0
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m + ':' + pad2(s)
}

export function pct(part, whole) {
  if (!whole) return '0%'
  return Math.round((part / whole) * 100) + '%'
}

export function bpm(value) {
  return value && value > 0 ? String(Math.round(value)) : '--'
}
