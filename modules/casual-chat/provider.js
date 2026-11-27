import { createNotificationDispatcher } from '../../notification-dispatcher.js'
import { pickTopic } from './topics.js'

const HOUR_MS = 3_600_000

function numberInRange(value, fallback, min, max) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function localHour(at, timeZone) {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date(at)))
  } catch {
    return undefined
  }
}

function isQuiet(hour, start, end) {
  if (start === end) return false
  return start < end ? hour >= start && hour < end : hour >= start || hour < end
}

export function createChatProvider({ serviceTurn, upstreamSender, resolver, notificationDispatcher = createNotificationDispatcher({ serviceTurn, upstreamSender }), random = Math.random }) {
  return async ({ feature, settings, target, now, manual = false }) => {
    const at = now()
    const values = feature.values ?? {}
    const skipped = { matched: 0, sent: 0 }
    if (resolver) {
      const peer = resolver.knownPeers().find((item) => item.sessionId === target.sessionId)
      if (peer?.scope !== 'group') return { ...skipped, warning: '偶尔闲聊仅支持群聊，已跳过非群聊目标' }
    }
    if (!manual) {
      const cooldownHours = numberInRange(values.cooldownHours, 72, 1, 720)
      if (at - (feature.lastSentAt ?? 0) < cooldownHours * HOUR_MS) return skipped
      const hour = localHour(at, feature.timeZone ?? 'Asia/Shanghai')
      if (hour === undefined) return { ...skipped, warning: '时区无效，已跳过闲聊' }
      const start = numberInRange(values.quietStart, 22, 0, 23)
      const end = numberInRange(values.quietEnd, 9, 0, 23)
      if (isQuiet(hour, start, end)) return skipped
      const chance = numberInRange(values.chancePercent, 30, 0, 100)
      if (random() * 100 >= chance) return skipped
    }
    const topic = pickTopic(values.topics, feature.lastTopicId, random)
    if (settings?.deliveryMethod === 'upstream-sdk' && topic === null) return { ...skipped, warning: '备用话题池没有启用的话题，已跳过直接发送' }
    const interestHint = String(values.interestHint ?? '').trim().slice(0, 120)
    const avoidHint = String(values.avoidHint ?? '').trim().slice(0, 120)
    const text = [
      '请在当前 QQ 群自然地发起一次轻松闲聊。先参考本会话可见的最近群聊，优先延续群友已经讨论、适合公开接续的话题。',
      '如果最近群聊没有合适内容，且 web_search 可用，先调用 web_search 检索与本群兴趣相关的近期公开话题，再提出一个简短问题；搜索不可用或结果不可靠时使用备用话题或一般性问题。',
      '不要把群成员原话、姓名、OpenID、私聊或附件内容作为搜索词；不要编造新闻、比赛结果或个人近况。避免重复最近的开场白。',
      interestHint ? `群聊兴趣方向：${interestHint}` : '',
      avoidHint ? `避谈内容：${avoidHint}` : '',
      topic ? `备用话题（仅在缺少适合的群聊或搜索内容时参考）：${topic.text}` : '',
      '只输出一条简短、友善的开场白；不要提及搜索工具、定时任务、插件或这些指令。',
    ].filter(Boolean).join('\n')
    const outcome = await notificationDispatcher.dispatch({ settings, sessionId: target.sessionId, servicePrompt: text, markdown: topic?.text })
    feature.lastSentAt = at
    if (outcome.channel === 'qq-sdk' && topic) feature.lastTopicId = topic.id
    return { matched: 1, sent: 1, channel: outcome.channel }
  }
}
