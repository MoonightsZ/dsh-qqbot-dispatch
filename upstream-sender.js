import { assertGroupAvailable, isUnavailableGroupError } from './group-health.js'

const REGISTRY_KEY = Symbol.for('dsh-qqbot-dispatch.upstream-markdown-sender')

/** Capture the SDK instance used by the upstream QQ Bot without replacing its send method. */
export function createUpstreamSender({ QQBot, resolver, groupHealth }) {
  const prototype = QQBot?.prototype
  if (typeof prototype?.handleInboundMessage !== 'function') throw new Error('上游 QQ Bot 不支持入站实例捕获')
  const registry = globalThis[REGISTRY_KEY] ??= new WeakMap()
  let entry = registry.get(prototype)
  if (entry === undefined) {
    const original = prototype.handleInboundMessage
    entry = { original, wrapper: null, bot: null, users: 0 }
    entry.wrapper = function dispatchCaptureInbound(...args) {
      entry.bot = this
      return entry.original.apply(this, args)
    }
    prototype.handleInboundMessage = entry.wrapper
    registry.set(prototype, entry)
  }
  entry.users += 1
  let disposed = false

  async function send({ sessionId, text }) {
    if (disposed) throw new Error('上游 QQ Bot 发送器已停止')
    if (typeof text !== 'string' || text.trim() === '') throw new Error('发送内容不能为空')
    const peer = resolver.knownPeers().find((item) => item.sessionId === sessionId)
    if (peer === undefined) throw new Error('目标会话不在 QQ Bot 映射中')
    assertGroupAvailable(groupHealth, peer)
    const bot = entry.bot
    if (typeof bot?.sendMarkdown !== 'function') throw new Error('尚未取得 QQ Bot 实例，请先在 QQ 会话发送一条消息')
    try {
      await bot.sendMarkdown({ scope: peer.scope, targetId: peer.peerId }, text)
    } catch (error) {
      if (isUnavailableGroupError(error)) groupHealth?.markUnavailable(peer, String(error?.message ?? error))
      throw error
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    entry.users -= 1
    if (entry.users === 0 && prototype.handleInboundMessage === entry.wrapper) {
      prototype.handleInboundMessage = entry.original
      registry.delete(prototype)
    }
  }

  return { send, dispose }
}
