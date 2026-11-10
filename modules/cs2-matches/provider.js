/**
 * Liquipedia CS2 match provider for the `cs2-matches` feature toggle.
 *
 * Follows https://liquipedia.net/api-terms-of-use:
 * - one `action=parse` request per 30 s at most, one other API request per 2 s;
 * - a descriptive User-Agent with project contact;
 * - results cached as long as possible (in-memory parse cache + a persisted
 *   tournament-tier cache), and dispatched matches remembered so a repeat run
 *   never sends the same match twice;
 * - every message attributes Liquipedia as the source (CC BY-SA 3.0).
 *
 * @module dsh-qqbot-dispatch/liquipedia
 */
import { composeCs2FixedNoticePrompt, composeCs2ServiceTurnPrompt } from './template.js'
import { createNotificationDispatcher } from '../../notification-dispatcher.js'

const API = 'https://liquipedia.net/counterstrike/api.php'
const USER_AGENT = 'dsh-qqbot-dispatch/0.1 (DSH QQ bot plugin; +https://github.com/deepseek-ai/dsh)'
const QUERY_GAP_MS = 2_100
const PARSE_GAP_MS = 30_000
const PARSE_CACHE_MS = 15 * 60_000
const SEEN_RETENTION_MS = 14 * 24 * 60 * 60_000
const MAX_CHUNK_CHARS = 1800
const TIER_NAMES = { 's-tier': 'S', 'a-tier': 'A', 'b-tier': 'B', 'c-tier': 'C', 'd-tier': 'C' }

let lastRequestAt = 0
let lastParseAt = 0
let parseCache = { at: 0, matches: [] }

/** Serialize one API call behind the published minimum gap. */
async function throttle(kind) {
  const gap = kind === 'parse' ? PARSE_GAP_MS : QUERY_GAP_MS
  const last = kind === 'parse' ? lastParseAt : lastRequestAt
  const wait = Math.max(0, last + gap - Date.now())
  if (wait > 0) await new Promise((done) => setTimeout(done, wait))
  const started = Date.now()
  if (kind === 'parse') lastParseAt = started
  lastRequestAt = started
}

async function apiJson(url, kind) {
  await throttle(kind)
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json', 'accept-encoding': 'gzip' },
  })
  if (!response.ok) throw new Error(`Liquipedia HTTP ${response.status}`)
  return response.json()
}

/** Parse the match ticker HTML into rows; the markup is the API's own render output. */
export function parseMatches(html) {
  const text = String(html ?? '')
  const rows = []
  for (const chunk of text.split('<div class="match-info">').slice(1)) {
    const timestamp = Number(/data-timestamp="(\d+)"/.exec(chunk)?.[1] ?? 0)
    if (!timestamp) continue
    const teams = [...chunk.matchAll(/class="name"[^>]*>\s*<a href="\/counterstrike\/([^"#?]+)"[^>]*title="([^"]*)"/g)]
    if (teams.length < 2) continue
    const tournament = /class="match-info-tournament"[\s\S]*?<a href="\/counterstrike\/([^"#?]+)[^"]*"[^>]*title="([^"]+)"/.exec(chunk)
    const bestOf = /scoreholder-lower">\(Bo(\d+)\)/.exec(chunk)?.[1]
    const logos = [...chunk.matchAll(/team-template-image-icon[^>]*>\s*<a[^>]*>\s*<img[^>]*src="([^"]+)"/g)]
      .map((match) => match[1].startsWith('http') ? match[1] : `https://liquipedia.net${match[1]}`)
    rows.push({
      id: `${timestamp}|${teams[0][1]}|${teams[1][1]}`,
      timestamp,
      teamA: teams[0][2] || teams[0][1].replace(/_/g, ' '),
      teamB: teams[1][2] || teams[1][1].replace(/_/g, ' '),
      pageA: teams[0][1],
      pageB: teams[1][1],
      tournament: tournament?.[2] ?? 'Unknown event',
      tournamentPage: tournament?.[1] ?? '',
      logoA: logos[0] ?? null,
      logoB: logos[1] ?? null,
      bestOf: bestOf === undefined ? null : Number(bestOf),
    })
  }
  return rows
}

function normalizeTeam(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function normalizeTier(raw) {
  const text = String(raw ?? '').trim()
  const named = TIER_NAMES[text.toLowerCase()]
  if (named !== undefined) return named
  if (text === '1') return 'S'
  if (text === '2') return 'A'
  if (text === '3') return 'B'
  if (text === '4') return 'C'
  return 'M'
}

function matchesTeams(watched, match) {
  if (watched.length === 0) return true
  const wanted = watched.map(normalizeTeam)
  const candidates = [match.teamA, match.teamB, match.pageA, match.pageB].map(normalizeTeam)
  return wanted.some((team) => team !== '' && candidates.some((candidate) => candidate.includes(team) || team.includes(candidate)))
}

function formatDayTime(timestamp, timeZone = 'Asia/Shanghai') {
  const date = new Date(timestamp * 1000)
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date)
    const value = (type) => parts.find((part) => part.type === type)?.value ?? ''
    return { day: `${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` }
  } catch {
    return { day: '', time: date.toISOString().slice(11, 16) }
  }
}

/** Tournament tier from the page wikitext, cached in the feature state. */
async function tournamentTier(feature, page) {
  if (page === '') return 'M'
  if (feature.tierCache?.[page] !== undefined) return feature.tierCache[page]
  let tier = 'M'
  try {
    const data = await apiJson(
      `${API}?action=query&prop=revisions&rvslots=main&rvprop=content&format=json&formatversion=2&titles=${encodeURIComponent(page)}`,
      'query',
    )
    const content = data?.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content ?? ''
    tier = normalizeTier(/liquipediatier\s*=\s*([^\n|]+)/.exec(content)?.[1])
  } catch {
    tier = 'M'
  }
  if (feature.tierCache === undefined) feature.tierCache = {}
  feature.tierCache[page] = tier
  return tier
}




/** "Intel Extreme Masters/2026/Beijing#Group A" → "Intel Extreme Masters · 2026 · Beijing · A 组". */
function humanizeTournament(title, includeStage = true) {
  const [base, anchor] = String(title ?? '').split('#')
  const parts = base.split('/').map((part) => part.trim()).filter((part) => part !== '')
  const tail = String(anchor ?? '').replace(/^Group\s+/i, '').trim()
  if (includeStage && tail !== '') parts.push(`${tail} 组`)
  return parts.join(' · ')
}

/** One Markdown message per tournament, ordered by their earliest match. */
function composeSections(matches, tiers, timeZone = 'Asia/Shanghai') {
  const groups = new Map()
  for (const match of matches) {
    const key = match.tournamentPage === '' ? match.tournament : match.tournamentPage
    if (!groups.has(key)) {
      groups.set(key, {
        title: humanizeTournament(match.tournament, false),
        tier: tiers.get(match.tournamentPage),
        matches: [],
      })
    }
    groups.get(key).matches.push(match)
  }

  return [...groups.values()]
    .sort((left, right) => left.matches[0].timestamp - right.matches[0].timestamp)
    .map((group) => {
      const tierLabel = group.tier === undefined || group.tier === 'M' ? '' : ` · 🏆 ${group.tier} 级`
      const lines = [`# ${group.title}`, '', `共 ${group.matches.length} 场${tierLabel}`, '']
      const text = [`【CS2 赛事提醒】${group.title}`]
      const matchupLines = []
      for (const match of group.matches) {
        const when = formatDayTime(match.timestamp, timeZone)
        const stage = String(match.tournament).includes('#')
          ? `${String(match.tournament).split('#')[1].replace(/^Group\s+/i, '')} 组`
          : ''
        const bo = match.bestOf === null ? '' : `Bo${match.bestOf}`
        const meta = [bo, stage].filter((part) => part !== '')
        const metaLabel = meta.length === 0 ? '　' : `　${meta.join(' · ')} · `
        const matchup = `- 🕒 **${when.day} ${when.time}**${metaLabel}**${match.teamA}**　⚔　**${match.teamB}**`
        lines.push(matchup)
        matchupLines.push(matchup)
        text.push(`· ${when.day} ${when.time}${meta.length === 0 ? '' : ` ${meta.join(' · ')}`} ${match.teamA}　⚔　${match.teamB}`)
      }
      lines.push('', '---', '数据来源：[Liquipedia](https://liquipedia.net/counterstrike) · CC BY-SA 3.0')
      text.push('数据来源：Liquipedia · CC BY-SA 3.0')
      const page = group.matches[0]?.tournamentPage ?? ''
      return {
        title: group.title, markdown: lines.join('\n'), text: text.join('\n'), matches: group.matches,
        matchupsMarkdown: matchupLines.join('\n'), tier: group.tier,
        sourceUrl: page === '' ? 'https://liquipedia.net/counterstrike' : `https://liquipedia.net/counterstrike/${page}`,
      }
    })
}

function calendarDayKey(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const value = (type) => parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

function digestDayKey(checkedAt, timeZone, digestDay) {
  const today = calendarDayKey(checkedAt, timeZone)
  if (digestDay === 'today') return today
  const [year, month, day] = today.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

function composeDailyDigest(matches, tiers, dayKey, timeZone, part = '') {
  const sections = composeSections(matches, tiers, timeZone)
  const markdown = [
    `# CS2 ${dayKey} 赛程${part}`, '', `共 ${matches.length} 场`, '',
    ...sections.map((section) => section.markdown.split('\n\n---\n')[0].replace(/^# /, '## ')),
    '', '---', '数据来源：[Liquipedia](https://liquipedia.net/counterstrike) · CC BY-SA 3.0',
  ].join('\n')
  const text = [
    `【CS2 ${dayKey} 赛程${part}】共 ${matches.length} 场`,
    ...sections.map((section) => `【${section.title}】\n${section.text.split('\n').slice(1, -1).join('\n')}`),
    '数据来源：Liquipedia · CC BY-SA 3.0',
  ].join('\n')
  return {
    title: `CS2 ${dayKey} 赛程${part}`, markdown, text, matches,
    matchupsMarkdown: sections.map((section) => section.matchupsMarkdown).join('\n'),
    sourceUrl: 'https://liquipedia.net/counterstrike',
  }
}

function composeDailyDigestSections(matches, tiers, dayKey, timeZone) {
  const batches = []
  let batch = []
  for (const match of matches) {
    const next = [...batch, match]
    const candidate = composeDailyDigest(next, tiers, dayKey, timeZone)
    if (batch.length > 0 && Math.max(candidate.markdown.length, candidate.text.length) > MAX_CHUNK_CHARS - 50) {
      batches.push(batch)
      batch = [match]
    } else batch = next
  }
  if (batch.length > 0) batches.push(batch)
  return batches.map((items, index) => composeDailyDigest(items, tiers, dayKey, timeZone,
    batches.length > 1 ? `（${index + 1}/${batches.length}）` : ''))
}

/** The one match worth a picture card: the soonest followed team's match in the next day. */
function pickFocus(matches, watched, nowMs) {
  const soon = matches.filter((match) => {
    const at = match.timestamp * 1000
    return at >= nowMs - 30 * 60_000 && at <= nowMs + 24 * 60 * 60_000
  })
  if (soon.length === 0) return undefined
  const followed = soon.filter((match) => {
    const check = (name) => {
      const wanted = watched.map(normalizeTeam)
      const normalized = normalizeTeam(name)
      return wanted.some((team) => team !== '' && (normalized.includes(team) || team.includes(normalized)))
    }
    return check(match.teamA) || check(match.teamB)
  })
  const pool = followed.length > 0 ? followed : soon
  return [...pool].sort((left, right) => left.timestamp - right.timestamp)[0]
}

function pruneSeen(feature, checkedAt) {
  const floor = checkedAt - SEEN_RETENTION_MS
  if (feature.seen === undefined) feature.seen = {}
  for (const [key, at] of Object.entries(feature.seen)) {
    if (typeof at !== 'number' || at < floor) delete feature.seen[key]
  }
}

/**
 * Build the provider the feature runtime calls.
 * @returns a provider receiving `{ feature, target, ctx, now }`.
 */
export function createLiquipediaProvider(options = {}) {
  const notificationDispatcher = options.notificationDispatcher ?? createNotificationDispatcher(options)
  const readMatches = options.loadMatches ?? loadMatches
  return async ({ feature, settings, target, now, forceResend = false }) => {
    const sourceId = feature.source?.id ?? 'none'
    if (sourceId === 'none') return { matched: 0, sent: 0, error: '数据源尚未接入' }
    if (sourceId !== 'liquipedia') return { matched: 0, sent: 0, error: `数据源 ${sourceId} 尚未实现，请选择 Liquipedia` }

    const checkedAt = now()
    const matches = parseCache.at !== 0 && checkedAt - parseCache.at < PARSE_CACHE_MS
      ? parseCache.matches
      : (await readMatches())
    if (matches === undefined) return { matched: 0, sent: 0, error: 'Liquipedia 请求过于频繁，稍后再试' }

    const noticeMode = feature.noticeMode ?? 'legacy'
    const timeZone = feature.timeZone ?? 'Asia/Shanghai'
    const dayKey = noticeMode === 'daily-digest' ? digestDayKey(checkedAt, timeZone, feature.digestDay) : ''
    const leadMinutes = Math.min(360, Math.max(15, Number(feature.leadMinutes) || 60))
    const watched = Array.isArray(feature.values?.teams) ? feature.values.teams : []
    const wantedTiers = Array.isArray(feature.values?.tiers) ? feature.values.tiers : []
    const candidates = matches.filter((match) => {
      const at = match.timestamp * 1000
      if (!matchesTeams(watched, match)) return false
      if (noticeMode === 'daily-digest') return calendarDayKey(at, timeZone) === dayKey
      if (noticeMode === 'pre-match') return at > checkedAt && at <= checkedAt + leadMinutes * 60_000
      return at >= checkedAt - 6 * 60 * 60_000
    })

    const tiers = new Map()
    let selected = candidates
    if (wantedTiers.length > 0) {
      for (const page of new Set(candidates.map((match) => match.tournamentPage))) {
        tiers.set(page, await tournamentTier(feature, page))
      }
      selected = candidates.filter((match) => wantedTiers.includes(tiers.get(match.tournamentPage) ?? 'M'))
    }

    pruneSeen(feature, checkedAt)
    const fresh = selected
      .filter((match) => forceResend || (noticeMode === 'daily-digest'
        ? feature.seen[`digest:${dayKey}`] === undefined && feature.seen[`digestmatch:${dayKey}:${match.id}`] === undefined
        : feature.seen[noticeMode === 'pre-match' ? `pre:${match.id}` : match.id] === undefined))
      .sort((left, right) => left.timestamp - right.timestamp)

    if (fresh.length === 0) return { matched: selected.length, sent: 0 }

    const sections = noticeMode === 'daily-digest'
      ? composeDailyDigestSections(fresh, tiers, dayKey, timeZone)
      : composeSections(fresh, tiers, timeZone)
    const markSeen = (section) => {
      if (noticeMode === 'daily-digest') {
        for (const match of section.matches) feature.seen[`digestmatch:${dayKey}:${match.id}`] = checkedAt
      }
      else for (const match of section.matches) feature.seen[noticeMode === 'pre-match' ? `pre:${match.id}` : match.id] = checkedAt
    }
    let channel = 'service-turn'
    for (const section of sections) {
      const outcome = await notificationDispatcher.dispatch({
        settings,
        sessionId: target.sessionId,
        markdown: section.markdown,
        servicePrompt: () => feature.deliveryMode === 'service-turn'
          ? composeCs2ServiceTurnPrompt(section, feature.serviceTemplate, pickFocus(section.matches, watched, now()) ?? section.matches[0])
          : composeCs2FixedNoticePrompt(section.markdown),
      })
      channel = outcome.channel
      markSeen(section)
    }
    if (noticeMode === 'daily-digest') feature.seen[`digest:${dayKey}`] = checkedAt

    return { matched: selected.length, sent: fresh.length, channel }
  }
}

/** Load the ticker once per cache window; a throttled repeat answers from the cache. */
async function loadMatches() {
  try {
    parseCache = { at: 0, matches: parseCache.matches }
    const data = await apiJson(
      `${API}?action=parse&page=Liquipedia:Matches&prop=text&format=json&formatversion=2`,
      'parse',
    )
    const matches = parseMatches(data?.parse?.text)
    parseCache = { at: Date.now(), matches }
    return matches
  } catch {
    return parseCache.matches.length > 0 ? parseCache.matches : undefined
  }
}
