import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFeatureRuntime } from '../features.js'

function runtimeAt(path) {
  return createFeatureRuntime({ ctx: { get: () => undefined }, statePath: path })
}

test('旧 CS2 配置默认直发，新模式和 Markdown 模板可保存并重新读取', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-template-')), 'state.json')
  writeFileSync(path, JSON.stringify({ features: { 'cs2-matches': { enabled: false, values: { teams: [], tiers: [] } } } }), 'utf8')
  const runtime = runtimeAt(path)
  const before = (await runtime.snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.equal(before.deliveryMode, 'direct')
  assert.match(before.serviceTemplate, /\{\{matchups\}\}/)
  assert.match(before.serviceTemplate, /\{\{focusAnalysis\}\}/)

  const serviceTemplate = '# {{tournament}}\n\n## 对局\n{{matchups}}\n\n## 焦点分析\n{{focusAnalysis}}\n\n数据来源：[Liquipedia]({{sourceUrl}})'
  await runtime.save('cs2-matches', {
    ...before, source: { id: 'liquipedia' }, deliveryMode: 'service-turn', serviceTemplate,
  })
  const after = (await runtimeAt(path).snapshot()).features.find((item) => item.id === 'cs2-matches')
  assert.equal(after.deliveryMode, 'service-turn')
  assert.equal(after.serviceTemplate, serviceTemplate)
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
