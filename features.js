/**
 * Feature toggles for the QQ dispatch page.
 *
 * Each module declares its own settings fields and provider. This runtime
 * manages shared state, scheduling, and execution.
 *
 * The data-source block mirrors dsh's model settings: a provider choice, an
 * optional endpoint, and a **write-only** API key that lives in the host
 * credential store under a stable reference — never in this state file.
 *
 * Register a provider with `runtime.registerProvider(id, run)`, where `run`
 * receives `{ feature, target, ctx, now, manual }` and returns `{ matched, sent,
 * error }`. The transport (which API is asked) stays outside this module, so
 * Liquipedia is not assumed anywhere.
 *
 * @module dsh-qqbot-dispatch/features
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { cronMatches, cronRules, describeCron, nextCronTime, parseCronList } from './cron.js'
import { definition as cs2Matches } from './modules/cs2-matches/definition.js'
import { definition as casualChat } from './modules/casual-chat/definition.js'
import {
  DEFAULT_CS2_SERVICE_TEMPLATE, DEFAULT_CS2_DIGEST_TEMPLATE, DEFAULT_CS2_PRE_MATCH_TEMPLATE, DEFAULT_CS2_RESULT_TEMPLATE,
  validateCs2ServiceTemplate, validateCs2DigestTemplate, validateCs2PreMatchTemplate, validateCs2ResultTemplate,
  migrateCs2ModeTemplates,
} from './modules/cs2-matches/template.js'
import { normalizeTopics } from './modules/casual-chat/topics.js'
import { CS2_RULE_IDS, defaultCs2NoticeRules, migrateCs2NoticeRules } from './modules/cs2-matches/rules.js'
export { cronMatches, parseCronList } from './cron.js'

/** State document shared by every feature toggle. */
export const STATE_PATH = resolve(homedir(), '.dsh-qqbot', 'dispatch-features.json')

const TICK_MS = 30_000
const CS2_DELIVERY_GAP_MS = 30_000
const CS2_PENDING_TTL_MS = 60 * 60_000
const CS2_PRIORITY = ['pre-match', 'result', 'daily-digest']
const MIN_INTERVAL_MINUTES = 15
const MAX_INTERVAL_MINUTES = 24 * 60
const MAX_VALUE_LENGTH = 120
const MAX_TEAMS = 50
const MAX_TARGETS = 20
const TARGET_STATE_RETENTION_MS = 30 * 24 * 60 * 60_000

/** Data-source choices, mirroring the provider rows of dsh's model settings. */
export const SOURCES = [
  { id: 'none', label: '未接入' },
  { id: 'liquipedia', label: 'Liquipedia' },
  { id: 'custom', label: '自定义 HTTP 接口' },
]

/**
 * Feature catalog. `provider` names the future data source; the shell renders
 * whatever `fields` declares and stores the answers verbatim.
 */
export const FEATURES = [cs2Matches, casualChat]

function descriptor(id, entries = FEATURES) {
  const found = entries.find((feature) => feature.id === id)
  if (found === undefined) throw new Error(`unknown feature: ${id}`)
  return found
}

/** Credential reference for one feature's API key — a POSIX identifier, never the value. */
export function credentialRefFor(featureId) {
  return `QQBOT_DISPATCH_${String(featureId).toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`
}

function defaultValues(entry) {
  const values = {}
  for (const field of entry.fields) values[field.key] = field.default ?? []
  return values
}

function defaultFeature(entry) {
  return {
    enabled: false,
    target: { sessionIds: [] },
    source: entry.defaults?.source ?? { id: 'custom', baseUrl: '' },
    intervalMinutes: entry.defaults?.intervalMinutes ?? 60,
    scheduleMode: entry.defaults?.scheduleMode ?? (entry.id === 'cs2-matches' ? 'cron' : 'interval'),
    cron: entry.defaults?.cron ?? (entry.id === 'cs2-matches' ? ['0 18 * * *'] : []),
    timeZone: 'Asia/Shanghai',
    ...(entry.id === 'cs2-matches' ? {
      deliveryMode: 'direct', serviceTemplate: DEFAULT_CS2_SERVICE_TEMPLATE,
      digestTemplate: DEFAULT_CS2_DIGEST_TEMPLATE, preMatchTemplate: DEFAULT_CS2_PRE_MATCH_TEMPLATE,
      resultTemplate: DEFAULT_CS2_RESULT_TEMPLATE,
      noticeMode: 'daily-digest', digestDay: 'tomorrow', leadMinutes: 60,
      noticeRules: defaultCs2NoticeRules(),
    } : {}),
    values: defaultValues(entry),
    lastRunAt: 0,
    lastResult: null,
    seen: {},
    tierCache: {},
  }
}

function defaultState(entries) {
  return {
    version: 1,
    settings: { deliveryMethod: 'service-turn', defaultTargetSessionIds: [] },
    features: Object.fromEntries(entries.map((entry) => [entry.id, defaultFeature(entry)])),
  }
}

function readSessionIds(value, legacy = '') {
  const source = Array.isArray(value) ? value : typeof legacy === 'string' ? [legacy] : []
  return [...new Set(source.filter((item) => typeof item === 'string').map((item) => item.trim())
    .filter((item) => item !== '' && item.length <= MAX_VALUE_LENGTH))].slice(0, MAX_TARGETS)
}

function submittedSessionIds(value) {
  if (!Array.isArray(value)) throw new Error('目标会话必须是数组')
  if (value.length > MAX_TARGETS) throw new Error(`目标会话最多 ${MAX_TARGETS} 个`)
  if (value.some((item) => typeof item !== 'string' || item.trim() === '' || item.trim().length > MAX_VALUE_LENGTH)) throw new Error('目标会话无效')
  return [...new Set(value.map((item) => item.trim()))]
}

function featureTargetIds(feature, settings) {
  const own = readSessionIds(feature?.target?.sessionIds, feature?.target?.sessionId)
  return own.length > 0 ? own : readSessionIds(settings?.defaultTargetSessionIds, settings?.defaultTargetSessionId)
}

function readStateFile(entries, statePath) {
  const base = defaultState(entries)
  try {
    if (!existsSync(statePath)) return base
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || parsed.features === null || typeof parsed.features !== 'object') return base
    base.settings.deliveryMethod = parsed.settings?.deliveryMethod === 'upstream-sdk' ? 'upstream-sdk' : 'service-turn'
    base.settings.defaultTargetSessionIds = readSessionIds(parsed.settings?.defaultTargetSessionIds, parsed.settings?.defaultTargetSessionId)
    for (const [id, feature] of Object.entries(parsed.features)) {
      if (feature === null || typeof feature !== 'object') continue
      base.features[id] = { ...(base.features[id] ?? {}), ...feature }
      base.features[id].target = { sessionIds: readSessionIds(feature.target?.sessionIds, feature.target?.sessionId) }
      if ((id === 'cs2-matches' || id === 'casual-chat') && (!feature.targetStates || typeof feature.targetStates !== 'object')) {
        const oldTargetId = String(feature.target?.sessionId ?? '').trim() || String(parsed.settings?.defaultTargetSessionId ?? '').trim()
        base.features[id].targetStates = oldTargetId === '' ? {} : { [oldTargetId]: {
          seen: feature.seen && typeof feature.seen === 'object' ? feature.seen : {},
          lastSentAt: feature.lastSentAt ?? 0,
          lastTopicId: feature.lastTopicId ?? '',
          touchedAt: Date.now(),
        } }
      }
      if (id === 'cs2-matches') {
        if (!CS2_RULE_IDS.includes(feature.noticeMode)) base.features[id].noticeMode = 'daily-digest'
        base.features[id].noticeRules = migrateCs2NoticeRules(feature)
        const migrated = migrateCs2ModeTemplates(feature.serviceTemplate)
        try {
          base.features[id].serviceTemplate = validateCs2ServiceTemplate(feature.serviceTemplate)
        } catch {
          base.features[id].serviceTemplate = DEFAULT_CS2_SERVICE_TEMPLATE
        }
        base.features[id].digestTemplate = feature.digestTemplate ?? migrated.digestTemplate
        base.features[id].preMatchTemplate = feature.preMatchTemplate ?? migrated.preMatchTemplate
        try {
          base.features[id].resultTemplate = validateCs2ResultTemplate(feature.resultTemplate)
        } catch {
          base.features[id].resultTemplate = DEFAULT_CS2_RESULT_TEMPLATE
        }
      }
      if (id === 'casual-chat') delete base.features[id].chatSentAt
      if (id === 'casual-chat' && feature.values !== null && typeof feature.values === 'object') {
        const values = { ...feature.values }
        if (values.cooldownHours === undefined && values.cooldownDays !== undefined) {
          const days = Number(values.cooldownDays)
          values.cooldownHours = String(Number.isFinite(days) ? clamp(days, 1, 30) * 24 : 72)
        }
        delete values.cooldownDays
        values.topics = normalizeTopics(values.topics)
        base.features[id].values = values
      }
      if (id === 'cs2-matches' || id === 'casual-chat') {
        const active = new Set(featureTargetIds(base.features[id], base.settings))
        base.features[id].targetStates = Object.fromEntries(Object.entries(base.features[id].targetStates ?? {})
          .filter(([sessionId, item]) => item && typeof item === 'object' &&
            (active.has(sessionId) || Date.now() - Number(item.touchedAt ?? 0) <= TARGET_STATE_RETENTION_MS)))
      }
    }
    return base
  } catch {
    return base
  }
}

function writeStateFile(statePath, state) {
  mkdirSync(dirname(statePath), { recursive: true })
  const tmp = `${statePath}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(tmp, statePath)
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** Sanitize one submitted feature configuration against its declared fields. */
export function configFromInput(entry, input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const target = source.target !== null && typeof source.target === 'object' ? source.target : {}
  const sessionIds = submittedSessionIds(target.sessionIds ?? readSessionIds(undefined, target.sessionId))
  const sourceInput = source.source !== null && typeof source.source === 'object' ? source.source : {}
  const sourceId = SOURCES.some((item) => item.id === sourceInput.id) ? sourceInput.id : 'none'
  const baseUrl = String(sourceInput.baseUrl ?? '').trim().slice(0, 300)
  const intervalMinutes = clamp(Number(source.intervalMinutes ?? 60) || 60, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES)
  const scheduleMode = source.scheduleMode === 'cron' ? 'cron' : 'interval'
  const cron = cronRules(source.cron).slice(0, 10).map((rule) => rule.slice(0, 120))
  const timeZone = typeof source.timeZone === 'string' && source.timeZone.trim() !== '' ? source.timeZone.trim().slice(0, 60) : 'Asia/Shanghai'
  const submitted = source.values !== null && typeof source.values === 'object' ? source.values : {}
  const values = {}
  for (const field of entry.fields) {
    const raw = submitted[field.key]
    if (field.kind === 'topics') {
      values[field.key] = normalizeTopics(raw)
    } else if (field.kind === 'list') {
      const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[,，;；\s]+/))
        .map((item) => String(item).trim())
        .filter((item) => item !== '' && item.length <= MAX_VALUE_LENGTH)
        .slice(0, MAX_TEAMS)
      values[field.key] = [...new Set(list)]
    } else if (field.kind === 'options') {
      const allowed = new Set(field.options)
      values[field.key] = [...new Set((Array.isArray(raw) ? raw : [])
        .map((item) => String(item).trim().toUpperCase())
        .filter((item) => allowed.has(item)))]
    } else {
      values[field.key] = String(raw ?? '').slice(0, MAX_VALUE_LENGTH)
    }
  }
  return {
    enabled: source.enabled === true,
    scheduleMode,
    cron,
    timeZone,
    target: { sessionIds },
    source: { id: sourceId, baseUrl },
    intervalMinutes,
    values,
    ...(entry.id === 'cs2-matches' ? {
      deliveryMode: source.deliveryMode === 'service-turn' ? 'service-turn' : 'direct',
      serviceTemplate: validateCs2ServiceTemplate(source.serviceTemplate),
      digestTemplate: validateCs2DigestTemplate(source.digestTemplate ?? migrateCs2ModeTemplates(source.serviceTemplate).digestTemplate),
      preMatchTemplate: validateCs2PreMatchTemplate(source.preMatchTemplate ?? migrateCs2ModeTemplates(source.serviceTemplate).preMatchTemplate),
      resultTemplate: validateCs2ResultTemplate(source.resultTemplate),
      noticeMode: CS2_RULE_IDS.includes(source.noticeMode) ? source.noticeMode : 'daily-digest',
      digestDay: source.digestDay === 'today' ? 'today' : 'tomorrow',
      leadMinutes: clamp(Number(source.leadMinutes) || 60, 15, 360),
      noticeRules: migrateCs2NoticeRules(source, 'daily-digest'),
    } : {}),
  }
}

/** Project one feature's state for the page; the credential never carries a value. */
function publicFeature(entry, feature, statePath, credential) {
  const source = feature.source ?? { id: 'none', baseUrl: '' }
  const provider = source.id === 'none' ? null : source.id
  const sourceLabel = entry.provider === 'builtin' ? '内置' : SOURCES.find((item) => item.id === source.id)?.label ?? '未接入'
  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    provider: entry.provider === 'builtin' ? 'builtin' : provider,
    providerLabel: sourceLabel,
    sources: SOURCES,
    source,
    credential,
    fields: entry.fields,
    extension: entry.extension === true,
    enabled: feature.enabled === true,
    target: { sessionIds: readSessionIds(feature.target?.sessionIds, feature.target?.sessionId) },
    intervalMinutes: feature.intervalMinutes ?? 60,
    scheduleMode: feature.scheduleMode === 'cron' ? 'cron' : 'interval',
    cron: cronRules(feature.cron),
    timeZone: feature.timeZone ?? 'Asia/Shanghai',
    cronValid: feature.scheduleMode !== 'cron' || parseCronList(feature.cron ?? '') !== undefined,
    cronDescription: feature.scheduleMode === 'cron' ? describeCron(feature.cron ?? '') : null,
    nextRunAt: nextRunAt(feature),
    ...(entry.id === 'cs2-matches' ? {
      deliveryMode: feature.deliveryMode === 'service-turn' ? 'service-turn' : 'direct',
      serviceTemplate: feature.serviceTemplate ?? DEFAULT_CS2_SERVICE_TEMPLATE,
      digestTemplate: feature.digestTemplate ?? DEFAULT_CS2_DIGEST_TEMPLATE,
      preMatchTemplate: feature.preMatchTemplate ?? DEFAULT_CS2_PRE_MATCH_TEMPLATE,
      resultTemplate: feature.resultTemplate ?? DEFAULT_CS2_RESULT_TEMPLATE,
      noticeMode: feature.noticeMode ?? 'daily-digest',
      digestDay: feature.digestDay === 'today' ? 'today' : 'tomorrow',
      leadMinutes: feature.leadMinutes ?? 60,
      noticeRules: Object.fromEntries(Object.entries(migrateCs2NoticeRules(feature)).map(([id, rule]) => [id, {
        ...rule,
        cronValid: rule.scheduleMode !== 'cron' || parseCronList(rule.cron) !== undefined,
        cronDescription: rule.scheduleMode === 'cron' ? describeCron(rule.cron) : null,
        nextRunAt: nextRunAt({ ...rule, timeZone: feature.timeZone }),
      }])),
    } : {}),
    values: feature.values ?? {},
    lastRunAt: feature.lastRunAt ?? 0,
    lastResult: feature.lastResult ?? null,
    ...(entry.id === 'casual-chat' ? { lastTopicId: feature.lastTopicId ?? '' } : {}),
    statePath,
  }
}

/** When the next automatic run is due, for display. */
function nextRunAt(feature) {
  if (feature.scheduleMode === 'cron') {
    return nextCronTime(feature.cron ?? '', feature.timeZone ?? 'Asia/Shanghai')
  }
  const interval = (feature.intervalMinutes ?? 60) * 60_000
  return Math.max(Date.now(), (feature.lastRunAt ?? 0) + interval)
}

/**
 * Build the feature runtime for one plugin instance.
 * @param options - `ctx` and optional `statePath`/`now` overrides.
 * @returns snapshot/save/run/registerProvider and the interval scheduler.
 */
export function createFeatureRuntime(options) {
  const ctx = options.ctx
  const entries = options.modules ?? FEATURES
  const statePath = options.statePath ?? STATE_PATH
  const now = options.now ?? (() => Date.now())
  const providers = new Map()
  const running = new Set()
  let timer = null
  let startup = null

  const read = () => readStateFile(entries, statePath)

  /** Credential presence for one feature, read from the host credential store. */
  async function credentialStatus(id) {
    const ref = credentialRefFor(id)
    const credentials = ctx.get('credentials')
    if (credentials?.describe === undefined) return { ref, configured: false, writable: false }
    try {
      const info = await credentials.describe(ref)
      return { ref, configured: info?.configured === true, writable: info?.writable === true }
    } catch {
      return { ref, configured: false, writable: false }
    }
  }

  async function snapshot() {
    const state = read()
    const features = []
    for (const entry of entries) {
      const feature = state.features[entry.id] ?? defaultFeature(entry)
      features.push(publicFeature(entry, feature, statePath, await credentialStatus(entry.id)))
    }
    return { features, settings: state.settings }
  }

  function saveSettings(input) {
    const hasDeliveryMethod = Object.hasOwn(input ?? {}, 'deliveryMethod')
    const hasTarget = Object.hasOwn(input ?? {}, 'defaultTargetSessionIds') || Object.hasOwn(input ?? {}, 'defaultTargetSessionId')
    if (!hasDeliveryMethod && !hasTarget) throw new Error('没有可保存的全局配置')
    if (hasDeliveryMethod && input.deliveryMethod !== 'service-turn' && input.deliveryMethod !== 'upstream-sdk') throw new Error('未知的通知投递方式')
    const submittedTargets = hasTarget ? submittedSessionIds(input.defaultTargetSessionIds ?? readSessionIds(undefined, input.defaultTargetSessionId)) : null
    const state = read()
    if (hasTarget && submittedTargets.length === 0 && entries.some((entry) => {
      const feature = state.features[entry.id]
      return feature?.enabled === true && readSessionIds(feature.target?.sessionIds, feature.target?.sessionId).length === 0
    })) {
      throw new Error('已启用的模组仍使用全局默认目标，请先指定独立目标或关闭模组')
    }
    if (hasDeliveryMethod) state.settings.deliveryMethod = input.deliveryMethod
    if (hasTarget) state.settings.defaultTargetSessionIds = submittedTargets
    writeStateFile(statePath, state)
    return state.settings
  }

  async function save(id, input) {
    const entry = descriptor(id, entries)
    const submitted = configFromInput(entry, input)
    if (id === 'cs2-matches') {
      for (const [mode, rule] of Object.entries(submitted.noticeRules)) {
        if (rule.enabled && rule.scheduleMode === 'cron' && parseCronList(rule.cron) === undefined) {
          throw new Error(`${mode === 'daily-digest' ? '每日汇总' : mode === 'pre-match' ? '赛前提醒' : '赛果提醒'}的 Cron 规则无效`)
        }
      }
    }
    const state = read()
    if (submitted.enabled && submitted.target.sessionIds.length === 0 && state.settings.defaultTargetSessionIds.length === 0) throw new Error('请先设置全局默认目标或选择模组目标会话')

    const credentials = ctx.get('credentials')
    const ref = credentialRefFor(id)
    const secret = typeof input?.credential === 'string' ? input.credential.trim() : ''
    if (credentials !== undefined) {
      if (secret !== '') await credentials.set(ref, secret)
      else if (input?.clearCredential === true) await credentials.unset(ref)
    }

    const feature = state.features[id] ?? defaultFeature(entry)
    if (id === 'cs2-matches') {
      const previous = migrateCs2NoticeRules(feature)
      for (const [mode, rule] of Object.entries(submitted.noticeRules)) {
        rule.lastRunAt = previous[mode]?.lastRunAt ?? 0
        rule.lastResult = previous[mode]?.lastResult ?? null
      }
    }
    Object.assign(feature, submitted)
    if (id === 'cs2-matches') {
      feature.pendingNoticeModes = submitted.enabled
        ? Object.fromEntries(Object.entries(feature.pendingNoticeModes ?? {})
          .filter(([mode]) => submitted.noticeRules[mode]?.enabled === true))
        : {}
      if (!submitted.enabled) feature.nextCs2DeliveryAt = 0
    }
    state.features[id] = feature
    writeStateFile(statePath, state)
    return publicFeature(entry, feature, statePath, await credentialStatus(id))
  }

  /** A provider may later fill this in; until then a run only records the gap. */
  function run(id, { manual = false, forceResend = false, noticeMode, eligibleAt } = {}) {
    const entry = descriptor(id, entries)
    const state = read()
    const feature = state.features[id] ?? defaultFeature(entry)
    const rules = id === 'cs2-matches' ? migrateCs2NoticeRules(feature) : null
    const mode = id === 'cs2-matches' ? (noticeMode ?? feature.noticeMode ?? 'daily-digest') : undefined
    if (rules !== null && !Object.hasOwn(rules, mode)) throw new Error('通知规则无效')
    const rule = rules?.[mode]
    const checkedAt = now()
    const result = { checkedAt, matched: 0, sent: 0, error: '', targetResults: [], ...(mode === undefined ? {} : { noticeMode: mode }) }
    if ((!feature.enabled || (rule !== undefined && !rule.enabled)) && (!manual || entry.extension === true)) {
      return { skipped: true, reason: 'disabled' }
    }
    if (running.has(id)) return { skipped: true, reason: 'running' }
    const provider = providers.get(id)
    if (provider === undefined) {
      const sourceId = feature.source?.id ?? 'none'
      result.error = sourceId === 'none' ? '数据源尚未接入' : `数据源 ${sourceId} 尚未接入`
      feature.lastRunAt = checkedAt
      feature.lastResult = result
      if (rule !== undefined) {
        rule.lastRunAt = checkedAt
        rule.lastResult = result
        feature.noticeRules = rules
      }
      state.features[id] = feature
      writeStateFile(statePath, state)
      return result
    }
    running.add(id)
    return Promise.resolve()
      .then(async () => {
        const sessionIds = featureTargetIds(feature, state.settings)
        if (sessionIds.length === 0) throw new Error('未选择目标会话')
        for (const sessionId of sessionIds) {
          const targetState = feature.targetStates?.[sessionId] ?? {}
          const isolated = id === 'cs2-matches' || id === 'casual-chat'
          const targetFeature = isolated ? {
            ...feature,
            seen: { ...(targetState.seen ?? {}) },
            lastSentAt: targetState.lastSentAt ?? 0,
            lastTopicId: targetState.lastTopicId ?? '',
          } : feature
          const item = { sessionId, matched: 0, sent: 0, error: '' }
          try {
            const outcome = await provider({ feature: targetFeature, settings: state.settings, target: { sessionId }, ctx, now, manual,
              forceResend: manual && forceResend, ...(mode === undefined ? {} : { noticeMode: mode }), ...(Number.isFinite(eligibleAt) ? { eligibleAt } : {}) })
            item.matched = Number(outcome?.matched ?? 0)
            item.sent = Number(outcome?.sent ?? 0)
            if (outcome?.skipped === true) item.skipped = true
            if (typeof outcome?.error === 'string') item.error = outcome.error
            if (typeof outcome?.channel === 'string') item.channel = outcome.channel
            if (typeof outcome?.warning === 'string') item.warning = outcome.warning
          } catch (error) {
            item.error = String(error?.message ?? error)
            item.matched = Number(error?.matched ?? 0)
            item.sent = Number(error?.sent ?? 0)
          } finally {
            const latest = read()
            const latestFeature = latest.features[id] ?? feature
            if (isolated) {
              latestFeature.targetStates ??= {}
              latestFeature.targetStates[sessionId] = {
                seen: targetFeature.seen,
                lastSentAt: targetFeature.lastSentAt ?? 0,
                lastTopicId: targetFeature.lastTopicId ?? '',
                touchedAt: now(),
              }
              if (sessionIds.length === 1) {
                latestFeature.seen = targetFeature.seen
                latestFeature.lastSentAt = targetFeature.lastSentAt
                latestFeature.lastTopicId = targetFeature.lastTopicId
              }
            } else {
              latestFeature.seen = targetFeature.seen
              latestFeature.lastSentAt = targetFeature.lastSentAt
            }
            latestFeature.tierCache = targetFeature.tierCache
            latest.features[id] = latestFeature
            writeStateFile(statePath, latest)
          }
          result.targetResults.push(item)
          result.matched += item.matched
          result.sent += item.sent
          if (item.channel && !result.channel) result.channel = item.channel
          if (item.warning) result.warning = [result.warning, item.warning].filter(Boolean).join('；')
        }
        const failed = result.targetResults.filter((item) => item.error)
        if (failed.length > 0) result.error = failed.map((item) => `${item.sessionId.slice(-8)}：${item.error}`).join('；')
        return result
      })
      .catch((error) => {
        result.error = String(error?.message ?? error)
        return result
      })
      .finally(() => {
        running.delete(id)
        const latest = read()
        const latestRules = id === 'cs2-matches' ? migrateCs2NoticeRules(latest.features[id] ?? feature) : null
        if (latestRules !== null) {
          latestRules[mode] = { ...latestRules[mode], lastRunAt: checkedAt, lastResult: result }
        }
        latest.features[id] = {
          ...(latest.features[id] ?? feature),
          lastRunAt: checkedAt,
          lastResult: result,
          ...(latestRules === null ? {} : { noticeRules: latestRules }),
        }
        writeStateFile(statePath, latest)
      })
  }

  /** Register the data source that will feed one feature (currently none). */
  function registerProvider(id, provider) {
    descriptor(id, entries)
    providers.set(id, provider)
    return () => providers.delete(id)
  }

  async function tick() {
    const state = read()
    for (const entry of entries) {
      const feature = state.features[entry.id]
      if (feature === undefined || feature.enabled !== true) continue
      if (!providers.has(entry.id)) continue
      if (entry.id === 'cs2-matches') {
        const at = now()
        const rules = migrateCs2NoticeRules(feature)
        const pending = Object.fromEntries(Object.entries(feature.pendingNoticeModes ?? {})
          .filter(([mode, dueAt]) => rules[mode]?.enabled === true && Number.isFinite(dueAt) && dueAt > 0 &&
            dueAt <= at && at - dueAt <= CS2_PENDING_TTL_MS))
        for (const [mode, rule] of Object.entries(rules)) {
          if (!rule.enabled) continue
          if (rule.scheduleMode === 'cron') {
            const list = parseCronList(rule.cron)
            if (list === undefined || !list.some((sets) => cronMatches(sets, new Date(at), feature.timeZone ?? 'Asia/Shanghai'))) continue
            if (rule.lastRunAt !== 0 && Math.floor(rule.lastRunAt / 60_000) === Math.floor(at / 60_000)) continue
          } else if (at - rule.lastRunAt < rule.intervalMinutes * 60_000) continue
          if (pending[mode] === undefined) pending[mode] = at
        }
        const queued = read()
        queued.features[entry.id].pendingNoticeModes = pending
        writeStateFile(statePath, queued)
        if (running.has(entry.id) || at < Number(queued.features[entry.id].nextCs2DeliveryAt ?? 0)) continue
        for (const mode of CS2_PRIORITY.filter((id) => pending[id] !== undefined)) {
          const result = await Promise.resolve(run(entry.id, { noticeMode: mode, eligibleAt: pending[mode] })).catch(() => ({ error: '检查失败' }))
          if (result?.skipped === true && result.reason === 'running') break
          delete pending[mode]
          const latest = read()
          latest.features[entry.id].pendingNoticeModes = { ...pending }
          if (result?.sent > 0) latest.features[entry.id].nextCs2DeliveryAt = now() + CS2_DELIVERY_GAP_MS
          writeStateFile(statePath, latest)
          if (result?.sent > 0) break
        }
        continue
      }
      if (feature.scheduleMode === 'cron') {
        const list = parseCronList(feature.cron ?? '')
        if (list === undefined) continue
        if (!list.some((sets) => cronMatches(sets, new Date(now()), feature.timeZone ?? 'Asia/Shanghai'))) continue
        if (feature.lastRunAt !== 0 && Math.floor(feature.lastRunAt / 60_000) === Math.floor(now() / 60_000)) continue
      } else {
        const interval = (feature.intervalMinutes ?? 60) * 60_000
        if (now() - (feature.lastRunAt ?? 0) < interval) continue
      }
      await Promise.resolve(run(entry.id)).catch(() => {})
    }
  }

  function start() {
    stop()
    timer = setInterval(() => { void tick() }, TICK_MS)
    timer.unref?.()
    startup = setTimeout(() => { void tick() }, 5_000)
    startup.unref?.()
    return stop
  }

  function stop() {
    if (timer !== null) clearInterval(timer)
    if (startup !== null) clearTimeout(startup)
    timer = null
    startup = null
  }

  return { snapshot, save, saveSettings, run, tick, registerProvider, start, stop, providers }
}
