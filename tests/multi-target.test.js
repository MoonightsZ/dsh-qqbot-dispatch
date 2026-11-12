import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFeatureRuntime } from '../features.js'
import { createLiquipediaProvider } from '../modules/cs2-matches/provider.js'

function runtime(path, modules) {
  return createFeatureRuntime({ ctx: { get: () => undefined }, statePath: path, ...(modules ? { modules } : {}) })
}

function statePath() {
  return join(mkdtempSync(join(tmpdir(), 'qqbot-multi-target-')), 'state.json')
}

test('旧单目标配置及历史通知归属原会话', async () => {
  const path = statePath()
  writeFileSync(path, JSON.stringify({ settings: { defaultTargetSessionId: 'private-old' },
    features: { 'cs2-matches': { enabled: true, target: { sessionId: '' }, seen: { 'pre:match-a': 100 } } } }), 'utf8')
  const current = runtime(path)
  const snapshot = await current.snapshot()
  assert.deepEqual(snapshot.settings.defaultTargetSessionIds, ['private-old'])
  assert.deepEqual(snapshot.features.find((item) => item.id === 'cs2-matches').target.sessionIds, [])
  current.registerProvider('cs2-matches', async ({ feature, target }) => ({ matched: 1,
    sent: feature.seen['pre:match-a'] ? 0 : 1, channel: target.sessionId }))
  const result = await current.run('cs2-matches', { manual: true, noticeMode: 'pre-match' })
  assert.equal(result.sent, 0)
  assert.equal(result.targetResults[0].sessionId, 'private-old')
})

test('多目标部分失败后只补发失败目标，记录逐目标结果', async () => {
  const path = statePath()
  const current = runtime(path)
  current.saveSettings({ defaultTargetSessionIds: ['group-one', 'private-two', 'group-one'] })
  const calls = []
  let failPrivate = true
  current.registerProvider('cs2-matches', async ({ feature, target }) => {
    calls.push(target.sessionId)
    if (feature.seen['pre:match-a']) return { matched: 1, sent: 0 }
    if (target.sessionId === 'private-two' && failPrivate) throw new Error('私聊发送失败')
    feature.seen['pre:match-a'] = 100
    return { matched: 1, sent: 1 }
  })
  const first = await current.run('cs2-matches', { manual: true, noticeMode: 'pre-match' })
  assert.equal(first.sent, 1)
  assert.equal(first.targetResults.length, 2)
  assert.match(first.targetResults[1].error, /私聊发送失败/)
  failPrivate = false
  const second = await current.run('cs2-matches', { manual: true, noticeMode: 'pre-match' })
  assert.equal(second.sent, 1)
  assert.deepEqual(second.targetResults.map((item) => item.sent), [0, 1])
  assert.deepEqual(calls, ['group-one', 'private-two', 'group-one', 'private-two'])
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).settings.defaultTargetSessionIds, ['group-one', 'private-two'])
})

test('偶尔闲聊的冷却按目标独立，扩展模组仍收到单目标接口', async () => {
  const path = statePath()
  const modules = [{ id: 'sample-alert', label: '示例', provider: null, fields: [] },
    { id: 'casual-chat', label: '闲聊', provider: 'builtin', fields: [] }]
  const current = runtime(path, modules)
  current.saveSettings({ defaultTargetSessionIds: ['group-one', 'private-two'] })
  const used = []
  current.registerProvider('casual-chat', async ({ feature, target }) => {
    used.push([target.sessionId, feature.lastSentAt ?? 0])
    if (feature.lastSentAt) return { matched: 0, sent: 0 }
    feature.lastSentAt = 200
    feature.lastTopicId = target.sessionId
    return { matched: 1, sent: 1 }
  })
  await current.run('casual-chat', { manual: true })
  await current.run('casual-chat', { manual: true })
  assert.deepEqual(used, [['group-one', 0], ['private-two', 0], ['group-one', 200], ['private-two', 200]])
  await current.save('sample-alert', { enabled: true, target: { sessionIds: ['private-two', 'group-one'] }, source: { id: 'none' }, values: {} })
  const targets = []
  current.registerProvider('sample-alert', async ({ target }) => { targets.push(target.sessionId); return { matched: 1, sent: 1 } })
  assert.equal((await current.run('sample-alert')).sent, 2)
  assert.deepEqual(targets, ['private-two', 'group-one'])
})

test('目标数组超过上限时拒绝保存', async () => {
  const current = runtime(statePath())
  assert.throws(() => current.saveSettings({ defaultTargetSessionIds: Array.from({ length: 21 }, (_, index) => `s-${index}`) }), /最多 20/)
})

test('真实 CS2 发送器对群聊和私聊独立去重，失败目标可补发', async () => {
  const path = statePath()
  const at = Date.parse('2026-11-09T10:00:00Z')
  const current = createFeatureRuntime({ ctx: { get: () => undefined }, statePath: path, now: () => at })
  current.saveSettings({ defaultTargetSessionIds: ['group-one', 'private-two'], deliveryMethod: 'upstream-sdk' })
  await current.save('cs2-matches', { enabled: true, target: { sessionIds: [] }, source: { id: 'liquipedia' },
    values: { teams: [], tiers: [] }, noticeMode: 'pre-match', leadMinutes: 60 })
  const sent = []
  let failPrivate = true
  current.registerProvider('cs2-matches', createLiquipediaProvider({
    loadMatches: async () => [{ id: 'match-1', timestamp: Math.floor((at + 30 * 60_000) / 1000),
      tournament: 'Test Cup', tournamentPage: '', teamA: 'Team A', teamB: 'Team B', bestOf: 3 }],
    upstreamSender: { send: async ({ sessionId }) => {
      if (sessionId === 'private-two' && failPrivate) throw new Error('私聊发送失败')
      sent.push(sessionId)
    } },
  }))
  const first = await current.run('cs2-matches', { manual: true, noticeMode: 'pre-match' })
  assert.equal(first.sent, 1)
  assert.equal(first.targetResults[1].sent, 0)
  failPrivate = false
  const second = await current.run('cs2-matches', { manual: true, noticeMode: 'pre-match' })
  assert.equal(second.sent, 1)
  assert.deepEqual(sent, ['group-one', 'private-two'])
})
