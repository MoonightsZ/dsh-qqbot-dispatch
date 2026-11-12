import { cronRules } from '../../cron.js'

export const CS2_RULE_IDS = ['daily-digest', 'pre-match', 'result']

const DEFAULT_RULES = {
  'daily-digest': { enabled: true, scheduleMode: 'cron', cron: ['0 18 * * *'], intervalMinutes: 1440, lastRunAt: 0, lastResult: null },
  'pre-match': { enabled: false, scheduleMode: 'interval', cron: [], intervalMinutes: 15, lastRunAt: 0, lastResult: null },
  result: { enabled: false, scheduleMode: 'interval', cron: [], intervalMinutes: 15, lastRunAt: 0, lastResult: null },
}

export function defaultCs2NoticeRules() {
  return { 'daily-digest': { ...DEFAULT_RULES['daily-digest'], cron: ['0 18 * * *'] }, 'pre-match': { ...DEFAULT_RULES['pre-match'], cron: [] }, result: { ...DEFAULT_RULES.result, cron: [] } }
}

function normalizeRule(value, id) {
  const source = value && typeof value === 'object' ? value : {}
  const fallback = DEFAULT_RULES[id]
  const interval = Number(source.intervalMinutes)
  return {
    enabled: source.enabled === true,
    scheduleMode: source.scheduleMode === 'cron' ? 'cron' : 'interval',
    cron: cronRules(source.cron ?? fallback.cron).slice(0, 10).map((rule) => rule.slice(0, 120)),
    intervalMinutes: Number.isFinite(interval) ? Math.min(1440, Math.max(15, interval)) : fallback.intervalMinutes,
    lastRunAt: Number.isFinite(source.lastRunAt) && source.lastRunAt > 0 ? source.lastRunAt : 0,
    lastResult: source.lastResult && typeof source.lastResult === 'object' ? source.lastResult : null,
  }
}

/** Convert the old exclusive mode without enabling any second rule. */
export function migrateCs2NoticeRules(feature, fallbackMode = '') {
  const source = feature && typeof feature === 'object' ? feature : {}
  const rules = defaultCs2NoticeRules()
  if (source.noticeRules && typeof source.noticeRules === 'object') {
    rules['daily-digest'].enabled = false
    rules['pre-match'].enabled = false
    rules.result.enabled = false
    for (const id of CS2_RULE_IDS) {
      rules[id] = normalizeRule(source.noticeRules[id] ?? rules[id], id)
    }
    return rules
  }
  rules['daily-digest'].enabled = false
  rules['pre-match'].enabled = false
  rules.result.enabled = false
  const mode = CS2_RULE_IDS.includes(source.noticeMode) ? source.noticeMode
    : CS2_RULE_IDS.includes(fallbackMode) ? fallbackMode : null
  if (mode === null) return rules
  const fallback = DEFAULT_RULES[mode]
  rules[mode] = normalizeRule({
    ...fallback, enabled: true,
    scheduleMode: source.scheduleMode ?? fallback.scheduleMode,
    cron: source.cron ?? fallback.cron,
    intervalMinutes: source.intervalMinutes ?? fallback.intervalMinutes,
    lastRunAt: source.lastRunAt,
    lastResult: source.lastResult,
  }, mode)
  return rules
}
