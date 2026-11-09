import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFeatureDelivery } from '../delivery.js'

test('QQ 主動訊息失敗時提交插件服務回合', async () => {
  const calls = []
  const groupNames = { readGroupNames: () => ({ group_openid: { sessionId: 'session-123' } }) }
  const qqbotApi = {
    readQqbotCredentials: async () => ({ appId: 'app', appSecret: 'secret' }),
    sendGroupText: async () => { throw new Error('rate limited') },
  }
  const deliver = createFeatureDelivery(groupNames, { resolver: { knownPeers: () => [{ scope: 'group', peerId: 'group_openid', sessionId: 'session-123' }] }, qqbotApi, loadOptionalPatches: () => [], serviceTurn: { dispatch: async (message) => { calls.push(message) } } })
  const result = await deliver({ target: { sessionId: 'session-123' }, text: '賽事提醒' })
  assert.equal(result.channel, 'service-turn')
  assert.match(result.warning, /rate limited/)
  assert.deepEqual(calls, [{ sessionId: 'session-123', text: '賽事提醒' }])
})

test('無 QQ 直發路徑時提交插件服務回合', async () => {
  const calls = []
  const deliver = createFeatureDelivery({ readGroupNames: () => ({}) }, { qqbotApi: {}, serviceTurn: { dispatch: async (message) => { calls.push(message) } } })
  const result = await deliver({ target: { sessionId: 'session-123' }, text: '賽事提醒' })
  assert.deepEqual(result, { channel: 'service-turn' })
  assert.deepEqual(calls, [{ sessionId: 'session-123', text: '賽事提醒' }])
})

test('舊群名快取不得令新會話直發到錯誤群', async () => {
  const calls = []
  const deliver = createFeatureDelivery(
    { readGroupNames: () => ({ old_group: { sessionId: 'session-new' } }) },
    {
      resolver: { knownPeers: () => [{ scope: 'group', peerId: 'current_group', sessionId: 'session-new' }] },
      qqbotApi: { readQqbotCredentials: async () => ({ appId: 'app' }), sendGroupText: async (openid) => { calls.push(openid) } },
      serviceTurn: { dispatch: async () => {} },
    },
  )
  await deliver({ target: { sessionId: 'session-new' }, text: '提醒' })
  assert.deepEqual(calls, ['current_group'])
})

test('群消息接口返回 404 时暂停目标，不回退为服务回合', async () => {
  const peer = { scope: 'group', peerId: 'group-openid', sessionId: 'session-123' }
  const marked = []
  let fallback = false
  const failure = new Error('群不可达')
  failure.httpStatus = 404
  const deliver = createFeatureDelivery({}, {
    resolver: { knownPeers: () => [peer] },
    groupHealth: { statusFor: () => null, markUnavailable: (item) => { marked.push(item) } },
    qqbotApi: {
      readQqbotCredentials: async () => ({ appId: 'app' }),
      sendGroupText: async () => { throw failure },
    },
    serviceTurn: { dispatch: async () => { fallback = true } },
  })
  await assert.rejects(deliver({ target: { sessionId: peer.sessionId }, text: '提醒' }), /群不可用/)
  assert.deepEqual(marked, [peer])
  assert.equal(fallback, false)
})
