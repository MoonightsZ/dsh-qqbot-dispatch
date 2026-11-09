import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServiceTurnDispatcher } from '../service-turn.js'

test('恢復休眠 Agent 並提交帶插件來源的服務回合', async () => {
  const calls = []
  const agent = { session: { id: 'session-123' }, followup: async (message) => { calls.push(['followup', message]) } }
  const ctx = {
    sessionController: { resolveAgent: async (id) => { calls.push(['resolve', id]); return { agent } } },
    sessions: { flush: async (session) => { calls.push(['flush', session]); return true } },
  }
  const resolver = { knownPeers: () => [{ sessionId: 'session-123', scope: 'group', peerId: 'openid' }] }
  const createUserMessage = (data) => ({ id: 'message-1', role: 'user', ...data })
  const dispatcher = createServiceTurnDispatcher(ctx, { resolver, createUserMessage })
  await dispatcher.dispatch({ sessionId: 'session-123', text: '賽事提醒' })
  assert.deepEqual(calls, [
    ['resolve', 'session-123'],
    ['followup', { id: 'message-1', role: 'user', content: [{ type: 'text', text: '賽事提醒' }], source: { kind: 'plugin:dsh-qqbot-dispatch' } }],
    ['flush', agent.session],
  ])
})

test('未在上游映射中記錄的會話不可提交服務回合', async () => {
  let resolved = false
  const ctx = { sessionController: { resolveAgent: async () => { resolved = true } }, sessions: { flush: async () => {} } }
  const dispatcher = createServiceTurnDispatcher(ctx, { resolver: { knownPeers: () => [] }, createUserMessage: (data) => data })
  await assert.rejects(dispatcher.dispatch({ sessionId: 'derived-id', text: '提醒' }), /未在 QQ Bot 映射中記錄/)
  assert.equal(resolved, false)
})

test('無法恢復 Agent 時不標記服務回合為已提交', async () => {
  const ctx = { sessionController: { resolveAgent: async () => ({ error: new Error('missing session') }) }, sessions: { flush: async () => {} } }
  const dispatcher = createServiceTurnDispatcher(ctx, { resolver: { knownPeers: () => [{ sessionId: 'session-123' }] }, createUserMessage: (data) => data })
  await assert.rejects(dispatcher.dispatch({ sessionId: 'session-123', text: '提醒' }), /missing session/)
})

test('會話持久化未確認時回報提交失敗', async () => {
  const ctx = {
    sessionController: { resolveAgent: async () => ({ agent: { session: {}, followup: () => {} } }) },
    sessions: { flush: async () => false },
  }
  const dispatcher = createServiceTurnDispatcher(ctx, { resolver: { knownPeers: () => [{ sessionId: 'session-123' }] }, createUserMessage: (data) => data })
  await assert.rejects(dispatcher.dispatch({ sessionId: 'session-123', text: '提醒' }), /持久化未確認/)
})
