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
    deliver: async (message) => { sent.push(message); return { channel: 'qq-text' } },
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

test('服务回合模式按赛事提交模板任务，不调用 QQ 直发并沿用去重', async () => {
  const now = Date.parse('2026-11-09T10:00:00Z')
  const makeMatch = (id, tournament, hour) => ({
    id, timestamp: Math.floor((now + hour * 3_600_000) / 1000),
    teamA: 'Team A', teamB: 'Team B', pageA: 'Team_A', pageB: 'Team_B',
    tournament, tournamentPage: '', logoA: null, logoB: null, bestOf: 3,
  })
  const matches = [makeMatch('one', 'Test Cup', 1), makeMatch('two', 'Test Cup', 2), makeMatch('three', 'Other Cup', 3)]
  const submitted = []
  let directCalls = 0
  const provider = createLiquipediaProvider({
    loadMatches: async () => matches,
    deliver: async () => { directCalls += 1 },
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
  assert.equal(directCalls, 0)
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
