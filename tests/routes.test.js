import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerDispatchRoutes } from '../routes.js'
import { createSessionResolver } from '../session-resolver.js'

test('功能設定路由拒絕跨來源的寫入', async () => {
  const handlers = new Map()
  let saved = false
  const webServer = { register: ({ path, handler }) => { handlers.set(path, handler); return () => {} } }
  const ctx = {
    inject: (_names, callback) => callback({ webServer, effect: () => {} }),
    get: () => undefined,
  }
  registerDispatchRoutes(ctx, {
    resolver: createSessionResolver({ appId: 'app' }),
    groupNames: { readGroupNames: () => ({}), writeGroupNames: () => {} },
    features: { save: async () => { saved = true }, snapshot: async () => ({ features: [] }) },
    defaultMode: 'queue',
    qqbotApi: {},
    loadOptionalPatches: () => [],
  })
  let status
  let body
  const response = { writeHead: (code) => { status = code }, end: (value) => { body = JSON.parse(value) } }
  await handlers.get('/qqbot-tool-dispatch/features')({ method: 'POST', headers: { origin: 'https://other.example', host: 'localhost:3000' } }, response)
  assert.equal(status, 403)
  assert.deepEqual(body, { error: 'forbidden' })
  assert.equal(saved, false)
})

test('側欄列出上游已映射的 session- 會話', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-dispatch-routes-'))
  const prefsPath = join(dir, 'model-prefs.json')
  writeFileSync(prefsPath, JSON.stringify({ sessionIds: { 'qqbot:app:group:openid': 'session-123' } }), 'utf8')
  const handlers = new Map()
  const webServer = { register: ({ path, handler }) => { handlers.set(path, handler); return () => {} } }
  const controller = {
    list: async () => [{ sessionId: 'session-123', cwd: process.cwd() }],
    projections: async () => ({ values: { title: '測試群' } }),
  }
  const ctx = {
    inject: (_names, callback) => callback({ webServer, effect: () => {} }),
    get: (name) => name === 'sessionController' ? controller : undefined,
  }
  registerDispatchRoutes(ctx, {
    resolver: createSessionResolver({ appId: 'app', prefsPath }),
    groupNames: { readGroupNames: () => ({}), writeGroupNames: () => {} },
    features: {}, defaultMode: 'queue', qqbotApi: {}, loadOptionalPatches: () => [],
  })
  let body
  const response = { writeHead: () => {}, end: (value) => { body = JSON.parse(value) } }
  await handlers.get('/qqbot-tool-dispatch/sessions')({ method: 'GET', headers: { host: 'localhost:3000' } }, response)
  assert.equal(body.sessions.length, 1)
  assert.equal(body.sessions[0].sessionId, 'session-123')
  assert.equal(body.sessions[0].peerId, 'openid')
})
