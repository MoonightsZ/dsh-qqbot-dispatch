import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLiquipediaProvider } from '../modules/cs2-matches/provider.js'
import { createFeatureRuntime } from '../features.js'

test('立即检查去重，立即发送重发已通知的匹配赛事', async () => {
  const now = Date.parse('2026-11-09T10:00:00Z')
  const match = {
    id: 'match-one', timestamp: Math.floor((now + 60_000) / 1000),
    teamA: 'Team A', teamB: 'Team B', pageA: 'Team_A', pageB: 'Team_B',
    tournament: 'Test Cup', tournamentPage: '', logoA: null, logoB: null, bestOf: 3,
  }
  const sent = []
  const provider = createLiquipediaProvider({
    loadMatches: async () => [match],
    serviceTurn: { dispatch: async (message) => { sent.push(message) } },
  })
  const feature = {
    source: { id: 'liquipedia' }, values: { teams: [], tiers: [] },
    seen: { [match.id]: now - 1000 }, focusCard: false,
  }
  const input = { feature, target: { sessionId: 'session-1' }, ctx: {}, now: () => now, manual: true }
  assert.equal((await provider(input)).sent, 0)
  assert.equal((await provider({ ...input, forceResend: true })).sent, 1)
  assert.equal(sent.length, 1)
})

test('每日汇总只发送指定日期赛程，同一天重复检查不再发送', async () => {
  const now = Date.parse('2026-11-09T10:00:00Z')
  const match = (id, hours, tournament = 'Test Cup') => ({
    id, timestamp: Math.floor((now + hours * 3_600_000) / 1000),
    teamA: id, teamB: 'Team B', pageA: 'Team_A', pageB: 'Team_B',
    tournament, tournamentPage: '', logoA: null, logoB: null, bestOf: 3,
  })
  const sent = []
  const provider = createLiquipediaProvider({
    loadMatches: async () => [match('today', 1), match('tomorrow-a', 16), match('tomorrow-b', 20, 'Other Cup'), match('later', 40)],
    serviceTurn: { dispatch: async (item) => { sent.push(item) } },
  })
  const feature = {
    source: { id: 'liquipedia' }, noticeMode: 'daily-digest', digestDay: 'tomorrow',
    timeZone: 'Asia/Shanghai', values: { teams: [], tiers: [] }, seen: {},
  }
  const input = { feature, target: { sessionId: 'session-1' }, now: () => now }
  assert.equal((await provider(input)).sent, 2)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /Test Cup/)
  assert.match(sent[0].text, /Other Cup/)
  assert.doesNotMatch(sent[0].text, /today|later/)
  assert.equal((await provider(input)).sent, 0)
  assert.equal(sent.length, 1)
  assert.equal((await provider({ ...input, forceResend: true })).sent, 2)
  assert.equal(sent.length, 2)
})

test('赛前提醒只发送首次进入提前量窗口的赛事', async () => {
  const now = Date.parse('2026-11-09T10:00:00Z')
  let checkedAt = now
  const match = (id, minutes) => ({
    id, timestamp: Math.floor((now + minutes * 60_000) / 1000),
    teamA: 'Team A', teamB: 'Team B', pageA: 'Team_A', pageB: 'Team_B',
    tournament: 'Test Cup', tournamentPage: '', logoA: null, logoB: null, bestOf: 3,
  })
  const sent = []
  const provider = createLiquipediaProvider({
    loadMatches: async () => [match('past', -1), match('soon', 30), match('edge', 60), match('later', 90)],
    serviceTurn: { dispatch: async (item) => { sent.push(item) } },
  })
  const feature = {
    source: { id: 'liquipedia' }, noticeMode: 'pre-match', leadMinutes: 60,
    values: { teams: [], tiers: [] }, seen: {},
  }
  const input = { feature, target: { sessionId: 'session-1' }, now: () => checkedAt }
  assert.equal((await provider(input)).sent, 2)
  assert.equal((await provider(input)).sent, 0)
  checkedAt += 45 * 60_000
  assert.equal((await provider(input)).sent, 1)
  assert.equal(sent.length, 2)
})

test('同一场赛事已进每日汇总后仍可在赛前提醒', async () => {
  const now = Date.parse('2026-11-09T10:00:00Z')
  const match = { id: 'overlap-one', timestamp: Math.floor((now + 30 * 60_000) / 1000),
    teamA: 'Team A', teamB: 'Team B', pageA: 'Team_A', pageB: 'Team_B',
    tournament: 'Test Cup', tournamentPage: '', logoA: null, logoB: null, bestOf: 3 }
  const sent = []
  const provider = createLiquipediaProvider({ loadMatches: async () => [match], upstreamSender: { send: async (item) => sent.push(item) } })
  const feature = { source: { id: 'liquipedia' }, noticeMode: 'daily-digest', digestDay: 'today', leadMinutes: 60,
    timeZone: 'Asia/Shanghai', values: { teams: [], tiers: [] }, seen: {} }
  const input = { feature, settings: { deliveryMethod: 'upstream-sdk' }, target: { sessionId: 'session-1' }, now: () => now }
  assert.equal((await provider({ ...input, noticeMode: 'daily-digest' })).sent, 1)
  assert.equal((await provider({ ...input, noticeMode: 'pre-match' })).sent, 1)
  assert.equal(sent.length, 2)
  assert.ok(feature.seen['pre:overlap-one'])
})

test('较长的每日汇总分段发送，部分失败后只补发未成功的赛事', async () => {
  const now = Date.parse('2026-11-09T10:00:00Z')
  const matches = Array.from({ length: 25 }, (_, index) => ({
    id: `match-${index}`, timestamp: Math.floor((now + 16 * 3_600_000 + index * 60_000) / 1000),
    teamA: `Team-${index}-${'X'.repeat(80)}`, teamB: 'Team B', pageA: 'Team_A', pageB: 'Team_B',
    tournament: 'Long Cup', tournamentPage: '', logoA: null, logoB: null, bestOf: 3,
  }))
  const sent = []
  let failSecond = true
  const provider = createLiquipediaProvider({
    loadMatches: async () => matches,
    upstreamSender: { send: async (item) => {
      if (failSecond && sent.length === 1) { failSecond = false; throw new Error('第二段失败') }
      sent.push(item)
    } },
  })
  const feature = { source: { id: 'liquipedia' }, noticeMode: 'daily-digest', digestDay: 'tomorrow',
    values: { teams: [], tiers: [] }, seen: {}, timeZone: 'Asia/Shanghai' }
  const input = { feature, settings: { deliveryMethod: 'upstream-sdk' }, target: { sessionId: 'session-1' }, now: () => now }
  await assert.rejects(provider(input), /第二段失败/)
  const firstChunk = sent[0].text
  assert.ok(firstChunk.length < 1800, `首段长度：${firstChunk.length}`)
  assert.ok(Object.keys(feature.seen).some((key) => key.startsWith('digestmatch:')))
  assert.equal(feature.seen['digest:2026-11-10'], undefined)
  await provider(input)
  assert.equal(feature.seen['digest:2026-11-10'], now)
  assert.ok(sent.length > 1)
  assert.doesNotMatch(sent.slice(1).map((item) => item.text).join('\n'), /Team-0-/)
})

test('运行时仅把显式重发选项传给 provider', async () => {
  const statePath = join(mkdtempSync(join(tmpdir(), 'qqbot-cs2-send-')), 'features.json')
  const runtime = createFeatureRuntime({ ctx: { get: () => undefined }, statePath })
  await runtime.save('cs2-matches', {
    enabled: false, target: { sessionId: 'session-1' }, source: { id: 'liquipedia' },
    values: { teams: [], tiers: [] },
  })
  const received = []
  runtime.registerProvider('cs2-matches', async ({ forceResend }) => {
    received.push(forceResend)
    return { matched: 1, sent: 1 }
  })
  await runtime.run('cs2-matches', { manual: true })
  await runtime.run('cs2-matches', { manual: true, forceResend: true })
  await runtime.save('cs2-matches', {
    enabled: true, target: { sessionId: 'session-1' }, source: { id: 'liquipedia' },
    values: { teams: [], tiers: [] },
  })
  await runtime.run('cs2-matches', { forceResend: true })
  assert.deepEqual(received, [false, true, false])
})

test('服务回合模式按赛事提交模板任务并沿用去重', async () => {
  const now = Date.parse('2026-11-09T10:00:00Z')
  const makeMatch = (id, tournament, hour) => ({
    id, timestamp: Math.floor((now + hour * 3_600_000) / 1000),
    teamA: 'Team A', teamB: 'Team B', pageA: 'Team_A', pageB: 'Team_B',
    tournament, tournamentPage: '', logoA: null, logoB: null, bestOf: 3,
  })
  const matches = [makeMatch('one', 'Test Cup', 1), makeMatch('two', 'Test Cup', 2), makeMatch('three', 'Other Cup', 3)]
  const submitted = []
  const provider = createLiquipediaProvider({
    loadMatches: async () => matches,
    serviceTurn: { dispatch: async (message) => submitted.push(message) },
  })
  const feature = {
    source: { id: 'liquipedia' }, deliveryMode: 'service-turn',
    serviceTemplate: '# {{tournament}}\n\n## 对局\n{{matchups}}\n\n## 焦点分析\n{{focusAnalysis}}\n\n数据来源：[Liquipedia]({{sourceUrl}})',
    values: { teams: [], tiers: [] }, seen: {}, focusCard: true,
  }
  const input = { feature, target: { sessionId: 'session-1' }, ctx: {}, now: () => now }
  const result = await provider(input)
  assert.equal(result.channel, 'service-turn')
  assert.equal(result.sent, 3)
  assert.equal(submitted.length, 2)
  assert.equal(submitted[0].sessionId, 'session-1')
  assert.match(submitted[0].text, /# Test Cup/)
  assert.match(submitted[0].text, /## 对局[\s\S]*Team A[\s\S]*Team B[\s\S]*## 焦点分析/)
  assert.match(submitted[0].text, /不得编造.*战绩.*阵容.*胜率/)
  assert.match(submitted[0].text, /建议关注的对局：Team A ⚔ Team B/)
  assert.doesNotMatch(submitted[0].text, /\{\{(?:tournament|matchups|sourceUrl)\}\}/)
  assert.match(submitted[0].text, /\{\{focusAnalysis\}\}/)
  assert.equal((await provider(input)).sent, 0)
  assert.equal(submitted.length, 2)
  assert.equal((await provider({ ...input, forceResend: true })).sent, 3)
  assert.equal(submitted.length, 4)
})

test('每日汇总和赛前提醒分别使用对应的服务回合模板', async () => {
  const now = Date.parse('2026-11-09T10:00:00Z')
  const match = { id: 'split-template', timestamp: Math.floor((now + 30 * 60_000) / 1000),
    teamA: 'Team A', teamB: 'Team B', pageA: 'Team_A', pageB: 'Team_B',
    tournament: 'Test Cup', tournamentPage: '', logoA: null, logoB: null, bestOf: 3 }
  const sent = []
  const provider = createLiquipediaProvider({ loadMatches: async () => [match], serviceTurn: { dispatch: async ({ text }) => sent.push(text) } })
  const base = { source: { id: 'liquipedia' }, deliveryMode: 'service-turn', values: { teams: [], tiers: [] }, seen: {}, timeZone: 'Asia/Shanghai',
    digestTemplate: '# 汇总 {{title}}\n{{schedule}}\n{{focusAnalysis}}\n[Liquipedia]({{sourceUrl}})',
    preMatchTemplate: '# 赛前 {{tournament}}\n{{matchups}}\n{{focusAnalysis}}\n[Liquipedia]({{sourceUrl}})' }
  const input = { settings: { deliveryMethod: 'service-turn' }, target: { sessionId: 'session-1' }, now: () => now }
  await provider({ ...input, feature: { ...base, noticeMode: 'daily-digest', digestDay: 'today', seen: {} } })
  await provider({ ...input, feature: { ...base, noticeMode: 'pre-match', leadMinutes: 60, seen: {} } })
  assert.equal(sent.length, 2)
  assert.match(sent[0], /# 汇总 CS2 2026-11-09 赛程/)
  assert.match(sent[0], /## Test Cup[\s\S]*Team A/)
  assert.match(sent[0], /当天赛程看点/)
  assert.match(sent[1], /# 赛前 Test Cup/)
  assert.match(sent[1], /赛前看点/)
  assert.doesNotMatch(sent[1], /# 汇总/)
})

test('固定内容通知走服务回合，提交失败不记录已通知', async () => {
  const now = Date.parse('2026-11-09T10:00:00Z')
  const match = {
    id: 'match-one', timestamp: Math.floor((now + 60_000) / 1000),
    teamA: 'Team A', teamB: 'Team B', pageA: 'Team_A', pageB: 'Team_B',
    tournament: 'Test Cup', tournamentPage: '', logoA: null, logoB: null, bestOf: 3,
  }
  const submitted = []
  let fail = true
  const provider = createLiquipediaProvider({
    loadMatches: async () => [match],
    serviceTurn: { dispatch: async (message) => {
      submitted.push(message)
      if (fail) throw new Error('提交失败')
    } },
  })
  const feature = {
    source: { id: 'liquipedia' }, deliveryMode: 'direct',
    values: { teams: [], tiers: [] }, seen: {}, focusCard: true,
  }
  const input = { feature, settings: { deliveryMethod: 'service-turn' }, target: { sessionId: 'session-1' }, ctx: {}, now: () => now }
  await assert.rejects(provider(input), /提交失败/)
  assert.equal(feature.seen[match.id], undefined)
  fail = false
  const result = await provider(input)
  assert.equal(result.channel, 'service-turn')
  assert.equal(result.sent, 1)
  assert.equal(feature.seen[match.id], now)
  assert.equal(submitted[1].sessionId, 'session-1')
  assert.match(submitted[1].text, /# Test Cup/)
  assert.match(submitted[1].text, /Team A.*Team B/s)
  assert.doesNotMatch(submitted[1].text, /\{\{focusAnalysis\}\}/)
  assert.equal((await provider(input)).sent, 0)
})

test('全局 SDK 模式发送固定内容，不提交服务回合', async () => {
  const now = Date.parse('2026-11-09T10:00:00Z')
  const match = {
    id: 'sdk-one', timestamp: Math.floor((now + 60_000) / 1000),
    teamA: 'Team A', teamB: 'Team B', pageA: 'Team_A', pageB: 'Team_B',
    tournament: 'SDK Cup', tournamentPage: '', logoA: null, logoB: null, bestOf: 3,
  }
  const sent = []
  let fail = true
  const provider = createLiquipediaProvider({
    loadMatches: async () => [match],
    upstreamSender: { send: async (item) => {
      if (fail) throw new Error('QQ 发送失败')
      sent.push(item)
    } },
    serviceTurn: { dispatch: async () => { throw new Error('不应提交服务回合') } },
  })
  const feature = { source: { id: 'liquipedia' }, deliveryMode: 'direct', values: { teams: [], tiers: [] }, seen: {} }
  const input = { feature, settings: { deliveryMethod: 'upstream-sdk' }, target: { sessionId: 'session-1' }, now: () => now }
  await assert.rejects(provider(input), /QQ 发送失败/)
  assert.equal(feature.seen[match.id], undefined)
  fail = false
  const result = await provider(input)
  assert.equal(result.channel, 'qq-sdk')
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /# SDK Cup/)
  assert.equal(feature.seen[match.id], now)
})

test('多场赛事提交中途失败时仅记录已提交的赛事', async () => {
  const now = Date.parse('2026-11-09T10:00:00Z')
  const matches = ['First Cup', 'Second Cup'].map((tournament, index) => ({
    id: `match-${index}`, timestamp: Math.floor((now + (index + 1) * 60_000) / 1000),
    teamA: 'Team A', teamB: 'Team B', pageA: 'Team_A', pageB: 'Team_B',
    tournament, tournamentPage: '', logoA: null, logoB: null, bestOf: 3,
  }))
  let calls = 0
  const provider = createLiquipediaProvider({
    loadMatches: async () => matches,
    serviceTurn: { dispatch: async () => { if (++calls === 2) throw new Error('提交失败') } },
  })
  const feature = {
    source: { id: 'liquipedia' }, deliveryMode: 'service-turn',
    values: { teams: [], tiers: [] }, seen: {}, focusCard: false,
  }
  await assert.rejects(provider({ feature, target: { sessionId: 'session-1' }, ctx: {}, now: () => now }), /提交失败/)
  assert.equal(feature.seen['match-0'], now)
  assert.equal(feature.seen['match-1'], undefined)
})
