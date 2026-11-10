import assert from 'node:assert/strict'
import { test } from 'node:test'
import { C, styles } from '../client/theme.js'
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
  const { SessionTable } = createSessionTables({ h, C, styles, ...common })
  const view = SessionTable({
    rows: [{ sessionId: 'session-123', title: '測試群', scope: 'group', groupOpenid: 'openid', hasSession: true, updatedAt: Date.now() }],
    rowBusy: '',
    onRefresh: () => {},
  })
  assert.equal(view.type, 'table')
  assert.match(JSON.stringify(view), /刷新群名/)
})

test('群不可用的会话仍可见并提示重新同步', () => {
  const { SessionTable } = createSessionTables({ h, C, styles, ...common })
  const view = SessionTable({
    rows: [{ sessionId: 'session-dead', scope: 'group', groupOpenid: 'openid', groupStatus: 'unavailable', title: '旧群', hasSession: false }],
    rowBusy: '', onRefresh: () => {},
  })
  assert.match(JSON.stringify(view), /群不可用/)
  assert.match(JSON.stringify(view), /刷新群名/)
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

test('CS2 立即发送先保存当前配置再请求重发', async () => {
  const calls = []
  let finished
  const done = new Promise((resolve) => { finished = resolve })
  const FeatureCard = createFeatureCard({
    React, h, C, styles, ...common, FEATURES_PATH: '/features', FEATURES_RUN_PATH: '/features/run',
    postJson: async (path, body) => {
      calls.push({ path, body })
      return path === '/features'
        ? { features: [{ id: 'cs2-matches', enabled: body.enabled, focusCard: body.focusCard }] }
        : { result: { matched: 1, sent: 1 } }
    },
  })
  const view = FeatureCard({
    feature: {
      id: 'cs2-matches', label: 'CS2 赛事通知', enabled: false,
      source: { id: 'liquipedia', baseUrl: '' }, sources: [], target: { sessionId: 'session-1' },
      values: { teams: ['Team A'], tiers: [] }, fields: [], intervalMinutes: 60,
      scheduleMode: 'interval', cron: [], timeZone: 'Asia/Shanghai', focusCard: false,
      credential: { configured: false, writable: false }, lastRunAt: 0,
    },
    sessions: [{ sessionId: 'session-1', scope: 'group', title: '赛事群' }], open: true,
    onToggle: () => {}, onSaved: () => {}, onRun: finished, onNotice: () => {},
  })
  const buttons = []
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (node === null || typeof node !== 'object') return
    if (node.type === 'button') buttons.push(node)
    node.children?.forEach(visit)
  }
  visit(view)
  const send = buttons.find((button) => button.children.includes('立即发送'))
  assert.ok(send)
  send.props.onClick()
  await done
  assert.deepEqual(calls.map((call) => call.path), ['/features', '/features/run'])
  assert.deepEqual(calls[1].body, { id: 'cs2-matches', forceResend: true })
})

test('CS2 服务回合模式展示可编辑 Markdown 模板并保存选择', async () => {
  const submitted = []
  let finished
  const done = new Promise((resolve) => { finished = resolve })
  const template = '# {{tournament}}\n## 对局\n{{matchups}}\n## 焦点分析\n{{focusAnalysis}}\n数据来源：[Liquipedia]({{sourceUrl}})'
  const FeatureCard = createFeatureCard({
    React, h, C, styles, ...common, FEATURES_PATH: '/features', FEATURES_RUN_PATH: '/features/run',
    postJson: async (_path, body) => {
      submitted.push(body)
      return { features: [{ id: 'cs2-matches', enabled: body.enabled, focusCard: body.focusCard }] }
    },
  })
  const view = FeatureCard({
    feature: {
      id: 'cs2-matches', label: 'CS2 赛事通知', enabled: false,
      source: { id: 'liquipedia', baseUrl: '' }, sources: [], target: { sessionId: 'session-1' },
      deliveryMode: 'service-turn', serviceTemplate: template,
      values: { teams: [], tiers: [] }, fields: [], intervalMinutes: 60,
      scheduleMode: 'interval', cron: [], timeZone: 'Asia/Shanghai', focusCard: true,
      credential: { configured: false, writable: false }, lastRunAt: 0,
    },
    sessions: [{ sessionId: 'session-1', scope: 'group', title: '赛事群' }], open: true,
    onToggle: () => {}, onSaved: finished, onRun: () => {}, onNotice: () => {},
  })
  const nodes = []
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (node === null || typeof node !== 'object') return
    nodes.push(node)
    node.children?.forEach(visit)
  }
  visit(view)
  assert.match(JSON.stringify(view), /服务回合生成/)
  assert.match(JSON.stringify(view), /恢复默认模板/)
  assert.equal(nodes.find((node) => node.type === 'textarea')?.props.value, template)
  nodes.find((node) => node.type === 'button' && node.children.includes('保存')).props.onClick()
  await done
  assert.equal(submitted[0].deliveryMode, 'service-turn')
  assert.equal(submitted[0].serviceTemplate, template)
})
