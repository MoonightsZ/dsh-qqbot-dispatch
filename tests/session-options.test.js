import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sessionTargetOptions } from '../client/session-options.js'

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
})
