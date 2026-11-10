import assert from 'node:assert/strict'
import { test } from 'node:test'
import { featureTargetOptions, sessionTargetOptions } from '../client/session-options.js'

test('目标选项优先展示群名并标明会话类型', () => {
  const result = sessionTargetOptions([
    { sessionId: 'session-123456789', title: '旧标题', groupName: '赛事群', scope: 'group' },
    { sessionId: 'session-987654321', title: '私聊标题', scope: 'c2c' },
  ], 'session-123456789')
  assert.deepEqual(result.options, [
    { value: 'session-123456789', label: '赛事群 · 群聊 · 23456789', disabled: false },
    { value: 'session-987654321', label: '私聊标题 · 私聊 · 87654321', disabled: false },
  ])
  assert.equal(result.invalidSelected, false)
})

test('失效的已选会话保留显示但不可重新选用', () => {
  const result = sessionTargetOptions([], 'session-old')
  assert.deepEqual(result.options, [{ value: 'session-old', label: '已失效 · sion-old', disabled: true }])
  assert.equal(result.invalidSelected, true)
  assert.equal(result.unavailableSelected, false)
})

test('已确认不可用的群不进入下拉选项', () => {
  const result = sessionTargetOptions([
    { sessionId: 'session-dead', scope: 'group', groupStatus: 'unavailable', title: '旧群' },
    { sessionId: 'session-live', scope: 'group', title: '新群' },
  ], 'session-dead')
  assert.equal(result.invalidSelected, true)
  assert.equal(result.unavailableSelected, true)
  assert.deepEqual(result.options.map((option) => option.value), ['session-live', 'session-dead'])
  assert.equal(result.options[1].disabled, true)
})

test('模组留空时继承全局目标，并识别全局目标失效', () => {
  const sessions = [{ sessionId: 'session-shared', scope: 'group', title: '通知群' }]
  const inherited = featureTargetOptions(sessions, '', 'session-shared')
  assert.equal(inherited.effectiveSessionId, 'session-shared')
  assert.equal(inherited.defaultLabel, '通知群 · 群聊 · n-shared')
  assert.equal(inherited.invalidSelected, false)
  assert.equal(featureTargetOptions(sessions, 'session-own', 'session-shared').effectiveSessionId, 'session-own')
  assert.equal(featureTargetOptions(sessions, '', 'session-gone').invalidSelected, true)
  assert.match(featureTargetOptions(sessions, 'session-shared', 'session-gone').defaultLabel, /已失效/)
})
