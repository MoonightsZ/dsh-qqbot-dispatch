import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseMatches } from '../modules/cs2-matches/provider.js'

function row({ finished = '', score = 'vs', timestamp = 1794412800 } = {}) {
  const scoreHtml = score === 'vs' ? 'vs' : score.split(':').map((part, index) =>
    `<span class="match-info-header-scoreholder-score">${part}</span>${index === 0 ? '<span class="match-info-header-scoreholder-divider">:</span>' : ''}`).join('')
  return `<div class="match-info"><span data-timestamp="${timestamp}" data-finished="${finished}"></span>
    <div class="match-info-header"><span class="name"><a href="/counterstrike/Team_A" title="Team A">A</a></span>
    <div class="match-info-header-scoreholder"><span class="match-info-header-scoreholder-upper">${scoreHtml}</span>
    <span class="match-info-header-scoreholder-lower">(Bo3)</span></div>
    <span class="name"><a href="/counterstrike/Team_B" title="Team B">B</a></span></div>
    <div class="match-info-tournament"><a href="/counterstrike/Test_Cup" title="Test Cup">Cup</a></div></div>`
}

test('解析完成状态与双方比分，不将进行中的数字比分视为赛果', () => {
  const matches = parseMatches(row({ finished: 'finished', score: '2:1' }) + row({ finished: '', score: '1:0', timestamp: 1794416400 }))
  assert.deepEqual(matches.map((match) => [match.finished, match.scoreA, match.scoreB]), [[true, 2, 1], [false, 1, 0]])
})

test('缺失或无效比分保留比赛但不产生可发送赛果', () => {
  const matches = parseMatches(row({ finished: 'finished', score: 'vs' }) + row({ finished: 'finished', score: '0:0', timestamp: 1794416400 }))
  assert.equal(matches[0].scoreA, null)
  assert.equal(matches[0].scoreB, null)
  assert.deepEqual([matches[1].scoreA, matches[1].scoreB], [0, 0])
})

function tickerCard({ timestamp, finished = false, scoreA = '', scoreB = '' }) {
  const opponent = (page, name, score) => `<div class="match-ticker-card&#95;&#95;opponent"><div class="block-team"><span class="team-template-image-icon"><a href="/counterstrike/${page}"><img src="/commons/${page}.png" /></a></span><span class="name team-name-dynamic"><a href="/counterstrike/${page}" title="${name}"><div class="team-name">${name}</div></a></span></div><div>${score}</div></div>`
  return `<div class="carousel-item"><div class="match-ticker-card"><div class="match-ticker-card&#95;&#95;header"><span class="timer-object" data-timestamp="${timestamp}"${finished ? ' data-finished="finished"' : ''}></span><div>Round 1 - Bo1</div></div><div class="match-ticker-card&#95;&#95;opponents">${opponent('HEROIC', 'HEROIC', scoreA)}${opponent('Imperial_Esports', 'Imperial Esports', scoreB)}</div><div class="match-ticker-card-tournament"><span class="match-ticker-card-tournament-name"><a href="/counterstrike/PGL/2026/Singapore/Stage_1#Round_1" title="PGL/2026/Singapore/Stage 1">PGL Major Singapore 2026</a></span></div></div></div>`
}

test('解析新版赛事卡的赛程、队伍、赛事与 Bo 信息', () => {
  const matches = parseMatches(tickerCard({ timestamp: 1795492800 }))
  assert.deepEqual(matches, [{
    id: '1795492800|HEROIC|Imperial_Esports', timestamp: 1795492800,
    identity: 'PGL/2026/Singapore/Stage_1|Round 1|HEROIC|Imperial_Esports', round: 'Round 1',
    teamA: 'HEROIC', teamB: 'Imperial Esports', pageA: 'HEROIC', pageB: 'Imperial_Esports',
    tournament: 'PGL Major Singapore 2026', tournamentPage: 'PGL/2026/Singapore/Stage_1',
    logoA: 'https://liquipedia.net/commons/HEROIC.png', logoB: 'https://liquipedia.net/commons/Imperial_Esports.png',
    bestOf: 1, finished: false, scoreA: null, scoreB: null,
  }])
})

test('同一輪的對局改時間後保持相同識別鍵', () => {
  const first = parseMatches(tickerCard({ timestamp: 1795492800 }))[0]
  const changed = parseMatches(tickerCard({ timestamp: 1795493700 }))[0]
  assert.ok(first.identity)
  assert.equal(first.identity, changed.identity)
  assert.notEqual(first.id, changed.id)
})

test('新版赛事卡仅将已完赛的数字比分识别为赛果', () => {
  const matches = parseMatches(tickerCard({ timestamp: 1795448100, finished: true, scoreA: '2', scoreB: '0' }) +
    tickerCard({ timestamp: 1795492800, scoreA: '1', scoreB: '0' }))
  assert.deepEqual(matches.map(({ finished, scoreA, scoreB }) => [finished, scoreA, scoreB]),
    [[true, 2, 0], [false, 1, 0]])
})

test('新版赛事卡保留尚未建立队伍页面的对局', () => {
  const html = tickerCard({ timestamp: 1795492800 }).replace(
    'href="/counterstrike/Imperial_Esports" title="Imperial Esports"',
    'href="/counterstrike/index.php?title=Imperial_Esports&amp;action=edit&amp;redlink=1" class="new" title="Imperial Esports (page does not exist)"',
  )
  const matches = parseMatches(html)
  assert.equal(matches.length, 1)
  assert.deepEqual([matches[0].pageB, matches[0].teamB], ['Imperial_Esports', 'Imperial Esports'])
})
