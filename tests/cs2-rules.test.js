import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFeatureRuntime } from '../features.js'

function makeRuntime(statePath, now = () => Date.parse('2026-11-09T10:00:00Z')) {
  return createFeatureRuntime({ ctx: { get: () => undefined }, statePath, now })
}

test('新配置只预选每日汇总，模块总开关仍关闭', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-rules-')), 'state.json')
  const feature = (await makeRuntime(path).snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.equal(feature.enabled, false)
  assert.equal(feature.noticeRules['daily-digest'].enabled, true)
  assert.deepEqual(feature.noticeRules['daily-digest'].cron, ['0 18 * * *'])
  assert.equal(feature.noticeRules['pre-match'].enabled, false)
  assert.equal(feature.noticeRules['pre-match'].intervalMinutes, 15)
  assert.equal(feature.noticeRules.result.enabled, false)
  assert.equal(feature.noticeRules.result.intervalMinutes, 15)
})

test('旧单选配置只迁移原通知方式及其计划和结果', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-rules-')), 'state.json')
  writeFileSync(path, JSON.stringify({ features: { 'cs2-matches': { enabled: true, noticeMode: 'pre-match', scheduleMode: 'interval', intervalMinutes: 30,
    lastRunAt: 12345, lastResult: { sent: 1 }, target: { sessionId: 'session-1' } } } }), 'utf8')
  const feature = (await makeRuntime(path).snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.equal(feature.noticeRules['daily-digest'].enabled, false)
  assert.equal(feature.noticeRules['pre-match'].enabled, true)
  assert.equal(feature.noticeRules['pre-match'].intervalMinutes, 30)
  assert.equal(feature.noticeRules['pre-match'].lastRunAt, 12345)
  assert.equal(feature.noticeRules['pre-match'].lastResult.sent, 1)
  assert.equal(feature.noticeRules.result.enabled, false)
})

test('已移除通知方式的旧配置升级后关闭全部规则', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-rules-')), 'state.json')
  writeFileSync(path, JSON.stringify({ features: { 'cs2-matches': { enabled: true, noticeMode: 'legacy', scheduleMode: 'interval', intervalMinutes: 60 } } }), 'utf8')
  const feature = (await makeRuntime(path).snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.equal(feature.noticeRules.legacy, undefined)
  assert.equal(feature.noticeRules['daily-digest'].enabled, false)
  assert.equal(feature.noticeRules['pre-match'].enabled, false)
  assert.equal(feature.noticeRules.result.enabled, false)
})

test('同轮到期规则按优先级错峰，重启后仍执行待发送的 Cron', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-rules-')), 'state.json')
  let at = Date.parse('2026-11-09T10:00:00Z')
  const runtime = makeRuntime(path, () => at)
  await runtime.save('cs2-matches', { enabled: true, target: { sessionId: 'session-1' }, source: { id: 'liquipedia' }, values: {},
    noticeRules: {
      'daily-digest': { enabled: true, scheduleMode: 'cron', cron: ['0 18 * * *'], intervalMinutes: 1440 },
      'pre-match': { enabled: true, scheduleMode: 'interval', cron: [], intervalMinutes: 15 },
      result: { enabled: true, scheduleMode: 'interval', cron: [], intervalMinutes: 15 },
    } })
  const modes = []
  runtime.registerProvider('cs2-matches', async ({ noticeMode }) => { modes.push(noticeMode); return { matched: 1, sent: 1, channel: noticeMode } })
  await runtime.tick()
  assert.deepEqual(modes, ['pre-match'])
  await runtime.tick()
  assert.deepEqual(modes, ['pre-match'])
  at += 29_000
  await runtime.tick()
  assert.deepEqual(modes, ['pre-match'])
  at += 1_000
  const restarted = makeRuntime(path, () => at)
  restarted.registerProvider('cs2-matches', async ({ noticeMode }) => { modes.push(noticeMode); return { matched: 1, sent: 1, channel: noticeMode } })
  await restarted.tick()
  assert.deepEqual(modes, ['pre-match', 'result'])
  at += 30_000
  await restarted.tick()
  assert.deepEqual(modes, ['pre-match', 'result', 'daily-digest'])
  const feature = (await makeRuntime(path).snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.equal(feature.noticeRules['daily-digest'].lastResult.channel, 'daily-digest')
  assert.equal(feature.noticeRules['pre-match'].lastResult.channel, 'pre-match')
  assert.equal(feature.noticeRules.result.lastResult.channel, 'result')
})

test('没有匹配赛事的高优先级检查不占发送间隔', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-rules-')), 'state.json')
  const runtime = makeRuntime(path)
  await runtime.save('cs2-matches', { enabled: true, target: { sessionId: 'session-1' }, source: { id: 'liquipedia' }, values: {},
    noticeRules: { 'pre-match': { enabled: true, scheduleMode: 'interval', intervalMinutes: 15 },
      result: { enabled: true, scheduleMode: 'interval', intervalMinutes: 15 } } })
  const modes = []
  runtime.registerProvider('cs2-matches', async ({ noticeMode }) => { modes.push(noticeMode); return { matched: 0, sent: noticeMode === 'result' ? 1 : 0 } })
  await runtime.tick()
  assert.deepEqual(modes, ['pre-match', 'result'])
})

test('手动指定一条规则只更新该规则结果，保存设置保留运行记录', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-rules-')), 'state.json')
  const runtime = makeRuntime(path)
  const config = { enabled: true, target: { sessionId: 'session-1' }, source: { id: 'liquipedia' }, values: {},
    noticeRules: {
      'daily-digest': { enabled: true, scheduleMode: 'cron', cron: ['0 18 * * *'] },
      'pre-match': { enabled: true, scheduleMode: 'interval', intervalMinutes: 15 },
    } }
  await runtime.save('cs2-matches', config)
  runtime.registerProvider('cs2-matches', async ({ noticeMode }) => ({ matched: 1, sent: 1, channel: noticeMode }))
  await runtime.run('cs2-matches', { manual: true, noticeMode: 'pre-match', forceResend: true })
  await runtime.save('cs2-matches', config)
  const feature = (await makeRuntime(path).snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.equal(feature.noticeRules['daily-digest'].lastRunAt, 0)
  assert.equal(feature.noticeRules['pre-match'].lastResult.channel, 'pre-match')
})

test('保存时拒绝已启用规则的无效 Cron', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-rules-')), 'state.json')
  await assert.rejects(makeRuntime(path).save('cs2-matches', {
    enabled: false, source: { id: 'liquipedia' }, target: { sessionId: '' }, values: {},
    noticeRules: { 'daily-digest': { enabled: true, scheduleMode: 'cron', cron: ['bad cron'] } },
  }), /每日汇总的 Cron 规则无效/)
})
