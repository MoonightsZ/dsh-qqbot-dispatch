/**
 * Read the QQ Bot credentials the `@tencent-connect/dsh-qqbot` plugin already
 * has, then call the official v2 group APIs with them.
 *
 * The credentials are never copied into this plugin's own config: the profile
 * patch that configures `im-qqbot` is parsed with the host's own patch loader,
 * so the bot keeps one source of truth for its appId/appSecret.
 *
 * @module dsh-tool-qqbot-dispatch/qqbot-creds
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const TOKEN_URL = 'https://api.bot.qq.com/app/getAppAccessToken'
const API_BASE = 'https://api.bot.qq.com'
const TOKEN_MARGIN_MS = 60_000

let cachedToken = { token: '', appId: '', expiresAt: 0 }

function collectRows(patches, id, found = []) {
  if (!Array.isArray(patches)) return found
  for (const row of patches) {
    if (row === null || typeof row !== 'object') continue
    if (row.id === id) found.push(row)
    for (const key of ['insert', 'config']) if (Array.isArray(row[key])) collectRows(row[key], id, found)
  }
  return found
}

/** Candidate profile patch files, active profile first, then every other profile, then the home layer. */
function patchFiles() {
  const files = []
  const profileDir = process.env.DSH_PROFILE_DIR
  const home = process.env.DSH_HOME ?? ''
  const name = process.env.DSH_PROFILE ?? ''
  if (typeof profileDir === 'string' && profileDir !== '') files.push(join(profileDir, 'cordis.patch.yml'))
  if (home !== '') {
    if (name !== '') files.push(join(home, 'profiles', name, 'cordis.patch.yml'))
    try {
      for (const entry of readdirSync(join(home, 'profiles'))) {
        const file = join(home, 'profiles', entry, 'cordis.patch.yml')
        if (!files.includes(file)) files.push(file)
      }
    } catch {
      /* no profiles tree */
    }
    files.push(join(home, 'cordis.patch.yml'))
  }
  return files
}

/**
 * Resolve the QQ Bot appId/appSecret from the profile's `im-qqbot` row.
 * @param loader - the host patch loader (`loadOptionalPatches`), injected so this module stays dependency-free.
 * @returns the credentials and where they came from, or undefined.
 */
export async function readQqbotCredentials(loader) {
  for (const file of patchFiles()) {
    try {
      if (!existsSync(file)) continue
      const patches = await loader('dsh', file)
      for (const row of collectRows(patches, 'im-qqbot')) {
        const appId = row.config?.appId
        const appSecret = row.config?.appSecret
        if (typeof appId === 'string' && appId !== '' && typeof appSecret === 'string' && appSecret !== '') {
          return { appId, appSecret, source: file }
        }
      }
    } catch {
      /* try the next layer */
    }
  }
  const appId = process.env.QQBOT_APPID
  const appSecret = process.env.QQBOT_SECRET
  if (typeof appId === 'string' && appId !== '' && typeof appSecret === 'string' && appSecret !== '') {
    return { appId, appSecret, source: 'env' }
  }
  return undefined
}

/** Why the credential lookup found nothing — diagnostics for the settings page. */
export async function describeCredentialLookup(loader) {
  const report = {
    profileDir: process.env.DSH_PROFILE_DIR ?? null,
    profileName: process.env.DSH_PROFILE ?? null,
    home: process.env.DSH_HOME ?? null,
    files: [],
  }
  for (const file of patchFiles()) {
    const entry = { file, exists: existsSync(file) }
    try {
      const patches = await loader('dsh', file)
      entry.patchRows = Array.isArray(patches) ? patches.length : null
      entry.imQqbotRows = collectRows(patches, 'im-qqbot').map((row) => ({
        id: row.id,
        hasConfig: row.config !== undefined && row.config !== null,
        configKeys: row.config !== null && typeof row.config === 'object' ? Object.keys(row.config) : [],
      }))
    } catch (error) {
      entry.error = String(error?.message ?? error)
    }
    report.files.push(entry)
  }
  return report
}

/** One access token per bot, refreshed shortly before it expires. */
export async function accessToken(credentials) {
  const now = Date.now()
  if (cachedToken.token !== '' && cachedToken.appId === credentials.appId && now < cachedToken.expiresAt - TOKEN_MARGIN_MS) {
    return cachedToken.token
  }
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appId: credentials.appId, clientSecret: credentials.appSecret }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || typeof data.access_token !== 'string' || data.access_token === '') {
    throw new Error(`获取 access_token 失败：${data.message ?? `HTTP ${response.status}`}`)
  }
  const ttl = Number(data.expires_in ?? 7200) * 1000
  cachedToken = { token: data.access_token, appId: credentials.appId, expiresAt: now + ttl }
  return cachedToken.token
}

async function botGet(path, credentials) {
  const token = await accessToken(credentials)
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `QQBot ${token}` },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message ?? `HTTP ${response.status}`)
    error.code = data.code
    throw error
  }
  return data
}

/** `GET /v2/groups/{group_openid}/info`. */
export function groupInfo(groupOpenid, credentials) {
  return botGet(`/v2/groups/${encodeURIComponent(groupOpenid)}/info`, credentials)
}

/** `POST /v2/groups/{group_openid}/messages` with plain text (msg_type 0). */
export async function sendGroupText(groupOpenid, content, credentials) {
  const token = await accessToken(credentials)
  const response = await fetch(`${API_BASE}/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, {
    method: 'POST',
    headers: { authorization: `QQBot ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ msg_type: 0, content }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message ?? `HTTP ${response.status}`)
    error.code = data.code
    throw error
  }
  return data
}

/** `POST /v2/groups/{group_openid}/messages` with a 图文卡片 (msg_type 8, type=tuwen). */
export async function sendGroupCard(groupOpenid, card, credentials) {
  const token = await accessToken(credentials)
  const response = await fetch(`${API_BASE}/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, {
    method: 'POST',
    headers: { authorization: `QQBot ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ msg_type: 8, card }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message ?? `HTTP ${response.status}`)
    error.code = data.code
    throw error
  }
  return data
}

/** `POST /v2/groups/{group_openid}/messages` with a Markdown body (msg_type 2). */
export async function sendGroupMarkdown(groupOpenid, content, credentials) {
  const token = await accessToken(credentials)
  const response = await fetch(`${API_BASE}/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, {
    method: 'POST',
    headers: { authorization: `QQBot ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ msg_type: 2, markdown: { content } }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message ?? `HTTP ${response.status}`)
    error.code = data.code
    throw error
  }
  return data
}

/** `GET /v2/groups/{group_openid}/members` — needs the platform whitelist. */
export function groupMembers(groupOpenid, credentials, cursor = '') {
  const query = cursor === '' ? '' : `?cursor=${encodeURIComponent(cursor)}`
  return botGet(`/v2/groups/${encodeURIComponent(groupOpenid)}/members${query}`, credentials)
}
