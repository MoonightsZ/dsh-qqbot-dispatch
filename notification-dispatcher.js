/** Select the plugin-wide QQ notification transport for every feature module. */
export function createNotificationDispatcher({ serviceTurn, upstreamSender }) {
  async function dispatch({ settings, sessionId, servicePrompt, markdown }) {
    if (settings?.deliveryMethod === 'upstream-sdk') {
      if (typeof upstreamSender?.send !== 'function') throw new Error('上游 QQ Bot 发送器不可用')
      await upstreamSender.send({ sessionId, text: markdown })
      return { channel: 'qq-sdk' }
    }
    if (typeof serviceTurn?.dispatch !== 'function') throw new Error('服务回合投递不可用')
    await serviceTurn.dispatch({ sessionId, text: typeof servicePrompt === 'function' ? servicePrompt() : servicePrompt })
    return { channel: 'service-turn' }
  }
  return { dispatch }
}
