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

test('側欄只列出上游已映射的 QQ 會話，即使工作目錄不同', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-dispatch-routes-'))
  const prefsPath = join(dir, 'model-prefs.json')
  writeFileSync(prefsPath, JSON.stringify({ sessionIds: { 'qqbot:app:group:openid': 'session-123' } }), 'utf8')
  const handlers = new Map()
  const webServer = { register: ({ path, handler }) => { handlers.set(path, handler); return () => {} } }
  let titleReads = 0
  const controller = {
    list: async () => [
      { sessionId: 'session-123', cwd: join(dir, 'qqbot-workspace') },
      { sessionId: 'legacy-other', cwd: process.cwd() },
    ],
    projections: async () => { titleReads += 1; return { values: { title: '測試群' } } },
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
  assert.equal(body.sessions[0].groupOpenid, 'openid')
  await handlers.get('/qqbot-tool-dispatch/sessions')({ method: 'GET', headers: { host: 'localhost:3000' } }, response)
  assert.equal(titleReads, 1)
})

test('同步群名優先使用上游當前的會話映射', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-dispatch-titles-'))
  const prefsPath = join(dir, 'model-prefs.json')
  writeFileSync(prefsPath, JSON.stringify({ sessionIds: { 'qqbot:app:group:openid': 'session-new' } }), 'utf8')
  const handlers = new Map()
  const renamed = []
  const learned = { openid: { sessionId: 'session-old', name: '旧群名' } }
  const ctx = {
    inject: (_names, callback) => callback({ webServer: { register: ({ path, handler }) => { handlers.set(path, handler); return () => {} } }, effect: () => {} }),
    get: (name) => name === 'sessionController' ? {
      projections: async () => ({ values: { title: '旧标题' } }),
      rename: async (value) => { renamed.push(value) },
    } : undefined,
  }
  registerDispatchRoutes(ctx, {
    resolver: createSessionResolver({ appId: 'app', prefsPath }),
    groupNames: { readGroupNames: () => learned, writeGroupNames: () => {} },
    features: {}, defaultMode: 'queue',
    qqbotApi: { readQqbotCredentials: async () => ({ appId: 'app' }), groupInfo: async () => ({ group_name: '新群名' }) },
    loadOptionalPatches: () => [],
  })
  let body
  await handlers.get('/qqbot-tool-dispatch/titles/refresh')(
    { method: 'POST', headers: { host: 'localhost:3000' } },
    { writeHead: () => {}, end: (value) => { body = JSON.parse(value) } },
  )
  assert.deepEqual(renamed, [{ sessionId: 'session-new', title: '新群名' }])
  assert.equal(body.entries[0].sessionId, 'session-new')
  assert.equal(learned.openid.sessionId, 'session-new')
})

test('多個 QQ 會話的標題讀取可以並行', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-dispatch-parallel-'))
  const prefsPath = join(dir, 'model-prefs.json')
  writeFileSync(prefsPath, JSON.stringify({ sessionIds: {
    'qqbot:app:group:one': 'session-one',
    'qqbot:app:group:two': 'session-two',
    'qqbot:app:group:three': 'session-three',
  } }), 'utf8')
  const handlers = new Map()
  let active = 0
  let peak = 0
  registerDispatchRoutes({
    inject: (_names, callback) => callback({ webServer: { register: ({ path, handler }) => { handlers.set(path, handler); return () => {} } }, effect: () => {} }),
    get: (name) => name === 'sessionController' ? {
      list: async () => ['one', 'two', 'three'].map((id) => ({ sessionId: `session-${id}` })),
      projections: async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        active -= 1
        return { values: { title: '群' } }
      },
    } : undefined,
  }, {
    resolver: createSessionResolver({ appId: 'app', prefsPath }),
    groupNames: { readGroupNames: () => ({}), writeGroupNames: () => {} },
    features: {}, defaultMode: 'queue', qqbotApi: {}, loadOptionalPatches: () => [],
  })
  let body
  await handlers.get('/qqbot-tool-dispatch/sessions')(
    { method: 'GET', headers: { host: 'localhost:3000' } },
    { writeHead: () => {}, end: (value) => { body = JSON.parse(value) } },
  )
  assert.equal(body.sessions.length, 3)
  assert.ok(peak >= 2)
})

test('群資訊查詢拒絕過期的會話綁定', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-dispatch-binding-'))
  const prefsPath = join(dir, 'model-prefs.json')
  writeFileSync(prefsPath, JSON.stringify({ sessionIds: { 'qqbot:app:group:openid': 'session-current' } }), 'utf8')
  const handlers = new Map()
  let queried = false
  registerDispatchRoutes({
    inject: (_names, callback) => callback({ webServer: { register: ({ path, handler }) => { handlers.set(path, handler); return () => {} } }, effect: () => {} }),
    get: () => undefined,
  }, {
    resolver: createSessionResolver({ appId: 'app', prefsPath }),
    groupNames: { readGroupNames: () => ({}), writeGroupNames: () => {} },
    features: {}, defaultMode: 'queue',
    qqbotApi: { readQqbotCredentials: async () => ({ appId: 'app' }), groupInfo: async () => { queried = true } },
    loadOptionalPatches: () => [],
  })
  let status
  let body
  await handlers.get('/qqbot-tool-dispatch/group-info')(
    { method: 'GET', url: '/qqbot-tool-dispatch/group-info?openid=openid&sessionId=session-old', headers: { host: 'localhost:3000' } },
    { writeHead: (code) => { status = code }, end: (value) => { body = JSON.parse(value) } },
  )
  assert.equal(status, 409)
  assert.match(body.error, /映射已变化/)
  assert.equal(queried, false)
})
