import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatProvider } from '../modules/casual-chat/provider.js'
import { createFeatureRuntime } from '../features.js'

test('偶尔闲聊作为独立模组出现，默认关闭且采用每日定点检查', async () => {
  const runtime = createFeatureRuntime({ ctx: { get: () => undefined }, statePath: join(mkdtempSync(join(tmpdir(), 'qqbot-chat-')), 'state.json') })
  const { features } = await runtime.snapshot()
  const chat = features.find((entry) => entry.id === 'casual-chat')
  assert.ok(chat)
  assert.equal(chat.enabled, false)
  assert.equal(chat.scheduleMode, 'cron')
  assert.deepEqual(chat.cron, ['0 19 * * *'])
  assert.equal(chat.providerLabel, '内置')
  assert.equal(chat.values.cooldownHours, '72')
})

test('旧冷却天数配置换算为小时', async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), 'qqbot-chat-')), 'state.json')
  writeFileSync(statePath, JSON.stringify({ features: { 'casual-chat': { values: { cooldownDays: '3' } } } }), 'utf8')
  const runtime = createFeatureRuntime({ ctx: { get: () => undefined }, statePath })
  const chat = (await runtime.snapshot()).features.find((entry) => entry.id === 'casual-chat')
  assert.equal(chat.values.cooldownHours, '72')
  writeFileSync(statePath, JSON.stringify({ features: { 'casual-chat': { values: { cooldownDays: '0' } } } }), 'utf8')
  const clamped = (await runtime.snapshot()).features.find((entry) => entry.id === 'casual-chat')
  assert.equal(clamped.values.cooldownHours, '24')
})

test('旧话题文本读取时迁移为列表，保存多标签话题不拆分句子', async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), 'qqbot-chat-')), 'state.json')
  writeFileSync(statePath, JSON.stringify({ features: { 'casual-chat': { values: { topics: '今天怎么样？|想聊 CS2 比赛吗？' } } } }), 'utf8')
  const runtime = createFeatureRuntime({ ctx: { get: () => undefined }, statePath })
  const old = (await runtime.snapshot()).features.find((entry) => entry.id === 'casual-chat')
  assert.deepEqual(old.values.topics.map((topic) => topic.text), ['今天怎么样？', '想聊 CS2 比赛吗？'])
  await runtime.save('casual-chat', { target: { sessionId: 'session-123' }, source: { id: 'none' }, values: { topics: [{ id: 'one', text: '想聊 CS2 比赛吗？', tags: ['CS2', '赛事'], enabled: true }] } })
  const saved = (await runtime.snapshot()).features.find((entry) => entry.id === 'casual-chat')
  assert.deepEqual(saved.values.topics[0].tags, ['CS2', '赛事'])
})

test('自动闲聊按小时冷却，满足条件后提交服务回合', async () => {
  const calls = []
  const provider = createChatProvider({ serviceTurn: { dispatch: async (value) => { calls.push(value) } }, random: () => 0.1 })
  const feature = { values: { chancePercent: '30', cooldownHours: '2', quietStart: '22', quietEnd: '9', topics: '最近有什么好玩的事？' }, timeZone: 'Asia/Shanghai', lastSentAt: 0 }
  const at = Date.parse('2026-11-09T11:00:00Z')
  const ctx = { sessionController: { list: async () => ({ items: [] }) } }
  const first = await provider({ feature, target: { sessionId: 'session-123' }, ctx, now: () => at, manual: false })
  assert.equal(first.sent, 1)
  assert.equal(feature.lastSentAt, at)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].sessionId, 'session-123')
  assert.match(calls[0].text, /最近有什么好玩的事/)
  assert.match(calls[0].text, /简短/)
  const second = await provider({ feature, target: { sessionId: 'session-123' }, ctx, now: () => at + 1 * 3_600_000, manual: false })
  assert.equal(second.sent, 0)
  assert.equal(calls.length, 1)
  const third = await provider({ feature, target: { sessionId: 'session-123' }, ctx, now: () => at + 2 * 3_600_000, manual: false })
  assert.equal(third.sent, 1)
})

test('全局 SDK 模式将选中的闲聊话题直接发送', async () => {
  const sent = []
  const provider = createChatProvider({
    serviceTurn: { dispatch: async () => { throw new Error('不应提交服务回合') } },
    upstreamSender: { send: async (item) => sent.push(item) },
    random: () => 0,
  })
  const at = Date.parse('2026-11-09T11:00:00Z')
  const feature = { values: { topics: '最近有什么好玩的事？' }, lastSentAt: 0 }
  const result = await provider({ feature, settings: { deliveryMethod: 'upstream-sdk' }, target: { sessionId: 'session-123' }, ctx: {}, now: () => at, manual: true })
  assert.equal(result.channel, 'qq-sdk')
  assert.deepEqual(sent, [{ sessionId: 'session-123', text: '最近有什么好玩的事？' }])
  assert.equal(feature.lastSentAt, at)
})

test('发送成功后避开上一话题，失败时不更新记录', async () => {
  const sent = []
  let fail = false
  const provider = createChatProvider({ upstreamSender: { send: async ({ text }) => { if (fail) throw new Error('发送失败'); sent.push(text) } }, random: () => 0 })
  const feature = { values: { topics: [
    { id: 'a', text: '话题 A', tags: ['游戏'], enabled: true },
    { id: 'b', text: '话题 B', tags: ['游戏'], enabled: true },
  ] }, lastSentAt: 0 }
  const options = { feature, settings: { deliveryMethod: 'upstream-sdk' }, target: { sessionId: 'session-123' }, now: () => 1000, manual: true }
  await provider(options)
  assert.equal(feature.lastTopicId, 'a')
  fail = true
  await assert.rejects(provider(options), /发送失败/)
  assert.equal(feature.lastTopicId, 'a')
  fail = false
  await provider(options)
  assert.deepEqual(sent, ['话题 A', '话题 B'])
  assert.equal(feature.lastTopicId, 'b')
})

test('话题池全部禁用时跳过闲聊', async () => {
  const provider = createChatProvider({ upstreamSender: { send: async () => { throw new Error('不应发送') } }, random: () => 0 })
  const result = await provider({ feature: { values: { topics: [{ id: 'a', text: '禁用', tags: [], enabled: false }] } }, settings: { deliveryMethod: 'upstream-sdk' }, target: { sessionId: 'session-123' }, now: () => 1000, manual: true })
  assert.equal(result.sent, 0)
  assert.match(result.warning, /没有启用的话题/)
})

test('运行结果持久化上次抽中的话题', async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), 'qqbot-chat-')), 'state.json')
  const runtime = createFeatureRuntime({ ctx: { get: () => undefined }, statePath })
  await runtime.save('casual-chat', { target: { sessionId: 'session-123' }, source: { id: 'none' }, values: { topics: [{ id: 'a', text: '话题 A', tags: [], enabled: true }] } })
  runtime.registerProvider('casual-chat', createChatProvider({ upstreamSender: { send: async () => {} }, random: () => 0 }))
  runtime.saveSettings({ deliveryMethod: 'upstream-sdk' })
  await runtime.run('casual-chat', { manual: true })
  const chat = (await runtime.snapshot()).features.find((entry) => entry.id === 'casual-chat')
  assert.equal(chat.lastTopicId, 'a')
})

test('安静时段或未抽中时不发起自动闲聊', async () => {
  const calls = []
  const feature = { values: { chancePercent: '30', cooldownHours: '72', quietStart: '22', quietEnd: '9' }, timeZone: 'Asia/Shanghai', lastSentAt: 0 }
  const at = Date.parse('2026-11-09T15:00:00Z')
  const target = { sessionId: 'session-123' }
  const serviceTurn = { dispatch: async (value) => { calls.push(value) } }
  const quiet = createChatProvider({ serviceTurn, random: () => 0 })
  assert.equal((await quiet({ feature, target, ctx: {}, now: () => at, manual: false })).sent, 0)
  const missed = createChatProvider({ serviceTurn, random: () => 0.9 })
  assert.equal((await missed({ feature, target, ctx: { sessionController: { list: async () => ({ items: [] }) } }, now: () => at - 4 * 3_600_000, manual: false })).sent, 0)
  assert.equal(calls.length, 0)
})

test('近期活动和旧七天发送记录不再阻止自动闲聊', async () => {
  const calls = []
  const provider = createChatProvider({ serviceTurn: { dispatch: async (value) => { calls.push(value) } }, random: () => 0 })
  const at = Date.parse('2026-11-09T11:00:00Z')
  const feature = {
    values: { chancePercent: '100', cooldownHours: '24', quietStart: '22', quietEnd: '9' },
    timeZone: 'Asia/Shanghai', lastSentAt: at - 2 * 86_400_000,
    chatSentAt: [at - 5 * 86_400_000, at - 2 * 86_400_000],
  }
  const ctx = { sessionController: { list: async () => ({ items: [{ sessionId: 'session-123', updatedAt: new Date(at - 60_000).toISOString() }] }) } }
  const result = await provider({ feature, target: { sessionId: 'session-123' }, ctx, now: () => at, manual: false })
  assert.equal(result.sent, 1)
  assert.equal(calls.length, 1)
})

test('同一模组运行中不接受第二次并发检查', async () => {
  const runtime = createFeatureRuntime({ ctx: { get: () => undefined }, statePath: join(mkdtempSync(join(tmpdir(), 'qqbot-chat-')), 'state.json') })
  await runtime.save('casual-chat', { target: { sessionId: 'session-123' }, source: { id: 'none' }, values: {} })
  let release
  let calls = 0
  runtime.registerProvider('casual-chat', async () => {
    calls += 1
    await new Promise((resolve) => { release = resolve })
    return { matched: 1, sent: 1 }
  })
  const first = runtime.run('casual-chat', { manual: true })
  await Promise.resolve()
  const second = await runtime.run('casual-chat', { manual: true })
  assert.deepEqual(second, { skipped: true, reason: 'running' })
  release()
  await first
  assert.equal(calls, 1)
})

test('不同模组并发完成时保留各自结果', async () => {
  const runtime = createFeatureRuntime({ ctx: { get: () => undefined }, statePath: join(mkdtempSync(join(tmpdir(), 'qqbot-chat-')), 'state.json') })
  await runtime.save('cs2-matches', { target: { sessionId: 'session-123' }, source: { id: 'liquipedia' }, values: {} })
  await runtime.save('casual-chat', { target: { sessionId: 'session-123' }, source: { id: 'none' }, values: {} })
  const releases = {}
  for (const id of ['cs2-matches', 'casual-chat']) {
    runtime.registerProvider(id, async () => {
      await new Promise((resolve) => { releases[id] = resolve })
      return { matched: 1, sent: 1, channel: id }
    })
  }
  const cs2 = runtime.run('cs2-matches', { manual: true })
  const chat = runtime.run('casual-chat', { manual: true })
  await Promise.resolve()
  releases['cs2-matches']()
  await cs2
  releases['casual-chat']()
  await chat
  const { features } = await runtime.snapshot()
  assert.equal(features.find((entry) => entry.id === 'cs2-matches').lastResult.channel, 'cs2-matches')
  assert.equal(features.find((entry) => entry.id === 'casual-chat').lastResult.channel, 'casual-chat')
})
