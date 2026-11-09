/** Submit a notification as this plugin's own service turn, including cold Sessions. */
export function createServiceTurnDispatcher(ctx, { resolver, createUserMessage }) {
  async function dispatch({ sessionId, text }) {
    if (typeof sessionId !== 'string' || sessionId.trim() === '') throw new Error('缺少目標 sessionId')
    if (typeof text !== 'string' || text.trim() === '') throw new Error('服務回合內容不可為空')
    if (!resolver.knownPeers().some((peer) => peer.sessionId === sessionId)) {
      throw new Error(`會話 ${sessionId} 未在 QQ Bot 映射中記錄，無法確認 QQ 對象`)
    }
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if (resolved?.error !== undefined) throw resolved.error
    const agent = resolved?.agent
    if (typeof agent?.followup !== 'function') throw new Error(`無法恢復會話 ${sessionId} 的 Agent`)
    await agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'plugin:dsh-qqbot-dispatch' },
    }))
    if (!await ctx.sessions.flush(agent.session)) {
      throw new Error(`會話 ${sessionId} 持久化未確認，服務回合提交狀態未知`)
    }
  }

  return { dispatch }
}
