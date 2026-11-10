import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFeatureRuntime } from '../features.js'

function runtimeAt(path) {
  return createFeatureRuntime({ ctx: { get: () => undefined }, statePath: path })
}

test('全局默认目标用于未覆盖的模组，已有独立目标保持不变', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-default-target-')), 'state.json')
  writeFileSync(path, JSON.stringify({
    settings: { deliveryMethod: 'service-turn' },
    features: { 'cs2-matches': { target: { sessionId: 'cs2-old' } } },
  }), 'utf8')
  const runtime = runtimeAt(path)
  const initial = await runtime.snapshot()
  assert.equal(initial.settings.defaultTargetSessionId, '')
  assert.equal(initial.features.find((item) => item.id === 'cs2-matches').target.sessionId, 'cs2-old')

  runtime.saveSettings({ defaultTargetSessionId: 'shared-group' })
  const restored = runtimeAt(path)
  const snapshot = await restored.snapshot()
  assert.deepEqual(snapshot.settings, { deliveryMethod: 'service-turn', defaultTargetSessionId: 'shared-group' })
  assert.equal(snapshot.features.find((item) => item.id === 'cs2-matches').target.sessionId, 'cs2-old')
  assert.equal(snapshot.features.find((item) => item.id === 'casual-chat').target.sessionId, '')

  const targets = []
  for (const id of ['cs2-matches', 'casual-chat']) {
    restored.registerProvider(id, async ({ target }) => { targets.push([id, target.sessionId]); return { matched: 1, sent: 1 } })
  }
  await restored.run('cs2-matches', { manual: true })
  await restored.run('casual-chat', { manual: true })
  assert.deepEqual(targets, [['cs2-matches', 'cs2-old'], ['casual-chat', 'shared-group']])
})

test('全局投递方式和默认目标可独立更新，清空后继承模组不发送', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-default-target-')), 'state.json')
  const runtime = runtimeAt(path)
  runtime.saveSettings({ defaultTargetSessionId: 'shared-group' })
  runtime.saveSettings({ deliveryMethod: 'upstream-sdk' })
  assert.deepEqual((await runtime.snapshot()).settings, { deliveryMethod: 'upstream-sdk', defaultTargetSessionId: 'shared-group' })
  runtime.saveSettings({ defaultTargetSessionId: '' })
  let called = false
  runtime.registerProvider('casual-chat', async () => { called = true; return { matched: 1, sent: 1 } })
  const result = await runtime.run('casual-chat', { manual: true })
  assert.match(result.error, /未选择目标会话/)
  assert.equal(called, false)
  assert.equal((await runtime.snapshot()).settings.deliveryMethod, 'upstream-sdk')
})

test('已启用模组依赖全局默认目标时禁止清空', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-default-target-')), 'state.json')
  const runtime = runtimeAt(path)
  runtime.saveSettings({ defaultTargetSessionId: 'shared-group' })
  await runtime.save('casual-chat', { enabled: true, target: { sessionId: '' }, source: { id: 'none' }, values: {} })
  assert.throws(() => runtime.saveSettings({ defaultTargetSessionId: '' }), /已启用的模组/)
  assert.equal((await runtime.snapshot()).settings.defaultTargetSessionId, 'shared-group')
})

test('没有全局默认目标时不能启用无独立目标的模组', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-default-target-')), 'state.json')
  const runtime = runtimeAt(path)
  await assert.rejects(runtime.save('casual-chat', { enabled: true, target: { sessionId: '' }, source: { id: 'none' }, values: {} }), /目标会话/)
  assert.equal((await runtime.snapshot()).features.find((item) => item.id === 'casual-chat').enabled, false)
})

test('已移除模组的旧状态不妨碍清空默认目标', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-default-target-')), 'state.json')
  writeFileSync(path, JSON.stringify({
    settings: { deliveryMethod: 'service-turn', defaultTargetSessionId: 'shared-group' },
    features: { 'removed-module': { enabled: true, target: { sessionId: '' } } },
  }), 'utf8')
  const runtime = runtimeAt(path)
  runtime.saveSettings({ defaultTargetSessionId: '' })
  assert.equal((await runtime.snapshot()).settings.defaultTargetSessionId, '')
})
