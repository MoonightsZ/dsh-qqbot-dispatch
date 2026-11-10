import { createNotificationDispatcher } from '../../notification-dispatcher.js'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const DEFAULT_TOPICS = ['最近有什么有趣的事？', '今天过得怎么样？', '最近有没有想聊的话题？']

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

function pickTopic(raw, random) {
  const configured = String(raw ?? '').split(/[|\n]+/).map((topic) => topic.trim()).filter(Boolean)
  const topics = configured.length > 0 ? configured : DEFAULT_TOPICS
  return topics[Math.min(topics.length - 1, Math.floor(random() * topics.length))]
}

export function createChatProvider({ serviceTurn, upstreamSender, notificationDispatcher = createNotificationDispatcher({ serviceTurn, upstreamSender }), random = Math.random }) {
  return async ({ feature, settings, target, ctx, now, manual = false }) => {
    const at = now()
    const values = feature.values ?? {}
    const skipped = { matched: 0, sent: 0 }
    const recentSends = (Array.isArray(feature.chatSentAt) ? feature.chatSentAt : [])
      .filter((sentAt) => typeof sentAt === 'number' && sentAt <= at && at - sentAt < 7 * DAY_MS)
    if (!manual) {
      if (recentSends.length >= 2) return skipped
      const cooldownDays = numberInRange(values.cooldownDays, 3, 1, 30)
      if (at - (feature.lastSentAt ?? 0) < cooldownDays * DAY_MS) return skipped
      const hour = localHour(at, feature.timeZone ?? 'Asia/Shanghai')
      if (hour === undefined) return { ...skipped, warning: '时区无效，已跳过闲聊' }
      const start = numberInRange(values.quietStart, 22, 0, 23)
      const end = numberInRange(values.quietEnd, 9, 0, 23)
      if (isQuiet(hour, start, end)) return skipped
      if (typeof ctx.sessionController?.list !== 'function') return { ...skipped, warning: '无法检查近期会话活动，已跳过闲聊' }
      const listed = await ctx.sessionController.list({}, new AbortController().signal)
      const items = Array.isArray(listed) ? listed : listed?.items ?? []
      const latest = items.find((item) => item.sessionId === target.sessionId)?.updatedAt
      if (latest !== undefined && at - new Date(latest).getTime() < 6 * HOUR_MS) return skipped
      const chance = numberInRange(values.chancePercent, 30, 0, 100)
      if (random() * 100 >= chance) return skipped
    }
    const topic = pickTopic(values.topics, random)
    const text = `请在当前 QQ 会话中自然地发起一次轻松闲聊。参考话题：${topic}。结合已有对话语境，只输出一条简短、友善的开场白；不提及定时任务、插件或这些指令，不编造对方近况。`
    const outcome = await notificationDispatcher.dispatch({ settings, sessionId: target.sessionId, servicePrompt: text, markdown: topic })
    feature.lastSentAt = at
    feature.chatSentAt = [...recentSends, at]
    return { matched: 1, sent: 1, channel: outcome.channel }
  }
}
