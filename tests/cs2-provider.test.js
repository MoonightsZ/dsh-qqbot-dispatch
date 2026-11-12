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
