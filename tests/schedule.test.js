import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cronMatches, parseCronList, createFeatureRuntime } from '../features.js'
import { describeCron, nextCronTime, formatZonedTime } from '../cron.js'

test('Cron 依設定時區判斷通知時間', () => {
  const schedule = parseCronList('0 9 * * *')
  assert.notEqual(schedule, undefined)
  const instant = new Date('2026-11-09T01:00:00.000Z')
  assert.equal(cronMatches(schedule[0], instant, 'Asia/Shanghai'), true)
  assert.equal(cronMatches(schedule[0], instant, 'UTC'), false)
})

test('無效 Cron 不會被接受', () => {
  assert.equal(parseCronList('99 9 * * *'), undefined)
  assert.equal(parseCronList('0 9 * * 1,'), undefined)
})

test('Cron 说明能显示每日、工作日和多条规则', () => {
  assert.equal(describeCron('0 19 * * *'), '每天 19:00')
  assert.equal(describeCron('0 18-23 * * 1-5'), '周一至周五 18:00–23:00，每小时')
  assert.equal(describeCron('0 9 * * 1; 30 10 * * 0'), '周一 09:00；周日 10:30')
  assert.equal(describeCron('0 9 1 * 1'), '每月1日且周一 09:00')
  assert.equal(describeCron('0 9 * 1 *'), '每年1月每天 09:00')
  assert.equal(describeCron('0 9 1 1 *'), '每年1月的1日 09:00')
  assert.equal(describeCron('99 9 * * *'), null)
})

test('下一次执行时间按 Cron 时区计算并格式化', () => {
  const from = Date.parse('2026-11-09T00:00:00Z')
  const next = nextCronTime('0 19 * * *', 'Asia/Shanghai', from)
  assert.equal(next, Date.parse('2026-11-09T11:00:00Z'))
  assert.match(formatZonedTime(next, 'Asia/Shanghai'), /2026.*11.*09.*19:00.*Asia\/Shanghai/)
  assert.equal(nextCronTime('99 9 * * *', 'Asia/Shanghai', from), 0)
})

test('年度规则也能给出下一次执行时间', () => {
  const from = Date.parse('2026-11-09T00:00:00Z')
  assert.equal(nextCronTime('0 9 1 1 *', 'Asia/Shanghai', from), Date.parse('2027-01-01T01:00:00Z'))
})

test('多条 Cron 规则使用数组，旧分号字符串仍可读取', async () => {
  const rules = ['0 9 * * 1', '30 10 * * 0']
  assert.equal(parseCronList(rules).length, 2)
  assert.equal(describeCron(rules), '周一 09:00；周日 10:30')
  assert.equal(nextCronTime(rules, 'Asia/Shanghai', Date.parse('2026-11-09T00:00:00Z')), Date.parse('2026-11-09T01:00:00Z'))
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cron-')), 'state.json')
  writeFileSync(path, JSON.stringify({ features: { 'cs2-matches': { cron: rules.join(';'), scheduleMode: 'cron' } } }), 'utf8')
  const runtime = createFeatureRuntime({ ctx: { get: () => undefined }, statePath: path })
  const before = (await runtime.snapshot()).features.find((entry) => entry.id === 'cs2-matches')
  assert.deepEqual(before.cron, rules)
  await runtime.save('cs2-matches', { ...before, cron: rules, source: { id: 'liquipedia' }, values: {} })
  const after = (await runtime.snapshot()).features.find((entry) => entry.id === 'cs2-matches')
  assert.deepEqual(after.cron, rules)
})
