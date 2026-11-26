import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGroupChatGate } from '../modules/group-chat-gate/provider.js'
import { createFeatureRuntime } from '../features.js'
import { discoverModules } from '../module-discovery.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = { enabled: true, values: { chancePercent: '100', debounceSeconds: '0', backlogMax: '5', minIntervalSeconds: '0', maxPerHour: '0', maxPerDay: '0', filterInvalid: 'true' } }
const group = (content, extra = {}) => ({ kind: 'group', groupOpenid: 'g1', senderId: 'u1', senderName: '甲', content, ...extra })

test('群聊频控只拦未 @ 的纯文字群消息，私聊、@ 和附件直接放行', async () => {
  const seen = []
  class QQBot { async handleInboundMessage(raw) { seen.push(raw); return raw } }
  const original = QQBot.prototype.handleInboundMessage
  const gate = createGroupChatGate({ QQBot, feature: base, random: () => 1 })
  const bot = new QQBot()
  await bot.handleInboundMessage({ kind: 'c2c', content: '你好' })
  await bot.handleInboundMessage(group('你好', { rawEventType: 'GROUP_AT_MESSAGE_CREATE' }))
  await bot.handleInboundMessage(group('文件', { attachments: [{ id: 'file' }] }))
  await bot.handleInboundMessage(group('你好'))
  assert.equal(seen.length, 3)
  gate.dispose()
  assert.equal(QQBot.prototype.handleInboundMessage, original)
})

test('防抖合并群消息；概率未中时积压，下一次命中附带旧消息', async () => {
  const seen = []
  const timers = []
  class QQBot { async handleInboundMessage(raw) { seen.push(raw); return raw } }
  const gate = createGroupChatGate({ QQBot, feature: { ...base, values: { ...base.values, debounceSeconds: '2' } },
    random: (() => { const draws = [0.9, 0.1]; return () => draws.shift() ?? 0 })(),
    setTimer: (fn) => { timers.push(fn); return { unref() {} } }, clearTimer: () => {} })
  const bot = new QQBot()
  gate.update({ ...base, values: { ...base.values, chancePercent: '50', debounceSeconds: '2' } })
  await bot.handleInboundMessage(group('第一条'))
  timers.shift()()
  await Promise.resolve()
  assert.equal(seen.length, 0)
  await bot.handleInboundMessage(group('第二条'))
  timers.shift()()
  await Promise.resolve()
  assert.equal(seen.length, 1)
  assert.match(seen[0].content, /第一条/)
  assert.match(seen[0].content, /第二条/)
  gate.dispose()
})

test('无效文字过滤及每群最短间隔，关闭后恢复上游处理', async () => {
  let at = 100_000
  const seen = []
  class QQBot { async handleInboundMessage(raw) { seen.push(raw); return raw } }
  const gate = createGroupChatGate({ QQBot, feature: { ...base, values: { ...base.values, minIntervalSeconds: '60' } }, now: () => at })
  const bot = new QQBot()
  await bot.handleInboundMessage(group('哈哈哈'))
  await bot.handleInboundMessage(group('有效消息'))
  await Promise.resolve()
  at += 1000
  await bot.handleInboundMessage(group('第二条有效消息'))
  await Promise.resolve()
  assert.equal(seen.length, 1)
  gate.update({ ...base, enabled: false })
  await bot.handleInboundMessage(group('关闭后放行'))
  assert.equal(seen.length, 2)
  gate.dispose()
})

test('@ 消息立即带入同群待处理文字；另一群不混入', async () => {
  const seen = []
  class QQBot { async handleInboundMessage(raw) { seen.push(raw); return raw } }
  const gate = createGroupChatGate({ QQBot, feature: { ...base, values: { ...base.values, debounceSeconds: '30' } } })
  const bot = new QQBot()
  await bot.handleInboundMessage(group('群一的讨论'))
  await bot.handleInboundMessage(group('群二的讨论', { groupOpenid: 'g2' }))
  await bot.handleInboundMessage(group('请回答', { rawEventType: 'GROUP_AT_MESSAGE_CREATE' }))
  assert.equal(seen.length, 1)
  assert.match(seen[0].content, /群一的讨论/)
  assert.doesNotMatch(seen[0].content, /群二的讨论/)
  gate.dispose()
})

test('同时开启 expands 频控时本模组放行，避免双重频控', async () => {
  const seen = []
  class QQBot { async handleInboundMessage(raw) { seen.push(raw); return raw } }
  const key = Symbol.for('@local/dsh-qqbot-expands/registry')
  const previous = globalThis[key]
  globalThis[key] = { controller: { rt: { cfg: { gate: { enabled: true } } } } }
  const gate = createGroupChatGate({ QQBot, feature: { ...base, values: { ...base.values, chancePercent: '0' } } })
  try {
    await new QQBot().handleInboundMessage(group('正常文字'))
    assert.equal(seen.length, 1)
  } finally {
    gate.dispose()
    if (previous === undefined) delete globalThis[key]
    else globalThis[key] = previous
  }
})

test('频控作为实时模组可在无目标会话时启用，保存后立即更新配置且不进入定时调度', async () => {
  const modules = await discoverModules()
  const gate = modules.find((item) => item.definition.id === 'group-chat-gate')
  assert.ok(gate)
  const statePath = join(mkdtempSync(join(tmpdir(), 'qqbot-gate-')), 'state.json')
  const runtime = createFeatureRuntime({ ctx: { get: () => undefined }, modules: modules.map((item) => item.definition), statePath })
  const changes = []
  runtime.onSave('group-chat-gate', (feature) => changes.push(feature))
  await runtime.save('group-chat-gate', { enabled: true, target: { sessionIds: [] }, values: { chancePercent: '42' } })
  assert.equal(runtime.getFeature('group-chat-gate').enabled, true)
  assert.equal(changes[0].values.chancePercent, '42')
  assert.equal((await runtime.run('group-chat-gate', { manual: true })).reason, 'realtime')
  assert.equal((await runtime.snapshot()).features.find((item) => item.id === 'group-chat-gate').nextRunAt, null)
  await assert.rejects(runtime.save('group-chat-gate', { enabled: true, values: { chancePercent: '101' } }), /接话概率/)
  await assert.rejects(runtime.save('group-chat-gate', { enabled: true, values: { debounceSeconds: '-1' } }), /静默合并/)
})
