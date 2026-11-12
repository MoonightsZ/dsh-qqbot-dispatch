import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeTargetResults } from '../client/target-results.js'

test('部分成功时显示目标数量与失败会话名称', () => {
  const summary = summarizeTargetResults({ targetResults: [
    { sessionId: 'group-one', sent: 2, error: '' },
    { sessionId: 'private-two', sent: 0, error: '发送失败' },
  ] }, [{ sessionId: 'private-two', title: '小明', scope: 'c2c' }])
  assert.deepEqual(summary, { total: 2, succeeded: 1, failed: 1, failureText: '小明（私聊）：发送失败' })
})
