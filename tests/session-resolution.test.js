import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createSessionResolver } from '../session-resolver.js'

const appId = 'app-123'
const key = 'qqbot:app-123:group:group-456'

test('未記錄的 peer 使用與 qqbot 相同的衍生 session ID', () => {
  const resolver = createSessionResolver({ appId, prefsPath: join(tmpdir(), 'missing-qqbot-prefs.json') })
  const hash = createHash('sha256').update(key).digest('hex')
  const expected = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
  assert.deepEqual(resolver.resolveTarget('group', 'group-456'), { key, sessionId: expected, from: 'derived' })
})

test('已記錄的 peer 優先使用 prefs 中的 session ID', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-dispatch-'))
  const prefsPath = join(dir, 'model-prefs.json')
  writeFileSync(prefsPath, JSON.stringify({ sessionIds: { [key]: 'custom-session' } }), 'utf8')
  const resolver = createSessionResolver({ appId, prefsPath })
  assert.equal(resolver.resolveTarget('group', 'group-456').sessionId, 'custom-session')
  assert.deepEqual(resolver.knownPeers(), [{ sessionKey: key, scope: 'group', peerId: 'group-456', sessionId: 'custom-session', resolvedFrom: 'prefs' }])
})

test('拒絕錯誤的 scope 與空 peer ID', () => {
  const resolver = createSessionResolver({ appId })
  assert.throws(() => resolver.resolveTarget('channel', 'x'), /scope must be/)
  assert.throws(() => resolver.resolveTarget('group', ' '), /peerId must be/)
})

test('已知 QQ peer 只接受群聊與私聊映射', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-dispatch-scopes-'))
  const prefsPath = join(dir, 'model-prefs.json')
  writeFileSync(prefsPath, JSON.stringify({ sessionIds: {
    'qqbot:app-123:group:group-456': 'session-group',
    'qqbot:app-123:channel:other': 'session-other',
    'qqbot:app-123:group:': 'session-empty',
  } }), 'utf8')
  assert.deepEqual(createSessionResolver({ appId, prefsPath }).knownPeers().map((peer) => peer.sessionId), ['session-group'])
})
