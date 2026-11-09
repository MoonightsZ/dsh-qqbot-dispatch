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
 * @module dsh-tool-qqbot-dispatch/liquipedia
 */
import { randomUUID } from 'node:crypto'

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

function formatDayTime(timestamp) {
  const date = new Date(timestamp * 1000)
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
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
function composeSections(matches, tiers) {
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
      for (const match of group.matches) {
        const when = formatDayTime(match.timestamp)
        const stage = String(match.tournament).includes('#')
          ? `${String(match.tournament).split('#')[1].replace(/^Group\s+/i, '')} 组`
          : ''
        const bo = match.bestOf === null ? '' : `Bo${match.bestOf}`
        const meta = [bo, stage].filter((part) => part !== '')
        const metaLabel = meta.length === 0 ? '　' : `　${meta.join(' · ')} · `
        lines.push(`- 🕒 **${when.day} ${when.time}**${metaLabel}**${match.teamA}**　⚔　**${match.teamB}**`)
        text.push(`· ${when.day} ${when.time}${meta.length === 0 ? '' : ` ${meta.join(' · ')}`} ${match.teamA}　⚔　${match.teamB}`)
      }
      lines.push('', '---', '数据来源：[Liquipedia](https://liquipedia.net/counterstrike) · CC BY-SA 3.0')
      text.push('数据来源：Liquipedia · CC BY-SA 3.0')
      return { title: group.title, markdown: lines.join('\n'), text: text.join('\n'), matches: group.matches }
    })
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

/** 图文卡片 for the focus match; needs an https team logo from the parse. */
function composeCard(match, tiers) {
  if (match === undefined) return undefined
  const picture = match.logoA ?? match.logoB
  if (picture === null || picture === undefined) return undefined
  const when = formatDayTime(match.timestamp)
  const tier = tiers.get(match.tournamentPage)
  const title = [...`${when.time} ${match.teamA}　⚔　${match.teamB}`].slice(0, 50).join('')
  const description = [
    humanizeTournament(match.tournament),
    tier === undefined || tier === 'M' ? '' : `${tier} 级`,
    match.bestOf === null ? '' : `Bo${match.bestOf}`,
  ].filter((part) => part !== '').join(' · ').slice(0, 200)
  const url = match.tournamentPage === ''
    ? 'https://liquipedia.net/counterstrike'
    : `https://liquipedia.net/counterstrike/${match.tournamentPage}`
  return { type: 'tuwen', content: { title, description, url, pic_url: picture } }
}


function pruneSeen(feature) {
  const floor = Date.now() - SEEN_RETENTION_MS
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
  const deliver = options.deliver
  return async ({ feature, target, ctx, now }) => {
    const sourceId = feature.source?.id ?? 'none'
    if (sourceId === 'none') return { matched: 0, sent: 0, error: '数据源尚未接入' }
    if (sourceId !== 'liquipedia') return { matched: 0, sent: 0, error: `数据源 ${sourceId} 尚未实现，请选择 Liquipedia` }

    const checkedAt = now()
    const matches = parseCache.at !== 0 && checkedAt - parseCache.at < PARSE_CACHE_MS
      ? parseCache.matches
      : (await loadMatches())
    if (matches === undefined) return { matched: 0, sent: 0, error: 'Liquipedia 请求过于频繁，稍后再试' }

    const watched = Array.isArray(feature.values?.teams) ? feature.values.teams : []
    const wantedTiers = Array.isArray(feature.values?.tiers) ? feature.values.tiers : []
    const candidates = matches.filter((match) => match.timestamp * 1000 >= checkedAt - 6 * 60 * 60_000 && matchesTeams(watched, match))

    const tiers = new Map()
    let selected = candidates
    if (wantedTiers.length > 0) {
      for (const page of new Set(candidates.map((match) => match.tournamentPage))) {
        tiers.set(page, await tournamentTier(feature, page))
      }
      selected = candidates.filter((match) => wantedTiers.includes(tiers.get(match.tournamentPage) ?? 'M'))
    }

    pruneSeen(feature)
    const fresh = selected
      .filter((match) => feature.seen[match.id] === undefined)
      .sort((left, right) => left.timestamp - right.timestamp)

    if (fresh.length === 0) return { matched: selected.length, sent: 0 }

    const sections = composeSections(fresh, tiers)
    const focus = pickFocus(fresh, watched, now())
    const card = feature.focusCard === false ? undefined : composeCard(focus, tiers)
    let channel = 'session'
    if (typeof deliver === 'function') {
      for (const section of sections) {
        const sectionCard = focus !== undefined && card !== undefined && section.matches.includes(focus) ? card : undefined
        const outcome = await deliver({ target, text: section.text, markdown: section.markdown, card: sectionCard, ctx })
        if (typeof outcome?.channel === 'string') channel = outcome.channel
      }
    } else {
      for (const section of sections) {
        await ctx.sessionController.prompt({
          requestId: randomUUID(),
          sessionId: target.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: section.text }],
        }, new AbortController().signal)
      }
    }

    for (const match of fresh) feature.seen[match.id] = checkedAt
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
