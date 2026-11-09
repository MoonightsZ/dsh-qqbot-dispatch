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
