/**
 * Feature toggles for the QQ dispatch page.
 *
 * This is the shell only: every feature declares its own settings fields and a
 * data source, but no provider is registered yet, so enabling a feature and
 * pressing "立即检查" reports that the data source is not wired instead of
 * fetching anything.
 *
 * The data-source block mirrors dsh's model settings: a provider choice, an
 * optional endpoint, and a **write-only** API key that lives in the host
 * credential store under a stable reference — never in this state file.
 *
 * Wire a provider later with `runtime.registerProvider(id, run)`, where `run`
 * receives `{ feature, target, ctx, now }` and returns `{ matched, sent,
 * error }`. The transport (which API is asked) stays outside this module, so
 * Liquipedia is not assumed anywhere.
 *
 * @module dsh-tool-qqbot-dispatch/features
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

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
export const FEATURES = [
  {
    id: 'cs2-matches',
    label: 'CS2 赛事通知',
    description: '按小时检查关注的队伍与赛事等级，把新比赛下发到指定 QQ 会话。数据源待接入。',
    provider: null,
    providerLabel: '未接入',
    fields: [
      {
        key: 'teams',
        label: '关注队伍',
        kind: 'list',
        placeholder: '例如 Spirit, Vitality',
        hint: '留空表示全部队伍',
      },
      {
        key: 'tiers',
        label: '关注赛事等级',
        kind: 'options',
        options: ['S', 'A', 'B', 'C'],
        hint: '留空表示全部等级',
      },
    ],
  },
]

function descriptor(id) {
  const found = FEATURES.find((feature) => feature.id === id)
  if (found === undefined) throw new Error(`unknown feature: ${id}`)
  return found
}

/** Credential reference for one feature's API key — a POSIX identifier, never the value. */
export function credentialRefFor(featureId) {
  return `QQBOT_DISPATCH_${String(featureId).toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`
}

function defaultValues(entry) {
  const values = {}
  for (const field of entry.fields) values[field.key] = []
  return values
}

function defaultState(featureId) {
  return {
    version: 1,
    features: {
      [featureId]: {
        enabled: false,
        target: { sessionId: '' },
        source: { id: 'custom', baseUrl: '' },
        intervalMinutes: 60,
        scheduleMode: 'interval',
        cron: '',
        timeZone: 'Asia/Shanghai',
        focusCard: true,
        values: defaultValues(descriptor(featureId)),
        lastRunAt: 0,
        lastResult: null,
        seen: {},
        tierCache: {},
      },
    },
  }
}

function readStateFile(featureId, statePath) {
  const base = defaultState(featureId)
  try {
    if (!existsSync(statePath)) return base
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || parsed.features === null || typeof parsed.features !== 'object') return base
    for (const [id, feature] of Object.entries(parsed.features)) {
      if (feature === null || typeof feature !== 'object') continue
      base.features[id] = { ...(base.features[id] ?? base.features[featureId]), ...feature }
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
  const cron = String(source.cron ?? '').trim().slice(0, 120)
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
    focusCard: source.focusCard !== false,
    scheduleMode,
    cron,
    timeZone,
    target: { sessionId },
    source: { id: sourceId, baseUrl },
    intervalMinutes,
    values,
  }
}

/** Project one feature's state for the page; the credential never carries a value. */
function publicFeature(entry, feature, statePath, credential) {
  const source = feature.source ?? { id: 'none', baseUrl: '' }
  const provider = source.id === 'none' ? null : source.id
  const sourceLabel = SOURCES.find((item) => item.id === source.id)?.label ?? '未接入'
  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    provider,
    providerLabel: sourceLabel,
    sources: SOURCES,
    source,
    credential,
    fields: entry.fields,
    enabled: feature.enabled === true,
    target: feature.target ?? { sessionId: '' },
    intervalMinutes: feature.intervalMinutes ?? 60,
    scheduleMode: feature.scheduleMode === 'cron' ? 'cron' : 'interval',
    cron: feature.cron ?? '',
    timeZone: feature.timeZone ?? 'Asia/Shanghai',
    cronValid: feature.scheduleMode !== 'cron' || parseCronList(feature.cron ?? '') !== undefined,
    nextRunAt: nextRunAt(feature),
    focusCard: feature.focusCard !== false,
    values: feature.values ?? {},
    lastRunAt: feature.lastRunAt ?? 0,
    lastResult: feature.lastResult ?? null,
    statePath,
  }
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function parseField(field, min, max) {
  const values = new Set()
  for (const part of String(field).split(',')) {
    const stepMatch = /^\*\/(\d+)$/.exec(part)
    if (stepMatch !== null) {
      const step = Number(stepMatch[1])
      if (!Number.isInteger(step) || step < 1) return undefined
      for (let value = min; value <= max; value += step) values.add(value)
      continue
    }
    if (part === '*') {
      for (let value = min; value <= max; value += 1) values.add(value)
      continue
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(part)
    if (rangeMatch !== null) {
      const from = Number(rangeMatch[1])
      const to = Number(rangeMatch[2])
      if (from > to || from < min || to > max) return undefined
      for (let value = from; value <= to; value += 1) values.add(value)
      continue
    }
    const number = Number(part)
    if (!Number.isInteger(number) || number < min || number > max) return undefined
    values.add(number)
  }
  return values
}

/** Parse a 5-field cron (minute hour day month weekday); weekday 7 folds onto Sunday. */
export function parseCron(expression) {
  const fields = String(expression ?? '').trim().split(/\s+/)
  if (fields.length !== 5) return undefined
  const limits = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
  const sets = fields.map((field, index) => parseField(field, limits[index][0], limits[index][1]))
  if (sets.some((set) => set === undefined)) return undefined
  if (sets[4].has(7)) {
    sets[4].delete(7)
    sets[4].add(0)
  }
  return sets
}

/** Parse a ';'-separated list of 5-field expressions; any invalid part invalidates the list. */
export function parseCronList(expression) {
  const parts = String(expression ?? '').split(';').map((part) => part.trim()).filter((part) => part !== '')
  if (parts.length === 0) return undefined
  const list = []
  for (const part of parts) {
    const parsed = parseCron(part)
    if (parsed === undefined) return undefined
    list.push(parsed)
  }
  return list
}

function cronListMatches(list, date, timeZone) {
  if (list === undefined) return false
  return list.some((sets) => cronMatches(sets, date, timeZone))
}

function zonedParts(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      minute: '2-digit',
      hour: '2-digit',
      day: '2-digit',
      month: '2-digit',
      weekday: 'short',
    }).formatToParts(date)
    const value = (type) => parts.find((part) => part.type === type)?.value ?? ''
    return {
      minute: Number(value('minute')),
      hour: Number(value('hour')),
      day: Number(value('day')),
      month: Number(value('month')),
      weekday: WEEKDAYS[value('weekday')] ?? 0,
    }
  } catch {
    return undefined
  }
}

/** Whether one instant matches the parsed cron in the given zone. */
export function cronMatches(sets, date, timeZone) {
  if (sets === undefined) return false
  const parts = zonedParts(date, timeZone)
  if (parts === undefined) return false
  return sets[0].has(parts.minute) && sets[1].has(parts.hour) && sets[2].has(parts.day)
    && sets[3].has(parts.month) && sets[4].has(parts.weekday)
}

/** Next matching instant, scanning forward up to 31 days. */
function nextCronAt(sets, fromMs, timeZone) {
  const step = 60_000
  const limit = 31 * 24 * 60
  let cursor = Math.floor(fromMs / step) * step + step
  for (let index = 0; index < limit; index += 1) {
    if (cronMatches(sets, new Date(cursor), timeZone)) return cursor
    cursor += step
  }
  return 0
}

/** When the next automatic run is due, for display. */
function nextRunAt(feature) {
  if (feature.scheduleMode === 'cron') {
    const list = parseCronList(feature.cron ?? '')
    if (list === undefined) return 0
    const timeZone = feature.timeZone ?? 'Asia/Shanghai'
    const step = 60_000
    const limit = 31 * 24 * 60
    let cursor = Math.floor(Date.now() / step) * step + step
    for (let index = 0; index < limit; index += 1) {
      if (cronListMatches(list, new Date(cursor), timeZone)) return cursor
      cursor += step
    }
    return 0
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
  const statePath = options.statePath ?? STATE_PATH
  const now = options.now ?? (() => Date.now())
  const providers = new Map()
  let timer = null
  let startup = null

  const read = () => readStateFile(FEATURES[0].id, statePath)

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
    for (const entry of FEATURES) {
      const feature = state.features[entry.id] ?? defaultState(entry.id).features[entry.id]
      features.push(publicFeature(entry, feature, statePath, await credentialStatus(entry.id)))
    }
    return { features }
  }

  async function save(id, input) {
    const entry = descriptor(id)
    const state = read()
    const feature = state.features[id] ?? defaultState(id).features[id]
    Object.assign(feature, configFromInput(entry, input))

    const credentials = ctx.get('credentials')
    const ref = credentialRefFor(id)
    const secret = typeof input?.credential === 'string' ? input.credential.trim() : ''
    if (credentials !== undefined) {
      if (secret !== '') await credentials.set(ref, secret)
      else if (input?.clearCredential === true) await credentials.unset(ref)
    }

    state.features[id] = feature
    writeStateFile(statePath, state)
    return publicFeature(entry, feature, statePath, await credentialStatus(id))
  }

  /** A provider may later fill this in; until then a run only records the gap. */
  function run(id, { manual = false } = {}) {
    const entry = descriptor(id)
    const state = read()
    const feature = state.features[id] ?? defaultState(id).features[id]
    const checkedAt = now()
    const result = { checkedAt, matched: 0, sent: 0, error: '' }
    if (!feature.enabled && !manual) {
      return { skipped: true, reason: 'disabled' }
    }
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
    return Promise.resolve()
      .then(async () => {
        const sessionId = String(feature.target?.sessionId ?? '').trim()
        if (sessionId === '') throw new Error('未选择目标会话')
        const outcome = await provider({ feature, target: { sessionId }, ctx, now })
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
        feature.lastRunAt = checkedAt
        feature.lastResult = result
        state.features[id] = feature
        writeStateFile(statePath, state)
      })
  }

  /** Register the data source that will feed one feature (currently none). */
  function registerProvider(id, provider) {
    descriptor(id)
    providers.set(id, provider)
    return () => providers.delete(id)
  }

  async function tick() {
    const state = read()
    for (const entry of FEATURES) {
      const feature = state.features[entry.id]
      if (feature === undefined || feature.enabled !== true) continue
      if (!providers.has(entry.id)) continue
      if (feature.scheduleMode === 'cron') {
        const list = parseCronList(feature.cron ?? '')
        if (list === undefined) continue
        if (!cronListMatches(list, new Date(now()), feature.timeZone ?? 'Asia/Shanghai')) continue
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

  return { snapshot, save, run, registerProvider, start, stop, providers }
}
