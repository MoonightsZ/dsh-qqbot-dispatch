import { assertGroupAvailable, isUnavailableGroupError } from './group-health.js'

function describeFailure(error) {
  const code = error?.code ?? error?.name
  const message = error instanceof Error ? error.message : String(error)
  return code === undefined ? message : `${code}: ${message}`
}

export function createFeatureDelivery(_groupNames, { resolver, groupHealth, qqbotApi, loadOptionalPatches, serviceTurn }) {
  /**
   * Deliver one feature message: straight to the QQ group when its openid is
   * known, otherwise as a plugin service turn in the target Session.
   */
  async function deliverFeatureMessage({ target, text, markdown, card }) {
    const peer = resolver?.knownPeers().find((entry) => entry.scope === 'group' && entry.sessionId === target.sessionId)
    assertGroupAvailable(groupHealth, peer)
    const openid = peer?.peerId
    if (openid !== undefined) {
      const credentials = await qqbotApi.readQqbotCredentials(loadOptionalPatches)
      if (credentials !== undefined) {
        try {
          const warnings = []
          let channel = 'qq'
          if (card !== undefined && card !== null) {
            try {
              await qqbotApi.sendGroupCard(openid, card, credentials)
              channel = 'qq-card'
            } catch (error) {
              if (error?.code === 40034100 || isUnavailableGroupError(error)) throw error
              warnings.push(`卡片未发送：${describeFailure(error)}`)
            }
          }
          if (typeof markdown === 'string' && markdown !== '') {
            try {
              await qqbotApi.sendGroupMarkdown(openid, markdown, credentials)
              return { channel: channel === 'qq-card' ? 'qq-card+md' : 'qq-md', ...(warnings.length === 0 ? {} : { warning: warnings.join('；') }) }
            } catch (error) {
              if (error?.code === 40034100 || isUnavailableGroupError(error)) throw error
              warnings.push(`Markdown 未发送：${describeFailure(error)}`)
            }
          }
          await qqbotApi.sendGroupText(openid, text, credentials)
          return { channel, ...(warnings.length === 0 ? {} : { warning: warnings.join('；') }) }
        } catch (error) {
          if (isUnavailableGroupError(error)) {
            groupHealth?.markUnavailable(peer, describeFailure(error))
            throw new Error('群不可用（可能已解散或机器人已退出），已暂停通知', { cause: error })
          }
          const reason = error?.code === 40034100
            ? 'QQ 主动消息发送受限（40034100：频率过高或对方关闭了主动消息）'
            : describeFailure(error)
          await serviceTurn.dispatch({ sessionId: target.sessionId, text })
          return { channel: 'service-turn', warning: `${reason}；已提交服務回合，QQ 送達待確認` }
        }
      }
    }
    await serviceTurn.dispatch({ sessionId: target.sessionId, text })
    return { channel: 'service-turn' }
  }


  return deliverFeatureMessage
}
