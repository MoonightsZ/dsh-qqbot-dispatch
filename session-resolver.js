import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const SCOPES = ['c2c', 'group']

export function sessionKey(appId, scope, peerId) {
  return `qqbot:${appId}:${scope}:${peerId}`
}

export function deriveSessionId(key) {
  const hash = createHash('sha256').update(key).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
}

export function readPrefs(prefsPath) {
  try {
    if (!existsSync(prefsPath)) return {}
    const data = JSON.parse(readFileSync(prefsPath, 'utf8'))
    return data !== null && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

export function createSessionResolver({ appId, prefsPath = resolve(homedir(), '.dsh-qqbot', 'model-prefs.json') }) {
  const resolvedAppId = () => {
    const value = appId ?? process.env.QQBOT_APPID
    if (value === undefined || value === '') {
      throw new Error('qqbot_dispatch: no QQ Bot appId — set `appId` on this plugin in the profile cordis.patch.yml, or export QQBOT_APPID')
    }
    return value
  }

  const resolveTarget = (scope, peerId) => {
    if (!SCOPES.includes(scope)) throw new Error(`scope must be one of ${SCOPES.join(' | ')}, received "${scope}"`)
    if (typeof peerId !== 'string' || peerId.trim() === '') throw new Error('peerId must be a non-empty peer openid')
    const key = sessionKey(resolvedAppId(), scope, peerId)
    const record = readPrefs(prefsPath).sessionIds?.[key]
    if (typeof record === 'string' && record !== '') return { key, sessionId: record, from: 'prefs' }
    return { key, sessionId: deriveSessionId(key), from: 'derived' }
  }

  const knownPeers = () => {
    const prefix = `qqbot:${resolvedAppId()}:`
    const rows = []
    for (const [key, sessionId] of Object.entries(readPrefs(prefsPath).sessionIds ?? {})) {
      if (!key.startsWith(prefix) || typeof sessionId !== 'string' || sessionId === '') continue
      const suffix = key.slice(prefix.length)
      const separator = suffix.indexOf(':')
      if (separator < 0) continue
      const scope = suffix.slice(0, separator)
      const peerId = suffix.slice(separator + 1)
      if (!SCOPES.includes(scope) || peerId === '') continue
      rows.push({ sessionKey: key, scope, peerId, sessionId, resolvedFrom: 'prefs' })
    }
    return rows
  }

  return { resolvedAppId, resolveTarget, knownPeers, prefsPath }
}
