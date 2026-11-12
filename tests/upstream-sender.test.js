import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createUpstreamSender } from '../upstream-sender.js'

test('从上游入站实例发送 Markdown，未取得实例时明确失败', async () => {
  const sent = []
  class QQBot {
    async handleInboundMessage(raw) { return raw }
    async sendMarkdown(target, text) { sent.push({ target, text }) }
  }
  const original = QQBot.prototype.handleInboundMessage
  const sender = createUpstreamSender({
    QQBot,
    resolver: { knownPeers: () => [{ sessionId: 'session-1', scope: 'group', peerId: 'group-openid' }] },
  })
  await assert.rejects(sender.send({ sessionId: 'session-1', text: '# 通知' }), /尚未取得 QQ Bot 实例/)
  const bot = new QQBot()
  assert.deepEqual(await bot.handleInboundMessage({ kind: 'group' }), { kind: 'group' })
  await sender.send({ sessionId: 'session-1', text: '# 通知' })
  assert.deepEqual(sent, [{ target: { scope: 'group', targetId: 'group-openid' }, text: '# 通知' }])
  sender.dispose()
  assert.equal(QQBot.prototype.handleInboundMessage, original)
})

test('已映射的私聊会话按 c2c 目标发送', async () => {
  const sent = []
  class QQBot {
    async handleInboundMessage(raw) { return raw }
    async sendMarkdown(target, body) { sent.push({ target, body }) }
  }
  const sender = createUpstreamSender({ QQBot,
    resolver: { knownPeers: () => [{ sessionId: 'private-one', scope: 'c2c', peerId: 'user-openid' }] } })
  await new QQBot().handleInboundMessage({ kind: 'c2c' })
  await sender.send({ sessionId: 'private-one', text: '私聊通知' })
  assert.deepEqual(sent, [{ target: { scope: 'c2c', targetId: 'user-openid' }, body: '私聊通知' }])
  sender.dispose()
})
