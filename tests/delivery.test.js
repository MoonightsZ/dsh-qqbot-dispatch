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
