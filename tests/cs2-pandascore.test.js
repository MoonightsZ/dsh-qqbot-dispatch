import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePandaScoreMatch, loadPandaScoreMatches } from '../modules/cs2-matches/pandascore.js'
import { createCs2Provider, previewCs2FixedNotice } from '../modules/cs2-matches/provider.js'
import { credentialRefFor, configFromInput } from '../features.js'
import { CS2_SOURCES } from '../modules/cs2-matches/sources.js'
import { createFeatureRuntime } from '../features.js'
import { definition } from '../modules/cs2-matches/definition.js'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { composeCs2ServiceTurnPrompt, DEFAULT_CS2_PRE_MATCH_TEMPLATE } from '../modules/cs2-matches/template.js'

const match = {
  id: 123, scheduled_at: '2026-11-25T12:00:00Z', status: 'finished', number_of_games: 3,
  opponents: [
    { type: 'Team', opponent: { id: 10, name: 'Spirit', slug: 'spirit' } },
    { type: 'Team', opponent: { id: 20, name: 'Vitality', slug: 'vitality' } },
  ],
  results: [{ team_id: 20, score: 2 }, { team_id: 10, score: 1 }],
  league: { name: 'IEM' }, serie: { full_name: 'IEM Fall', tier: 's' },
  tournament: { id: 70, name: 'Playoffs', tier: 's' },
}

test('PandaScore 比赛按队伍 ID 对齐比分，并保留渠道来源', () => {
  assert.deepEqual(normalizePandaScoreMatch(match), {
    id: 'pandascore:123', identity: 'pandascore:123', timestamp: 1795608000,
    teamA: 'Spirit', teamB: 'Vitality', pageA: 'spirit', pageB: 'vitality',
    tournament: 'IEM Fall · Playoffs', tournamentPage: 'pandascore:70',
    bestOf: 3, finished: true, scoreA: 1, scoreB: 2, round: '',
    sourceName: 'PandaScore', sourceUrl: 'https://www.pandascore.co/', sourceLicense: '',
    valveTier: '', sourceTier: 'S',
  })
})

test('PandaScore 跳过无赛程或无双队伍比赛，不把进行中比分当赛果', () => {
  assert.equal(normalizePandaScoreMatch({ ...match, scheduled_at: null }), null)
  assert.equal(normalizePandaScoreMatch({ ...match, opponents: [match.opponents[0]] }), null)
  assert.equal(normalizePandaScoreMatch({ ...match, status: 'canceled' }), null)
  assert.equal(normalizePandaScoreMatch({ ...match, status: 'postponed' }), null)
  assert.deepEqual([normalizePandaScoreMatch({ ...match, status: 'running' }).scoreA,
    normalizePandaScoreMatch({ ...match, status: 'running' }).scoreB], [null, null])
})

test('PandaScore 分页读取时间范围，Bearer token 不进入 URL 或错误', async () => {
  const requests = []
  const fetcher = async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal)
    requests.push({ url: String(url), auth: options.headers.authorization })
    return { ok: true, headers: { get: (name) => name === 'x-total' ? '2' : null },
      json: async () => requests.length === 1 ? [match] : [{ ...match, id: 124 }] }
  }
  const matches = await loadPandaScoreMatches({ token: 'secret-test-token', nowMs: Date.parse('2026-11-25T12:00:00Z'), fetcher, pageSize: 1 })
  assert.equal(matches.length, 2)
  assert.equal(requests.length, 2)
  assert.ok(requests.every(({ url, auth }) => url.includes('/csgo/matches?') && !url.includes('secret-test-token') && auth === 'Bearer secret-test-token'))
  await assert.rejects(loadPandaScoreMatches({ token: 'secret-test-token', nowMs: Date.now(),
    fetcher: async () => ({ ok: false, status: 401, headers: { get: () => null } }) }), /PandaScore HTTP 401/)
})

test('PandaScore 缺少总数响应头时仍读取后续分页', async () => {
  let page = 0
  const matches = await loadPandaScoreMatches({ token: 'secret-test-token', nowMs: Date.parse('2026-11-25T12:00:00Z'),
    pageSize: 1, fetcher: async () => ({ ok: true, headers: { get: () => null },
      json: async () => ++page === 1 ? [match] : [] }) })
  assert.equal(page, 2)
  assert.equal(matches.length, 1)
})

test('PandaScore 渠道从独立凭证引用读取 token，并沿用共用赛前通知', async () => {
  assert.notEqual(credentialRefFor('cs2-matches', 'pandascore'), credentialRefFor('cs2-matches'))
  const sent = []
  const resolved = []
  const provider = createCs2Provider({
    loadPandaScoreMatches: async ({ token }) => {
      assert.equal(token, 'secret-test-token')
      return [normalizePandaScoreMatch({ ...match, status: 'not_started', results: [], scheduled_at: '2026-11-25T12:30:00Z' })]
    },
    notificationDispatcher: { dispatch: async (payload) => { sent.push(payload.markdown); return { channel: 'upstream-sdk' } } },
  })
  const feature = { source: { id: 'pandascore' }, noticeMode: 'pre-match', leadMinutes: 60,
    values: { teams: [], tiers: [], valveTiers: [] }, seen: {} }
  const result = await provider({ feature, settings: {}, target: { sessionId: 'one' },
    ctx: { get: () => ({ resolve: async (ref) => { resolved.push(ref); return { value: 'secret-test-token' } } }) },
    now: () => Date.parse('2026-11-25T12:00:00Z') })
  assert.equal(result.sent, 1)
  assert.deepEqual(resolved, [credentialRefFor('cs2-matches', 'pandascore')])
  assert.match(sent[0], /PandaScore/)
  assert.doesNotMatch(sent[0], /Liquipedia|CC BY-SA/)
})

test('PandaScore 使用来源 Tier 筛选，忽略仅属于 Liquipedia 的 Valve Tier 设置', async () => {
  const provider = createCs2Provider({
    loadPandaScoreMatches: async () => [normalizePandaScoreMatch({ ...match, status: 'not_started',
      results: [], scheduled_at: '2026-11-25T12:30:00Z' })],
    notificationDispatcher: { dispatch: async () => ({ channel: 'upstream-sdk' }) },
  })
  const base = { source: { id: 'pandascore' }, noticeMode: 'pre-match', leadMinutes: 60,
    seen: {} }
  const args = { settings: {}, target: { sessionId: 'one' },
    ctx: { get: () => ({ resolve: async () => ({ value: 'secret-test-token' }) }) },
    now: () => Date.parse('2026-11-25T12:00:00Z') }
  assert.equal((await provider({ ...args, feature: { ...base, seen: {}, values: { teams: [], tiers: ['S'], valveTiers: [] } } })).sent, 1)
  assert.equal((await provider({ ...args, feature: { ...base, seen: {}, values: { teams: [], tiers: ['A'], valveTiers: [] } } })).sent, 0)
  assert.equal((await provider({ ...args, feature: { ...base, seen: {}, values: { teams: [], tiers: [], valveTiers: ['Major'] } } })).sent, 1)
})

test('PandaScore 服务回合正文标注真实来源和来源 Tier', () => {
  const prompt = composeCs2ServiceTurnPrompt({ title: 'IEM', sourceName: 'PandaScore',
    markdown: '# ⚔ 即将开赛｜IEM\nPandaScore Tier：S\n- Spirit vs Vitality\n\n---\n数据来源：[PandaScore](https://www.pandascore.co/)' },
  DEFAULT_CS2_PRE_MATCH_TEMPLATE, { teamA: 'Spirit', teamB: 'Vitality' }, 'pre-match')
  assert.match(prompt, /PandaScore Tier：S/)
  assert.match(prompt, /数据来源：\[PandaScore\]/)
  assert.doesNotMatch(prompt, /Liquipedia|CC BY-SA/)
})

test('PandaScore 设置页预览使用 PandaScore 来源', () => {
  const preview = previewCs2FixedNotice('pre-match', 'Asia/Shanghai', 'pandascore')
  assert.match(preview, /PandaScore/)
  assert.doesNotMatch(preview, /Liquipedia|CC BY-SA/)
})

test('PandaScore D 级可保存为来源 Tier，不改写成 Valve Tier', () => {
  const saved = configFromInput(definition, { source: { id: 'pandascore' },
    values: { tiers: ['D'], valveTiers: [] } })
  assert.deepEqual(saved.values.tiers, ['D'])
  assert.equal(normalizePandaScoreMatch({ ...match, tournament: { ...match.tournament, tier: 'd' } }).sourceTier, 'D')
})

test('渠道声明 Valve Tier 能力，新配置按渠道选择等级类型', () => {
  assert.equal(CS2_SOURCES.find((source) => source.id === 'liquipedia').hasValveTier, true)
  assert.equal(CS2_SOURCES.find((source) => source.id === 'pandascore').hasValveTier, false)
  const saved = configFromInput(definition, { source: { id: 'liquipedia' }, tierMode: 'channel',
    values: { tiers: ['S'], valveTiers: ['Major'] } })
  assert.equal(saved.tierMode, 'channel')
})

test('新 Liquipedia 配置只按 Valve Tier 筛选，不用来源 S 级补位', async () => {
  const now = Date.parse('2026-11-25T12:00:00Z')
  const provider = createCs2Provider({
    loadMatches: async () => [{ id: 'one', timestamp: (now + 30 * 60_000) / 1000,
      teamA: 'Spirit', teamB: 'Vitality', tournament: 'IEM', tournamentPage: 'IEM/2026',
      bestOf: 3, finished: false, scoreA: null, scoreB: null }],
    loadTournamentPage: async () => '|liquipediatier=S-Tier\n',
    notificationDispatcher: { dispatch: async () => ({ channel: 'upstream-sdk' }) },
  })
  const result = await provider({ feature: { source: { id: 'liquipedia' }, tierMode: 'channel',
    noticeMode: 'pre-match', leadMinutes: 60, values: { teams: [], tiers: ['S'], valveTiers: ['Major'] },
    seen: {}, tierCache: {} }, settings: {}, target: { sessionId: 'one' }, now: () => now })
  assert.equal(result.sent, 0)
})

test('PandaScore 凭证写入独立宿主引用，不进入功能状态文件', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-panda-')), 'features.json')
  const secrets = new Map()
  const credentials = { set: async (ref, value) => secrets.set(ref, value),
    describe: async (ref) => ({ configured: secrets.has(ref), writable: true }) }
  const runtime = createFeatureRuntime({ statePath: path, ctx: { get: () => credentials } })
  const before = (await runtime.snapshot()).features.find((feature) => feature.id === 'cs2-matches')
  await runtime.save('cs2-matches', { ...before, source: { id: 'pandascore' }, credential: 'secret-test-token' })
  const after = (await runtime.snapshot()).features.find((feature) => feature.id === 'cs2-matches')
  assert.equal(after.credential.ref, credentialRefFor('cs2-matches', 'pandascore'))
  assert.equal(after.credential.configured, true)
  assert.equal(secrets.get(after.credential.ref), 'secret-test-token')
  assert.doesNotMatch(readFileSync(path, 'utf8'), /secret-test-token/)
})

test('切换渠道保留各自 API Key，仅明确清除当前渠道的 Key', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-source-keys-')), 'features.json')
  const secrets = new Map()
  const credentials = {
    set: async (ref, value) => secrets.set(ref, value),
    unset: async (ref) => secrets.delete(ref),
    describe: async (ref) => ({ configured: secrets.has(ref), writable: true }),
  }
  const runtime = createFeatureRuntime({ statePath: path, ctx: { get: () => credentials } })
  const getCs2 = async () => (await runtime.snapshot()).features.find((feature) => feature.id === 'cs2-matches')
  const liquipediaRef = credentialRefFor('cs2-matches', 'liquipedia')
  const pandascoreRef = credentialRefFor('cs2-matches', 'pandascore')
  await runtime.save('cs2-matches', { ...await getCs2(), source: { id: 'liquipedia' }, credential: 'liquipedia-key' })
  await runtime.save('cs2-matches', { ...await getCs2(), source: { id: 'pandascore' }, credential: 'pandascore-key' })
  const panda = await getCs2()
  assert.equal(panda.providerLabel, 'PandaScore')
  assert.equal(panda.credentialStatuses.liquipedia.configured, true)
  assert.equal(panda.credentialStatuses.pandascore.configured, true)
  await runtime.save('cs2-matches', { ...panda, source: { id: 'liquipedia' } })
  assert.equal((await getCs2()).credential.configured, true)
  assert.equal(secrets.get(liquipediaRef), 'liquipedia-key')
  assert.equal(secrets.get(pandascoreRef), 'pandascore-key')
  await runtime.save('cs2-matches', { ...await getCs2(), source: { id: 'pandascore' }, clearCredential: true })
  assert.equal(secrets.has(pandascoreRef), false)
  assert.equal(secrets.get(liquipediaRef), 'liquipedia-key')
  assert.doesNotMatch(readFileSync(path, 'utf8'), /liquipedia-key|pandascore-key/)
})

test('旧 Liquipedia 状态保留旧等级语义，新状态使用渠道等级', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-tier-')), 'features.json')
  const ctx = { get: () => undefined }
  const runtime = createFeatureRuntime({ statePath: path, ctx })
  assert.equal((await runtime.snapshot()).features.find((feature) => feature.id === 'cs2-matches').tierMode, 'channel')
  writeFileSync(path, JSON.stringify({ features: { 'cs2-matches': { source: { id: 'liquipedia' },
    values: { teams: [], tiers: ['S'], valveTiers: [] } } } }), 'utf8')
  assert.equal((await runtime.snapshot()).features.find((feature) => feature.id === 'cs2-matches').tierMode, 'legacy')
})

test('CS2 默认 Liquipedia，旧未接入与自定义来源迁移为 Liquipedia', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-source-')), 'features.json')
  const runtime = createFeatureRuntime({ statePath: path, ctx: { get: () => undefined } })
  const getCs2 = async () => (await runtime.snapshot()).features.find((feature) => feature.id === 'cs2-matches')
  assert.equal((await getCs2()).source.id, 'liquipedia')
  assert.deepEqual((await getCs2()).sources.map((source) => source.id), ['liquipedia', 'pandascore'])
  for (const id of ['none', 'custom']) {
    writeFileSync(path, JSON.stringify({ features: { 'cs2-matches': { enabled: true, source: { id } } } }), 'utf8')
    assert.equal((await getCs2()).source.id, 'liquipedia')
    assert.equal((await getCs2()).enabled, false)
  }
  assert.equal(configFromInput(definition, { source: { id: 'custom' } }).source.id, 'liquipedia')
})

test('PandaScore 换凭证和手动检查会刷新赛程缓存', async () => {
  let token = 'first-key'
  let loads = 0
  const provider = createCs2Provider({ loadPandaScoreMatches: async () => { loads++; return [] } })
  const args = { feature: { source: { id: 'pandascore' }, values: {}, seen: {} }, settings: {},
    target: { sessionId: 'one' }, ctx: { get: () => ({ resolve: async () => ({ value: token }) }) },
    now: () => Date.parse('2026-11-25T09:00:00Z') }
  await provider(args)
  await provider(args)
  assert.equal(loads, 1)
  token = 'second-key'
  await provider(args)
  assert.equal(loads, 2)
  await provider({ ...args, manual: true })
  assert.equal(loads, 3)
})

test('从 Liquipedia 切换 PandaScore 后，当日汇总去重互不影响', async () => {
  const sent = []
  const provider = createCs2Provider({
    loadPandaScoreMatches: async () => [normalizePandaScoreMatch({ ...match, status: 'not_started', results: [] })],
    notificationDispatcher: { dispatch: async ({ markdown }) => { sent.push(markdown); return { channel: 'upstream-sdk' } } },
  })
  const feature = { source: { id: 'pandascore' }, noticeMode: 'daily-digest', digestDay: 'today',
    values: { teams: [], tiers: [], valveTiers: [] }, seen: { 'digest:2026-11-25': Date.parse('2026-11-25T00:00:00Z') } }
  const result = await provider({ feature, settings: {}, target: { sessionId: 'one' },
    ctx: { get: () => ({ resolve: async () => ({ value: 'secret-test-token' }) }) },
    now: () => Date.parse('2026-11-25T09:00:00Z') })
  assert.equal(result.sent, 1)
  assert.match(sent[0], /PandaScore/)
  assert.ok(feature.seen['pandascore:digest:2026-11-25'])
})

test('PandaScore 改期通知使用来源 Tier 与来源署名', async () => {
  let checkedAt = Date.parse('2026-11-25T12:00:00Z')
  let scheduledAt = '2026-11-25T12:30:00Z'
  const sent = []
  const provider = createCs2Provider({ loadPandaScoreMatches: async () => [normalizePandaScoreMatch({
    ...match, status: 'not_started', results: [], scheduled_at: scheduledAt })],
  notificationDispatcher: { dispatch: async ({ markdown }) => { sent.push(markdown); return { channel: 'upstream-sdk' } } } })
  const feature = { source: { id: 'pandascore' }, noticeMode: 'pre-match', leadMinutes: 60,
    values: { teams: [], tiers: [], valveTiers: [] }, seen: {} }
  const args = { feature, settings: {}, target: { sessionId: 'one' },
    ctx: { get: () => ({ resolve: async () => ({ value: 'secret-test-token' }) }) }, now: () => checkedAt }
  await provider(args)
  checkedAt += 6 * 60_000
  scheduledAt = '2026-11-25T12:50:00Z'
  await provider(args)
  assert.match(sent.at(-1), /PandaScore Tier/)
  assert.match(sent.at(-1), /数据来源：\[PandaScore\]/)
  assert.doesNotMatch(sent.at(-1), /Valve Tier|Liquipedia|CC BY-SA/)
})
