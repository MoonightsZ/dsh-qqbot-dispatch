import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFeatureRuntime } from '../features.js'
import { DEFAULT_CS2_DIGEST_TEMPLATE, DEFAULT_CS2_PRE_MATCH_TEMPLATE, DEFAULT_CS2_RESULT_TEMPLATE } from '../modules/cs2-matches/template.js'

function runtimeAt(path) {
  return createFeatureRuntime({ ctx: { get: () => undefined }, statePath: path })
}

test('旧 CS2 配置默认固定内容，模板与全局投递方式可保存并重新读取', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-template-')), 'state.json')
  writeFileSync(path, JSON.stringify({ features: { 'cs2-matches': { enabled: false, values: { teams: [], tiers: [] } } } }), 'utf8')
  const runtime = runtimeAt(path)
  const before = (await runtime.snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.equal(before.deliveryMode, 'direct')
  assert.equal(before.noticeMode, 'daily-digest')
  assert.deepEqual((await runtime.snapshot()).settings, { deliveryMethod: 'service-turn', defaultTargetSessionIds: [] })
  assert.match(before.serviceTemplate, /\{\{matchups\}\}/)
  assert.match(before.serviceTemplate, /\{\{focusAnalysis\}\}/)

  const serviceTemplate = '# {{tournament}}\n\n## 对局\n{{matchups}}\n\n## 焦点分析\n{{focusAnalysis}}\n\n数据来源：[Liquipedia]({{sourceUrl}})'
  await runtime.save('cs2-matches', {
    ...before, source: { id: 'liquipedia' }, deliveryMode: 'service-turn', serviceTemplate,
  })
  const after = (await runtimeAt(path).snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.equal(after.deliveryMode, 'service-turn')
  assert.equal(after.serviceTemplate, serviceTemplate)

  await runtime.saveSettings({ deliveryMethod: 'upstream-sdk' })
  const upstream = await runtimeAt(path).snapshot()
  assert.equal(upstream.settings.deliveryMethod, 'upstream-sdk')
  assert.equal(upstream.features.find((item) => item.id === 'cs2-matches').deliveryMode, 'service-turn')
})

test('新 CS2 配置默认明日汇总，保存通知模式与提前量', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-mode-')), 'state.json')
  const runtime = runtimeAt(path)
  const initial = (await runtime.snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.equal(initial.noticeMode, 'daily-digest')
  assert.equal(initial.digestTemplate, DEFAULT_CS2_DIGEST_TEMPLATE)
  assert.equal(initial.preMatchTemplate, DEFAULT_CS2_PRE_MATCH_TEMPLATE)
  assert.equal(initial.resultTemplate, DEFAULT_CS2_RESULT_TEMPLATE)
  assert.notEqual(initial.digestTemplate, initial.preMatchTemplate)
  assert.equal(initial.digestDay, 'tomorrow')
  assert.equal(initial.scheduleMode, 'cron')
  assert.deepEqual(initial.cron, ['0 18 * * *'])
  await runtime.save('cs2-matches', {
    ...initial, noticeMode: 'pre-match', leadMinutes: 60,
    scheduleMode: 'interval', intervalMinutes: 15,
  })
  const saved = (await runtimeAt(path).snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.equal(saved.noticeMode, 'pre-match')
  assert.equal(saved.leadMinutes, 60)
  assert.equal(saved.intervalMinutes, 15)
})

test('旧自定义服务模板迁移到两种通知模板且分别可保存', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-template-')), 'state.json')
  const old = '# 自订 {{tournament}}\n{{matchups}}\n{{focusAnalysis}}\n[Liquipedia]({{sourceUrl}})'
  writeFileSync(path, JSON.stringify({ features: { 'cs2-matches': { serviceTemplate: old, noticeMode: 'daily-digest' } } }), 'utf8')
  const runtime = runtimeAt(path)
  const before = (await runtime.snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.match(before.digestTemplate, /\{\{schedule\}\}/)
  assert.match(before.preMatchTemplate, /自订/)
  const digestTemplate = '# {{title}}\n{{schedule}}\n{{focusAnalysis}}\n[Liquipedia]({{sourceUrl}})'
  await runtime.save('cs2-matches', { ...before, digestTemplate, source: { id: 'liquipedia' } })
  const after = (await runtimeAt(path).snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.equal(after.digestTemplate, digestTemplate)
  assert.equal(after.preMatchTemplate, old)
})

test('服务回合模板必须包含对局和焦点分析占位符', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-template-')), 'state.json')
  const runtime = runtimeAt(path)
  const before = (await runtime.snapshot()).features.find((item) => item.id === 'cs2-matches')
  await assert.rejects(runtime.save('cs2-matches', {
    ...before, deliveryMode: 'service-turn', serviceTemplate: '# {{tournament}}\n{{matchups}}',
  }), /focusAnalysis/)
  await assert.rejects(runtime.save('cs2-matches', {
    ...before, deliveryMode: 'service-turn', serviceTemplate: '{{matchups}}\n{{focusAnalysis}}',
  }), /sourceUrl/)
  await assert.rejects(runtime.save('cs2-matches', {
    ...before, deliveryMode: 'service-turn', serviceTemplate: 'x'.repeat(6001),
  }), /6000/)
})

test('每日汇总与赛前提醒分别校验各自的占位符', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-template-')), 'state.json')
  const runtime = runtimeAt(path)
  const before = (await runtime.snapshot()).features.find((item) => item.id === 'cs2-matches')
  await assert.rejects(runtime.save('cs2-matches', { ...before, digestTemplate: '# 汇总\n{{matchups}}\n{{focusAnalysis}}\n[Liquipedia]({{sourceUrl}})' }), /schedule/)
  await assert.rejects(runtime.save('cs2-matches', { ...before, preMatchTemplate: '# 赛前\n{{schedule}}\n{{focusAnalysis}}\n[Liquipedia]({{sourceUrl}})' }), /matchups/)
})

test('赛果模板必须包含比分、焦点分析和来源占位符', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-template-')), 'state.json')
  const runtime = runtimeAt(path)
  const before = (await runtime.snapshot()).features.find((item) => item.id === 'cs2-matches')
  await assert.rejects(runtime.save('cs2-matches', { ...before, resultTemplate: '# 赛果\n{{focusAnalysis}}\n[Liquipedia]({{sourceUrl}})' }), /results/)
  const resultTemplate = '# {{tournament}}\n{{results}}\n{{focusAnalysis}}\n[Liquipedia]({{sourceUrl}})'
  await runtime.save('cs2-matches', { ...before, resultTemplate })
  assert.equal((await runtimeAt(path).snapshot()).features.find((item) => item.id === 'cs2-matches').resultTemplate, resultTemplate)
})

test('损坏的旧模板不会抹掉其他 CS2 配置', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-template-')), 'state.json')
  writeFileSync(path, JSON.stringify({ features: { 'cs2-matches': { noticeMode: 'pre-match', leadMinutes: 45, serviceTemplate: '损坏模板' } } }), 'utf8')
  const feature = (await runtimeAt(path).snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.equal(feature.noticeMode, 'pre-match')
  assert.equal(feature.leadMinutes, 45)
  assert.match(feature.preMatchTemplate, /\{\{matchups\}\}/)
  await runtimeAt(path).save('cs2-matches', { ...feature, source: { id: 'liquipedia' } })
})
