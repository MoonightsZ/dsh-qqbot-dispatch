import { sessionDisplayName } from './session-options.js'

/** Summarize per-session submissions without claiming QQ delivery. */
export function summarizeTargetResults(result, sessions = []) {
  const items = Array.isArray(result?.targetResults) ? result.targetResults : []
  const failed = items.filter((item) => item.error)
  const failureText = failed.slice(0, 3).map((item) => {
    const session = sessions.find((row) => row.sessionId === item.sessionId)
    const name = session ? sessionDisplayName(session) : item.sessionId.slice(-8)
    const type = session?.scope === 'group' ? '群聊' : session?.scope === 'c2c' ? '私聊' : '会话'
    return `${name}（${type}）：${item.error}`
  }).join('；') + (failed.length > 3 ? `；另有 ${failed.length - 3} 个目标失败` : '')
  return { total: items.length, succeeded: items.length - failed.length, failed: failed.length, failureText }
}
