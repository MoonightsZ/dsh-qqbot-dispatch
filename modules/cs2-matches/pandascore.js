/** PandaScore fixture adapter. CS2 endpoints keep the historical /csgo/ prefix. */
const API = 'https://api.pandascore.co/csgo/matches'
const SOURCE_URL = 'https://www.pandascore.co/'
const MAX_PAGES = 10

export function normalizePandaScoreMatch(raw) {
  if (raw?.status === 'canceled' || raw?.status === 'postponed') return null
  const timestamp = Date.parse(raw?.scheduled_at)
  const opponents = raw?.opponents
  if (!Number.isFinite(timestamp) || !Array.isArray(opponents) || opponents.length !== 2 || raw?.id == null) return null
  const teams = opponents.map((item) => item?.type === 'Team' ? item.opponent : null)
  if (teams.some((team) => !team?.name || team.id == null)) return null
  const finished = raw.status === 'finished'
  // Results are keyed by team ID; their order need not match the opponents array.
  const score = (team) => {
    if (!finished) return null
    const value = raw.results?.find((item) => String(item?.team_id ?? item?.opponent_id) === String(team.id))?.score
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  }
  const seriesName = raw.serie?.full_name || raw.serie?.name || raw.league?.name || '未知赛事'
  const stage = raw.tournament?.name
  return {
    id: `pandascore:${raw.id}`, identity: `pandascore:${raw.id}`,
    timestamp: Math.floor(timestamp / 1000),
    teamA: teams[0].name, teamB: teams[1].name,
    pageA: teams[0].slug ?? '', pageB: teams[1].slug ?? '',
    tournament: stage && stage !== seriesName ? `${seriesName} · ${stage}` : seriesName,
    tournamentPage: `pandascore:${raw.tournament?.id ?? raw.serie?.id ?? raw.id}`,
    bestOf: Number.isSafeInteger(raw.number_of_games) && raw.number_of_games > 0 ? raw.number_of_games : null,
    finished, scoreA: score(teams[0]), scoreB: score(teams[1]), round: '',
    sourceName: 'PandaScore', sourceUrl: SOURCE_URL, sourceLicense: '', valveTier: '',
    // PandaScore's own tournament rating is not a Valve Tier.
    sourceTier: String(raw.tournament?.tier ?? raw.serie?.tier ?? '').toUpperCase(),
  }
}

/** Read a bounded scheduled-time window. Reject incomplete pagination instead of sending a partial digest. */
export async function loadPandaScoreMatches({ token, nowMs, fetcher = fetch, pageSize = 100 }) {
  if (typeof token !== 'string' || token.trim() === '') throw new Error('PandaScore API Key 未配置')
  const size = Math.min(100, Math.max(1, Math.floor(pageSize)))
  const from = new Date(nowMs - 6 * 60 * 60_000).toISOString()
  const to = new Date(nowMs + 48 * 60 * 60_000).toISOString()
  const rows = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(API)
    url.searchParams.set('range[scheduled_at]', `${from},${to}`)
    url.searchParams.set('page[number]', String(page))
    url.searchParams.set('page[size]', String(size))
    url.searchParams.set('sort', 'scheduled_at')
    // Bound each request so a stalled API cannot hold the feature's run lock indefinitely.
    const response = await fetcher(url, { headers: { accept: 'application/json', authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`PandaScore HTTP ${response.status}`)
    const batch = await response.json()
    if (!Array.isArray(batch)) throw new Error('PandaScore 返回的赛程格式无效')
    rows.push(...batch)
    const totalHeader = response.headers?.get?.('x-total')
    const total = totalHeader == null ? NaN : Number(totalHeader)
    if (batch.length < size || (Number.isSafeInteger(total) && total >= 0 && rows.length >= total)) {
      return rows.map(normalizePandaScoreMatch).filter(Boolean)
    }
  }
  throw new Error('PandaScore 赛程超过分页上限，未发送不完整通知')
}
