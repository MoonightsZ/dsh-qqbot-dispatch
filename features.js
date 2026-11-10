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
import { DEFAULT_CS2_SERVICE_TEMPLATE, validateCs2ServiceTemplate } from './modules/cs2-matches/template.js'
export { cronMatches, parseCronList } from './cron.js'

/** State document shared by every feature toggle. */
export const STATE_PATH = resolve(homedir(), '.dsh-qqbot', 'dispatch-features.json')

const TICK_MS = 60_000
const MIN_INTERVAL_MINUTES = 15
const MAX_INTERVAL_MINUTES = 24 * 60
const MAX_VALUE_LENGTH = 120
const MAX_TEAMS = 50

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
    target: { sessionId: '' },
    source: entry.defaults?.source ?? { id: 'custom', baseUrl: '' },
    intervalMinutes: entry.defaults?.intervalMinutes ?? 60,
    scheduleMode: entry.defaults?.scheduleMode ?? (entry.id === 'cs2-matches' ? 'cron' : 'interval'),
    cron: entry.defaults?.cron ?? (entry.id === 'cs2-matches' ? ['0 18 * * *'] : []),
    timeZone: 'Asia/Shanghai',
    ...(entry.id === 'cs2-matches' ? {
      deliveryMode: 'direct', serviceTemplate: DEFAULT_CS2_SERVICE_TEMPLATE,
      noticeMode: 'daily-digest', digestDay: 'tomorrow', leadMinutes: 60,
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
    settings: { deliveryMethod: 'service-turn', defaultTargetSessionId: '' },
    features: Object.fromEntries(entries.map((entry) => [entry.id, defaultFeature(entry)])),
  }
}

function readStateFile(entries, statePath) {
  const base = defaultState(entries)
  try {
    if (!existsSync(statePath)) return base
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || parsed.features === null || typeof parsed.features !== 'object') return base
    base.settings.deliveryMethod = parsed.settings?.deliveryMethod === 'upstream-sdk' ? 'upstream-sdk' : 'service-turn'
    base.settings.defaultTargetSessionId = typeof parsed.settings?.defaultTargetSessionId === 'string'
      ? parsed.settings.defaultTargetSessionId.trim().slice(0, MAX_VALUE_LENGTH) : ''
    for (const [id, feature] of Object.entries(parsed.features)) {
      if (feature === null || typeof feature !== 'object') continue
      base.features[id] = { ...(base.features[id] ?? {}), ...feature }
      if (id === 'cs2-matches' && feature.noticeMode === undefined) base.features[id].noticeMode = 'legacy'
      if (id === 'casual-chat') delete base.features[id].chatSentAt
      if (id === 'casual-chat' && feature.values !== null && typeof feature.values === 'object') {
        const values = { ...feature.values }
        if (values.cooldownHours === undefined && values.cooldownDays !== undefined) {
          const days = Number(values.cooldownDays)
          values.cooldownHours = String(Number.isFinite(days) ? clamp(days, 1, 30) * 24 : 72)
        }
        delete values.cooldownDays
        base.features[id].values = values
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
  const sessionId = String(target.sessionId ?? '').trim().slice(0, MAX_VALUE_LENGTH)
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
    if (field.kind === 'list') {
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
    target: { sessionId },
    source: { id: sourceId, baseUrl },
    intervalMinutes,
    values,
    ...(entry.id === 'cs2-matches' ? {
      deliveryMode: source.deliveryMode === 'service-turn' ? 'service-turn' : 'direct',
      serviceTemplate: validateCs2ServiceTemplate(source.serviceTemplate),
      noticeMode: ['daily-digest', 'pre-match', 'legacy'].includes(source.noticeMode) ? source.noticeMode : 'daily-digest',
      digestDay: source.digestDay === 'today' ? 'today' : 'tomorrow',
      leadMinutes: clamp(Number(source.leadMinutes) || 60, 15, 360),
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
    target: feature.target ?? { sessionId: '' },
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
      noticeMode: feature.noticeMode ?? 'daily-digest',
      digestDay: feature.digestDay === 'today' ? 'today' : 'tomorrow',
      leadMinutes: feature.leadMinutes ?? 60,
    } : {}),
    values: feature.values ?? {},
    lastRunAt: feature.lastRunAt ?? 0,
    lastResult: feature.lastResult ?? null,
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
    const hasTarget = Object.hasOwn(input ?? {}, 'defaultTargetSessionId')
    if (!hasDeliveryMethod && !hasTarget) throw new Error('没有可保存的全局配置')
    if (hasDeliveryMethod && input.deliveryMethod !== 'service-turn' && input.deliveryMethod !== 'upstream-sdk') throw new Error('未知的通知投递方式')
    if (hasTarget && (typeof input.defaultTargetSessionId !== 'string' || input.defaultTargetSessionId.trim().length > MAX_VALUE_LENGTH)) throw new Error('目标会话无效')
    const state = read()
    if (hasTarget && input.defaultTargetSessionId.trim() === '' && entries.some((entry) => {
      const feature = state.features[entry.id]
      return feature?.enabled === true && !String(feature.target?.sessionId ?? '').trim()
    })) {
      throw new Error('已启用的模组仍使用全局默认目标，请先指定独立目标或关闭模组')
    }
    if (hasDeliveryMethod) state.settings.deliveryMethod = input.deliveryMethod
    if (hasTarget) state.settings.defaultTargetSessionId = input.defaultTargetSessionId.trim()
    writeStateFile(statePath, state)
    return state.settings
  }

  async function save(id, input) {
    const entry = descriptor(id, entries)
    const submitted = configFromInput(entry, input)
    const state = read()
    if (submitted.enabled && !submitted.target.sessionId && !state.settings.defaultTargetSessionId) throw new Error('请先设置全局默认目标或选择模组目标会话')

    const credentials = ctx.get('credentials')
    const ref = credentialRefFor(id)
    const secret = typeof input?.credential === 'string' ? input.credential.trim() : ''
    if (credentials !== undefined) {
      if (secret !== '') await credentials.set(ref, secret)
      else if (input?.clearCredential === true) await credentials.unset(ref)
    }

    const feature = state.features[id] ?? defaultFeature(entry)
    Object.assign(feature, submitted)
    state.features[id] = feature
    writeStateFile(statePath, state)
    return publicFeature(entry, feature, statePath, await credentialStatus(id))
  }

  /** A provider may later fill this in; until then a run only records the gap. */
  function run(id, { manual = false, forceResend = false } = {}) {
    const entry = descriptor(id, entries)
    const state = read()
    const feature = state.features[id] ?? defaultFeature(entry)
    const checkedAt = now()
    const result = { checkedAt, matched: 0, sent: 0, error: '' }
    if (!feature.enabled && (!manual || entry.extension === true)) {
      return { skipped: true, reason: 'disabled' }
    }
    if (running.has(id)) return { skipped: true, reason: 'running' }
    const provider = providers.get(id)
    if (provider === undefined) {
      const sourceId = feature.source?.id ?? 'none'
      result.error = sourceId === 'none' ? '数据源尚未接入' : `数据源 ${sourceId} 尚未接入`
      feature.lastRunAt = checkedAt
      feature.lastResult = result
      state.features[id] = feature
      writeStateFile(statePath, state)
      return result
    }
    running.add(id)
    return Promise.resolve()
      .then(async () => {
        const sessionId = String(feature.target?.sessionId ?? '').trim() || state.settings.defaultTargetSessionId
        if (sessionId === '') throw new Error('未选择目标会话')
        const outcome = await provider({ feature, settings: state.settings, target: { sessionId }, ctx, now, manual, forceResend: manual && forceResend })
        result.matched = Number(outcome?.matched ?? 0)
        result.sent = Number(outcome?.sent ?? 0)
        if (typeof outcome?.error === 'string') result.error = outcome.error
        if (typeof outcome?.channel === 'string') result.channel = outcome.channel
        if (typeof outcome?.warning === 'string') result.warning = outcome.warning
        return result
      })
      .catch((error) => {
        result.error = String(error?.message ?? error)
        return result
      })
      .finally(() => {
        running.delete(id)
        feature.lastRunAt = checkedAt
        feature.lastResult = result
        const latest = read()
        latest.features[id] = {
          ...(latest.features[id] ?? feature),
          lastRunAt: checkedAt,
          lastResult: result,
          seen: feature.seen,
          tierCache: feature.tierCache,
          lastSentAt: feature.lastSentAt,
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

  return { snapshot, save, saveSettings, run, registerProvider, start, stop, providers }
}
