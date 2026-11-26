import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFeatureRuntime } from '../features.js'
import { DEFAULT_CS2_DIGEST_TEMPLATE, DEFAULT_CS2_PRE_MATCH_TEMPLATE, DEFAULT_CS2_RESULT_TEMPLATE, composeCs2ServiceTurnPrompt } from '../modules/cs2-matches/template.js'

test('服務回合模板把已確認等級標為 Valve Tier', () => {
  const section = { title: 'PGL Major', markdown: '# PGL Major\nValve Tier：Major\n- A vs B\n---\n数据来源：Liquipedia' }
  const prompt = composeCs2ServiceTurnPrompt(section, DEFAULT_CS2_PRE_MATCH_TEMPLATE, undefined, 'pre-match')
  assert.match(prompt, /Valve Tier：Major/)
  assert.doesNotMatch(prompt, /Major 级赛事|Major 級賽事/)
})

test('每日汇总默认模板沿用简洁赛程，并将看点放在赛程之后', () => {
  const section = {
    title: 'CS2 2026-11-26 赛程', timeZone: 'Asia/Shanghai', matchCount: 2,
    markdown: '# 📅 CS2 2026-11-26 赛程 · 共 2 场\n时区：Asia/Shanghai\n\n## PGL Major Singapore 2026 · Valve Tier：Major\n- 14:00｜HEROIC ⚔ FaZe Clan · Bo3\n- 19:00｜Imperial Esports ⚔ Team Liquid · Bo3\n\n---\n数据来源：Liquipedia',
    sourceUrl: 'https://liquipedia.net/counterstrike/PGL_Major_Singapore_2026',
  }
  const prompt = composeCs2ServiceTurnPrompt(section, DEFAULT_CS2_DIGEST_TEMPLATE, undefined)
  assert.match(prompt, /# 📅 CS2 2026-11-26 赛程 · 共 2 场\n时区：Asia\/Shanghai/)
  assert.match(prompt, /## PGL Major Singapore 2026 · Valve Tier：Major\n- 14:00｜HEROIC ⚔ FaZe Clan · Bo3/)
  assert.ok(prompt.indexOf('## 赛事看点') > prompt.indexOf('Imperial Esports ⚔ Team Liquid'))
  assert.doesNotMatch(prompt, /## 赛程总览|共 2 场 · Valve Tier/)
})

test('AI 看点可搜索近 30 天信息并核实战队、积分和晋级影响', () => {
  const section = { title: 'CS2 2026-11-26 赛程', markdown: '# CS2 2026-11-26 赛程\n- HEROIC ⚔ FaZe Clan\n---\n数据来源：Liquipedia' }
  const prompt = composeCs2ServiceTurnPrompt(section, DEFAULT_CS2_DIGEST_TEMPLATE, undefined)
  assert.match(prompt, /tools\/search/)
  assert.match(prompt, /tools\/fetch/)
  assert.match(prompt, /检索.*原始页面.*核实/)
  assert.doesNotMatch(prompt, /search_tool|web_search/)
  assert.match(prompt, /过去 30 天/)
  assert.match(prompt, /战队.*选手.*对阵/)
  assert.match(prompt, /Valve.*排名.*积分/)
  assert.match(prompt, /晋级条件.*后续大赛.*参赛资格/)
  assert.match(prompt, /官方.*规则.*来源链接/)
  assert.match(prompt, /查不到.*不要推断/)
  assert.match(prompt, /1–4 条/)
  assert.doesNotMatch(prompt, /不要自行联网补充|仅根据本次提供的赛事数据/)
})

test('赛果看点可用已核实的近期资料，但不把搜索摘要当成已确认赛况', () => {
  const section = { title: 'Test Cup', markdown: '# 🏁 已确认赛果｜Test Cup\nTeam A 2 : 1 Team B\n\n---\n数据来源：Liquipedia' }
  const prompt = composeCs2ServiceTurnPrompt(section, DEFAULT_CS2_RESULT_TEMPLATE,
    { teamA: 'Team A', teamB: 'Team B', scoreA: 2, scoreB: 1 }, 'result')
  assert.match(prompt, /tools\/search/)
  assert.match(prompt, /tools\/fetch/)
  assert.match(prompt, /已确认的赛果：Team A 2:1 Team B/)
  assert.match(prompt, /比赛过程.*核实/)
  assert.match(prompt, /不得把.*搜索.*未确认.*事实/)
  assert.match(prompt, /1–4 条赛果看点/)
})

function runtimeAt(path) {
  return createFeatureRuntime({ ctx: { get: () => undefined }, statePath: path })
}

test('旧配置默认不筛 Valve Tier，新配置保存独立的 Valve Tier 选项', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-valve-tier-')), 'state.json')
  writeFileSync(path, JSON.stringify({ features: { 'cs2-matches': { enabled: false, values: { teams: [], tiers: ['S'] } } } }), 'utf8')
  const runtime = runtimeAt(path)
  const before = (await runtime.snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.deepEqual(before.values.valveTiers ?? [], [])
  await runtime.save('cs2-matches', { ...before, values: { ...before.values, valveTiers: ['Major', 'Tier 2', 'invalid'] } })
  const after = (await runtime.snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.deepEqual(after.values.tiers, ['S'])
  assert.deepEqual(after.values.valveTiers, ['Major', 'Tier 2'])
})

test('旧 CS2 配置默认固定内容，模板与全局投递方式可保存并重新读取', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-template-')), 'state.json')
  writeFileSync(path, JSON.stringify({ features: { 'cs2-matches': { enabled: false, values: { teams: [], tiers: [] } } } }), 'utf8')
  const runtime = runtimeAt(path)
  const before = (await runtime.snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.equal(before.deliveryMode, 'direct')
  assert.equal(before.noticeMode, 'daily-digest')
  assert.deepEqual((await runtime.snapshot()).settings, { deliveryMethod: 'service-turn', defaultTargetSessionIds: [], requestTimeoutSeconds: 30 })
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
