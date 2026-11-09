import assert from 'node:assert/strict'
import { test } from 'node:test'
import { C, MONO, styles } from '../client/theme.js'
import { createCommon } from '../client/common.js'
import { createSessionTables } from '../client/tables.js'
import { createFeatureCard } from '../modules/cs2-matches/card.js'
import { createChatCard } from '../modules/casual-chat/card.js'

const h = (type, props, ...children) => ({ type, props, children })
const React = {
  useCallback: (callback) => callback,
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
}
const common = createCommon({ h, C, styles })

test('有會話資料時可繪製會話列表', () => {
  const { SessionTable, PeerTable } = createSessionTables({ h, C, MONO, styles, ...common })
  const view = SessionTable({
    rows: [{ sessionId: 'session-123', title: '測試群', scope: 'group', groupOpenid: 'openid', hasSession: true, updatedAt: Date.now() }],
    rowBusy: '',
    onRefresh: () => {},
  })
  assert.equal(view.type, 'table')
  assert.match(JSON.stringify(view), /刷新群名/)
  const peers = PeerTable({ rows: [{ sessionKey: 'qqbot:app:group:openid', sessionId: 'session-missing', resolvedFrom: 'prefs', hasSession: false, exists: false }] })
  assert.match(JSON.stringify(peers), /会话不存在/)
})

test('偶尔闲聊使用独立设置卡片', () => {
  const ChatCard = createChatCard({ React, h, C, styles, ...common, FEATURES_PATH: '/features', FEATURES_RUN_PATH: '/features/run' })
  const view = ChatCard({
    feature: { id: 'casual-chat', label: '偶尔闲聊', enabled: false, target: { sessionId: '' }, scheduleMode: 'cron', cron: ['0 19 * * *'], timeZone: 'Asia/Shanghai', nextRunAt: Date.parse('2026-11-09T11:00:00Z'), values: { chancePercent: '30', cooldownDays: '3', quietStart: '22', quietEnd: '9', topics: '' }, lastRunAt: 0 },
    sessions: [], open: true, onToggle: () => {}, onSaved: () => {}, onRun: () => {}, onNotice: () => {},
  })
  assert.equal(view.type, 'div')
  assert.match(JSON.stringify(view), /每日检查时间/)
  assert.match(JSON.stringify(view), /话题提示/)
  assert.match(JSON.stringify(view), /下次计划执行/)
  assert.match(JSON.stringify(view), /刷新选项/)
})

test('有功能資料時可繪製設定卡片', () => {
  const FeatureCard = createFeatureCard({ React, h, C, styles, ...common, FEATURES_PATH: '/features', FEATURES_RUN_PATH: '/features/run' })
  const view = FeatureCard({
    feature: {
      id: 'cs2-matches', label: 'CS2 賽事通知', enabled: false,
      source: { id: 'none', baseUrl: '' }, sources: [], target: { sessionId: '' },
      values: { teams: [], tiers: [] }, fields: [
        { key: 'teams', kind: 'list', label: '隊伍' },
        { key: 'tiers', kind: 'options', label: '等級', options: ['S', 'A'] },
      ], intervalMinutes: 60, scheduleMode: 'cron', cron: ['0 9 * * 1', '30 10 * * 0'], timeZone: 'Asia/Shanghai', nextRunAt: Date.parse('2026-11-09T01:00:00Z'),
      credential: { configured: false, writable: false },
    },
    sessions: [], open: true, onToggle: () => {}, onSaved: () => {}, onRun: () => {}, onNotice: () => {},
  })
  assert.equal(view.type, 'div')
  assert.match(JSON.stringify(view), /添加规则/)
  assert.match(JSON.stringify(view), /执行时间/)
  assert.match(JSON.stringify(view), /下次计划执行/)
  assert.match(JSON.stringify(view), /刷新选项/)
})
