import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
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
})

test('自动闲聊满足频率条件才提交服务回合，并记录上次发送时间', async () => {
  const calls = []
  const provider = createChatProvider({ serviceTurn: { dispatch: async (value) => { calls.push(value) } }, random: () => 0.1 })
  const feature = { values: { chancePercent: '30', cooldownDays: '3', quietStart: '22', quietEnd: '9', topics: '最近有什么好玩的事？' }, timeZone: 'Asia/Shanghai', lastSentAt: 0 }
  const at = Date.parse('2026-11-09T11:00:00Z')
  const ctx = { sessionController: { list: async () => ({ items: [] }) } }
  const first = await provider({ feature, target: { sessionId: 'session-123' }, ctx, now: () => at, manual: false })
  assert.equal(first.sent, 1)
  assert.equal(feature.lastSentAt, at)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].sessionId, 'session-123')
  assert.match(calls[0].text, /最近有什么好玩的事/)
  assert.match(calls[0].text, /简短/)
  const second = await provider({ feature, target: { sessionId: 'session-123' }, ctx, now: () => at + 86_400_000, manual: false })
  assert.equal(second.sent, 0)
  assert.equal(calls.length, 1)
})

test('安静时段、近期活动或未抽中时不发起自动闲聊', async () => {
  const calls = []
  const feature = { values: { chancePercent: '30', cooldownDays: '3', quietStart: '22', quietEnd: '9' }, timeZone: 'Asia/Shanghai', lastSentAt: 0 }
  const at = Date.parse('2026-11-09T15:00:00Z')
  const target = { sessionId: 'session-123' }
  const serviceTurn = { dispatch: async (value) => { calls.push(value) } }
  const quiet = createChatProvider({ serviceTurn, random: () => 0 })
  assert.equal((await quiet({ feature, target, ctx: {}, now: () => at, manual: false })).sent, 0)
  const recent = createChatProvider({ serviceTurn, random: () => 0 })
  const ctx = { sessionController: { list: async () => ({ items: [{ sessionId: 'session-123', updatedAt: new Date(at - 4 * 3_600_000 - 60_000).toISOString() }] }) } }
  assert.equal((await recent({ feature, target, ctx, now: () => at - 4 * 3_600_000, manual: false })).sent, 0)
  const missed = createChatProvider({ serviceTurn, random: () => 0.9 })
  assert.equal((await missed({ feature, target, ctx: { sessionController: { list: async () => ({ items: [] }) } }, now: () => at - 4 * 3_600_000, manual: false })).sent, 0)
  assert.equal(calls.length, 0)
})

test('滚动七天内最多自动发起两次闲聊', async () => {
  const calls = []
  const provider = createChatProvider({ serviceTurn: { dispatch: async (value) => { calls.push(value) } }, random: () => 0 })
  const at = Date.parse('2026-11-09T11:00:00Z')
  const feature = {
    values: { chancePercent: '100', cooldownDays: '1', quietStart: '22', quietEnd: '9' },
    timeZone: 'Asia/Shanghai', lastSentAt: at - 2 * 86_400_000,
    chatSentAt: [at - 5 * 86_400_000, at - 2 * 86_400_000],
  }
  const ctx = { sessionController: { list: async () => ({ items: [] }) } }
  const result = await provider({ feature, target: { sessionId: 'session-123' }, ctx, now: () => at, manual: false })
  assert.equal(result.sent, 0)
  assert.equal(calls.length, 0)
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
