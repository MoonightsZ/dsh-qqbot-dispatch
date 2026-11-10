import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNotificationDispatcher } from '../notification-dispatcher.js'

test('全局投递策略只执行被选中的发送路径', async () => {
  const calls = []
  const dispatcher = createNotificationDispatcher({
    serviceTurn: { dispatch: async (value) => calls.push(['turn', value]) },
    upstreamSender: { send: async (value) => calls.push(['sdk', value]) },
  })
  let promptCalls = 0
  await dispatcher.dispatch({ settings: { deliveryMethod: 'upstream-sdk' }, sessionId: 's', markdown: '# 通知', servicePrompt: () => { promptCalls++; return '提示词' } })
  assert.equal(promptCalls, 0)
  await dispatcher.dispatch({ settings: { deliveryMethod: 'service-turn' }, sessionId: 's', markdown: '# 通知', servicePrompt: () => { promptCalls++; return '提示词' } })
  assert.equal(promptCalls, 1)
  assert.deepEqual(calls, [['sdk', { sessionId: 's', text: '# 通知' }], ['turn', { sessionId: 's', text: '提示词' }]])
})
