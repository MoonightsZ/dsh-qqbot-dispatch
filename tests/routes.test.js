import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { registerDispatchRoutes } from '../routes.js'
import { createSessionResolver } from '../session-resolver.js'
import { createGroupHealthStore } from '../group-health.js'

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

test('全局配置路由保存投递方式并拒绝跨来源写入', async () => {
  const handlers = new Map()
  const saved = []
  registerDispatchRoutes({
    inject: (_names, callback) => callback({ webServer: { register: ({ path, handler }) => { handlers.set(path, handler); return () => {} } }, effect: () => {} }),
    get: () => undefined,
  }, {
    resolver: createSessionResolver({ appId: 'app' }),
    groupNames: { readGroupNames: () => ({}), writeGroupNames: () => {} },
    features: {
      snapshot: async () => ({ settings: { deliveryMethod: 'service-turn' } }),
      saveSettings: (body) => { saved.push(body); return body },
    },
    defaultMode: 'queue', qqbotApi: {}, loadOptionalPatches: () => [],
  })
  const send = async (origin) => {
    const req = Readable.from([Buffer.from(JSON.stringify({ deliveryMethod: 'upstream-sdk' }))])
    req.method = 'POST'
    req.headers = { host: 'localhost:3000', ...(origin ? { origin } : {}) }
    let status
    await handlers.get('/qqbot-tool-dispatch/settings')(req, { writeHead: (code) => { status = code }, end: () => {} })
    return status
  }
  assert.equal(await send('https://other.example'), 403)
  assert.equal(saved.length, 0)
  assert.equal(await send(), 200)
  assert.deepEqual(saved, [{ deliveryMethod: 'upstream-sdk' }])
})

test('立即发送请求显式传递重发选项', async () => {
  const handlers = new Map()
  const calls = []
  registerDispatchRoutes({
    inject: (_names, callback) => callback({ webServer: { register: ({ path, handler }) => { handlers.set(path, handler); return () => {} } }, effect: () => {} }),
    get: () => undefined,
  }, {
    resolver: createSessionResolver({ appId: 'app' }),
    groupNames: { readGroupNames: () => ({}), writeGroupNames: () => {} },
    features: { run: async (id, options) => { calls.push({ id, options }); return { matched: 1, sent: 1 } } },
    defaultMode: 'queue', qqbotApi: {}, loadOptionalPatches: () => [],
  })
  const req = Readable.from([Buffer.from(JSON.stringify({ id: 'cs2-matches', forceResend: true }))])
  req.method = 'POST'
  req.headers = { host: 'localhost:3000' }
  await handlers.get('/qqbot-tool-dispatch/features/run')(req, { writeHead: () => {}, end: () => {} })
  assert.deepEqual(calls, [{ id: 'cs2-matches', options: { manual: true, forceResend: true } }])
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

test('群信息查询失败不误判，成功重试后恢复已有不可用状态', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-dispatch-health-'))
  const prefsPath = join(dir, 'model-prefs.json')
  const peer = { scope: 'group', peerId: 'group-openid', sessionId: 'session-123' }
  writeFileSync(prefsPath, JSON.stringify({ sessionIds: { 'qqbot:app:group:group-openid': peer.sessionId } }), 'utf8')
  const groupHealth = createGroupHealthStore(join(dir, 'group-health.json'))
  const handlers = new Map()
  let groupState = 'temporary-error'
  registerDispatchRoutes({
    inject: (_names, callback) => callback({ webServer: { register: ({ path, handler }) => { handlers.set(path, handler); return () => {} } }, effect: () => {} }),
    get: (name) => name === 'sessionController' ? {
      list: async () => [{ sessionId: peer.sessionId }],
      projections: async () => ({ values: { title: '赛事群' } }),
      rename: async () => {},
    } : undefined,
  }, {
    resolver: createSessionResolver({ appId: 'app', prefsPath }),
    groupHealth,
    groupNames: { readGroupNames: () => ({}), writeGroupNames: () => {} },
    features: {}, defaultMode: 'queue',
    qqbotApi: {
      readQqbotCredentials: async () => ({ appId: 'app' }),
      groupInfo: async () => {
        if (groupState === 'available') return { group_name: '赛事群' }
        const error = new Error('群不可达')
        error.httpStatus = groupState === 'temporary-error' ? 500 : 404
        throw error
      },
    },
    loadOptionalPatches: () => [],
  })
  const request = { method: 'POST', headers: { host: 'localhost:3000' } }
  const response = { writeHead: () => {}, end: () => {} }
  await handlers.get('/qqbot-tool-dispatch/titles/refresh')(request, response)
  assert.equal(groupHealth.statusFor(peer), null)
  groupState = 'unavailable'
  await handlers.get('/qqbot-tool-dispatch/titles/refresh')(request, response)
  assert.equal(groupHealth.statusFor(peer), null)
  groupHealth.markUnavailable(peer, '群消息接口 HTTP 404')
  await handlers.get('/qqbot-tool-dispatch/titles/refresh')(request, response)
  assert.equal(groupHealth.statusFor(peer)?.status, 'unavailable')
  let list
  await handlers.get('/qqbot-tool-dispatch/sessions')(
    { method: 'GET', headers: { host: 'localhost:3000' } },
    { writeHead: () => {}, end: (value) => { list = JSON.parse(value) } },
  )
  assert.equal(list.sessions[0].groupStatus, 'unavailable')
  groupState = 'available'
  await handlers.get('/qqbot-tool-dispatch/titles/refresh')(request, response)
  assert.equal(groupHealth.statusFor(peer), null)
})
