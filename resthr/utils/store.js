import * as fs from '@zos/fs'
import { DEFAULT_SETTINGS } from './constants'

/*
 * Tiny JSON-file key/value store over @zos/fs.
 *
 * We use @zos/fs rather than @zos/storage because readFileSync/writeFileSync
 * against the Mini Program's private /data directory is stable across the
 * whole 2.0+ API range and needs no extra permission.
 */

function readJson(path, fallback) {
  try {
    const raw = fs.readFileSync({ path, options: { encoding: 'utf8' } })
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return fallback
    return parsed
  } catch (e) {
    return fallback
  }
}

function writeJson(path, obj) {
  try {
    fs.writeFileSync({
      path,
      data: JSON.stringify(obj),
      options: { encoding: 'utf8' },
    })
    return true
  } catch (e) {
    return false
  }
}

const SETTINGS_PATH = 'settings.json'
const SESSION_PATH = 'session.json'

let settingsCache = null

export function getSettings() {
  if (settingsCache) return settingsCache
  const stored = readJson(SETTINGS_PATH, {})
  // Merge over defaults so adding a new setting in a future version doesn't
  // wipe the user's existing config or read as undefined.
  settingsCache = Object.assign({}, DEFAULT_SETTINGS, stored)
  return settingsCache
}

export function saveSettings(patch) {
  const next = Object.assign({}, getSettings(), patch || {})
  settingsCache = next
  writeJson(SETTINGS_PATH, next)
  return next
}

export function readSession() {
  return readJson(SESSION_PATH, null)
}

export function writeSession(obj) {
  return writeJson(SESSION_PATH, obj)
}

export function clearSession() {
  return writeJson(SESSION_PATH, null)
}
