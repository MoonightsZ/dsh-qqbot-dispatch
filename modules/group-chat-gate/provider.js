/** Realtime inbound gate for unmentioned QQ group messages. */
const MAX_GROUPS = 200
const FILLERS = new Set([...'嗯哦啊哈嘿额呃好行对是这那吧呢呀嘛噢喔哎诶欸'])

function number(value, fallback, min, max) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function configOf(feature) {
  const values = feature?.values ?? {}
  return {
    enabled: feature?.enabled === true,
    chance: number(values.chancePercent, 30, 0, 100) / 100,
    debounceMs: number(values.debounceSeconds, 30, 0, 300) * 1000,
    backlogMax: number(values.backlogMax, 30, 0, 100),
    minIntervalMs: number(values.minIntervalSeconds, 0, 0, 86400) * 1000,
    maxPerHour: number(values.maxPerHour, 0, 0, 1000),
    maxPerDay: number(values.maxPerDay, 0, 0, 10000),
    filterInvalid: values.filterInvalid !== 'false',
  }
}

function cleanText(content) {
  return String(content ?? '').replace(/<faceType=[^>]*>/gi, ' ').replace(/<@!?[^>]*>/g, ' ')
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '').trim()
}

function invalid(text) {
  if (text === '' || [...text].length < 2) return true
  if (/^[\s\p{P}\p{S}]+$/u.test(text)) return true
  const chars = [...text.replace(/\s+/g, '')]
  if (chars.length <= 8 && chars.every((char) => char === chars[0])) return true
  const meaningful = [...text.replace(/[\s\p{P}\p{S}]/gu, '')]
  return meaningful.length > 0 && meaningful.every((char) => FILLERS.has(char))
}

function mentioned(raw, bot) {
  if (raw.rawEventType === 'GROUP_AT_MESSAGE_CREATE') return true
  const ids = new Set([bot?.appId, bot?.creds?.appId].filter(Boolean).map(String))
  if (Array.isArray(raw.mentions) && raw.mentions.some((item) => item?.is_you === true ||
    [item?.id, item?.member_openid, item?.user_openid].some((id) => id && ids.has(String(id))))) return true
  return [...String(raw.content ?? '').matchAll(/<@!?([^>]{1,64})>/g)].some((match) => ids.has(match[1]))
}

/** Install one wrapper; update() applies saved settings without adding another wrapper. */
export function createGroupChatGate({ QQBot, feature, now = Date.now, random = Math.random,
  setTimer = setTimeout, clearTimer = clearTimeout, onError = () => {} }) {
  const prototype = QQBot?.prototype
  if (typeof prototype?.handleInboundMessage !== 'function') throw new Error('上游 QQ Bot 不支持群聊入站频控')
  const original = prototype.handleInboundMessage
  let config = configOf(feature)
  let disposed = false
  const groups = new Map()

  function trimGroups() {
    while (groups.size > MAX_GROUPS) {
      const [key, state] = groups.entries().next().value
      if (state.timer) clearTimer(state.timer)
      groups.delete(key)
    }
  }

  function groupState(key) {
    let state = groups.get(key)
    if (!state) {
      state = { pending: [], backlog: [], timer: null, lastBot: null, lastRaw: null,
        lastForwardedAt: 0, hourKey: -1, dayKey: '', hourly: 0, daily: 0 }
      groups.set(key, state)
      trimGroups()
    } else {
      groups.delete(key)
      groups.set(key, state)
    }
    return state
  }

  function appendBacklog(state, lines) {
    if (config.backlogMax === 0) return
    state.backlog.push(...lines)
    if (state.backlog.length > config.backlogMax) state.backlog.splice(0, state.backlog.length - config.backlogMax)
  }

  function currentCounts(state, at) {
    const hourKey = Math.floor(at / 3_600_000)
    const dayKey = new Date(at).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
    if (state.hourKey !== hourKey) { state.hourKey = hourKey; state.hourly = 0 }
    if (state.dayKey !== dayKey) { state.dayKey = dayKey; state.daily = 0 }
  }

  function allowed(state, at) {
    currentCounts(state, at)
    return !(config.minIntervalMs > 0 && state.lastForwardedAt > 0 && at - state.lastForwardedAt < config.minIntervalMs) &&
      !(config.maxPerHour > 0 && state.hourly >= config.maxPerHour) &&
      !(config.maxPerDay > 0 && state.daily >= config.maxPerDay)
  }

  function forward(state, lines, bot, raw) {
    if (disposed || !config.enabled || lines.length === 0) return
    const at = now()
    if (!allowed(state, at) || random() >= config.chance) {
      appendBacklog(state, lines)
      return
    }
    const merged = [...state.backlog, ...lines]
    state.backlog = []
    state.lastForwardedAt = at
    state.hourly += 1
    state.daily += 1
    const content = merged.length === 1 ? merged[0] : merged.join('\n')
    Promise.resolve().then(() => original.call(bot, { ...raw, content })).catch(onError)
  }

  function flush(key) {
    const state = groups.get(key)
    if (!state || state.pending.length === 0) return
    state.timer = null
    const lines = state.pending.splice(0)
    forward(state, lines, state.lastBot, state.lastRaw)
  }

  const wrapper = function groupChatGateInbound(raw) {
    const expands = globalThis[Symbol.for('@local/dsh-qqbot-expands/registry')]
    if (expands?.controller?.rt?.cfg?.gate?.enabled === true) return original.call(this, raw)
    if (disposed || !config.enabled || raw?.kind !== 'group' || !raw.groupOpenid ||
      mentioned(raw, this) || (Array.isArray(raw.attachments) && raw.attachments.length > 0)) {
      if (!disposed && config.enabled && raw?.kind === 'group' && raw.groupOpenid && mentioned(raw, this)) {
        const state = groups.get(String(raw.groupOpenid))
        if (state) {
          if (state.timer) clearTimer(state.timer)
          state.timer = null
          const context = [...state.backlog, ...state.pending]
          state.backlog = []
          state.pending = []
          if (context.length > 0) raw = { ...raw, content: `[近期群聊]\n${context.join('\n')}\n[当前消息]\n${raw.content ?? ''}` }
        }
      }
      return original.call(this, raw)
    }
    const text = cleanText(raw.content)
    if (config.filterInvalid && invalid(text)) return undefined
    const key = String(raw.groupOpenid)
    const state = groupState(key)
    state.pending.push(`[${String(raw.senderName ?? raw.senderId ?? '成员').slice(0, 40)}] ${text}`)
    if (state.pending.length > config.backlogMax + 100) state.pending.splice(0, state.pending.length - config.backlogMax - 100)
    state.lastBot = this
    state.lastRaw = raw
    if (state.timer) clearTimer(state.timer)
    if (config.debounceMs === 0) queueMicrotask(() => flush(key))
    else {
      state.timer = setTimer(() => flush(key), config.debounceMs)
      state.timer?.unref?.()
    }
    return undefined
  }
  prototype.handleInboundMessage = wrapper

  function update(feature) {
    config = configOf(feature)
    if (!config.enabled) {
      for (const state of groups.values()) if (state.timer) clearTimer(state.timer)
      groups.clear()
    } else {
      for (const state of groups.values()) {
        if (config.backlogMax === 0) state.backlog = []
        else if (state.backlog.length > config.backlogMax) state.backlog.splice(0, state.backlog.length - config.backlogMax)
      }
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    for (const state of groups.values()) if (state.timer) clearTimer(state.timer)
    groups.clear()
    if (prototype.handleInboundMessage === wrapper) prototype.handleInboundMessage = original
  }

  return { update, dispose }
}
