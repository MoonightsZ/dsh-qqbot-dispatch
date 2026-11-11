import assert from 'node:assert/strict'
import { test } from 'node:test'
import { C, styles } from '../client/theme.js'
import { createCommon } from '../client/common.js'
import { createSessionTables } from '../client/tables.js'
import { createFeatureCard } from '../modules/cs2-matches/card.js'
import { createChatCard } from '../modules/casual-chat/card.js'
import { createExtensionCard } from '../client/extension-card.js'

const h = (type, props, ...children) => ({ type, props, children })
const React = {
  useCallback: (callback) => callback,
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
}
const common = createCommon({ h, C, styles })

test('扩展模组使用通用卡片，关闭时不能立即运行', () => {
  const ExtensionCard = createExtensionCard({ React, h, styles, ...common, FEATURES_PATH: '/features', FEATURES_RUN_PATH: '/features/run' })
  const view = ExtensionCard({
    feature: { id: 'sample-alert', label: '示例通知', extension: true, enabled: false, target: { sessionId: '' }, fields: [], values: {} },
    sessions: [], onSaved: () => {}, onRun: () => {}, onNotice: () => {},
  })
  assert.match(JSON.stringify(view), /同一进程运行/)
  const runButton = view.children.find((item) => item?.type === 'div' && item.children?.some((child) => child?.type === 'button' && child.children?.includes('立即运行')))
    ?.children.find((item) => item?.type === 'button' && item.children?.includes('立即运行'))
  assert.equal(runButton?.props.disabled, true)
})

test('三个模组均显示继承的全局默认目标', () => {
  const sessions = [{ sessionId: 'session-shared', scope: 'group', title: '通知群' }]
  const settings = { defaultTargetSessionId: 'session-shared', deliveryMethod: 'service-turn' }
  const commonProps = { sessions, settings, open: true, onToggle: () => {}, onSaved: () => {}, onRun: () => {}, onNotice: () => {} }
  const cards = [
    createFeatureCard({ React, h, C, styles, ...common, FEATURES_PATH: '/features', FEATURES_RUN_PATH: '/features/run' })({
      ...commonProps, feature: { id: 'cs2-matches', label: 'CS2 赛事通知', enabled: false, target: { sessionId: '' }, source: { id: 'none' }, values: { teams: [], tiers: [] }, fields: [], credential: {} },
    }),
    createChatCard({ React, h, C, styles, ...common, FEATURES_PATH: '/features', FEATURES_RUN_PATH: '/features/run' })({
      ...commonProps, feature: { id: 'casual-chat', label: '偶尔闲聊', enabled: false, target: { sessionId: '' }, values: {} },
    }),
    createExtensionCard({ React, h, styles, ...common, FEATURES_PATH: '/features', FEATURES_RUN_PATH: '/features/run' })({
      ...commonProps, feature: { id: 'sample-alert', label: '示例通知', enabled: false, target: { sessionId: '' }, fields: [], values: {} },
    }),
  ]
  for (const card of cards) {
    assert.match(JSON.stringify(card), /使用全局默认（通知群/)
    assert.match(JSON.stringify(card), /会话设置在「配置」页/)
  }
})

test('有會話資料時可繪製會話列表', () => {
  const { SessionTable } = createSessionTables({ h, C, styles, ...common })
  const view = SessionTable({
    rows: [{ sessionId: 'session-123', title: '測試群', scope: 'group', groupOpenid: 'openid', hasSession: true, updatedAt: Date.now() }],
    rowBusy: '',
    onRefresh: () => {},
  })
  assert.equal(view.type, 'table')
  assert.equal(view.props.className, 'qqd-session-table')
  const cells = view.children[1].children[0][0].children
  assert.deepEqual(cells.map((cell) => cell.props['data-label']), ['会话', '状态', '最后活动', '群信息'])
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
    feature: { id: 'casual-chat', label: '偶尔闲聊', enabled: false, target: { sessionId: '' }, scheduleMode: 'cron', cron: ['0 19 * * *'], timeZone: 'Asia/Shanghai', nextRunAt: Date.parse('2026-11-09T11:00:00Z'), values: { chancePercent: '30', cooldownHours: '72', quietStart: '22', quietEnd: '9', topics: '' }, lastRunAt: 0 },
    sessions: [], open: true, onToggle: () => {}, onSaved: () => {}, onRun: () => {}, onNotice: () => {},
  })
  assert.equal(view.type, 'div')
  assert.match(JSON.stringify(view), /每日检查时间/)
  assert.match(JSON.stringify(view), /发送冷却（小时）/)
  assert.match(JSON.stringify(view), /话题提示/)
  assert.match(JSON.stringify(view), /话题池/)
  assert.match(JSON.stringify(view), /AI 推荐/)
  assert.match(JSON.stringify(view), /下次计划执行/)
  assert.match(JSON.stringify(view), /刷新选项/)
})

test('AI 候选须手选加入话题池，保存后才进入配置', async () => {
  const state = []
  let cursor = 0
  const StatefulReact = { useState: (initial) => {
    const index = cursor++
    if (!(index in state)) state[index] = initial
    return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
  } }
  let saved
  const done = new Promise((resolve) => { saved = resolve })
  let payload
  const ChatCard = createChatCard({ React: StatefulReact, h, C, styles, ...common,
    FEATURES_PATH: '/features', FEATURES_RUN_PATH: '/features/run', TOPIC_MODELS_PATH: '/chat/models', TOPIC_RECOMMEND_PATH: '/chat/recommend',
    readJson: async () => ({ models: [{ provider: 'one', model: 'a', label: '模型 A' }] }),
    postJson: async (path, body) => path === '/chat/recommend' ? { topics: ['来聊 CS2 吗？'] } : (payload = body, { features: [{ id: body.id, enabled: body.enabled }] }),
  })
  const props = { feature: { id: 'casual-chat', label: '偶尔闲聊', target: { sessionId: 'session-1' }, values: { topics: [] }, cron: ['0 19 * * *'] },
    sessions: [{ sessionId: 'session-1', title: '群', scope: 'group' }], open: true, onSaved: saved, onRun: () => {}, onNotice: () => {} }
  const render = () => { cursor = 0; return ChatCard(props) }
  const find = (view, predicate) => {
    const visit = (node) => {
      if (Array.isArray(node)) { for (const child of node) { const found = visit(child); if (found) return found } }
      if (!node || typeof node !== 'object') return null
      if (predicate(node)) return node
      return visit(node.children)
    }
    return visit(view)
  }
  find(render(), (node) => node.type === 'input' && node.props.placeholder === '例如：CS2 赛事').props.onChange({ target: { value: 'CS2' } })
  find(render(), (node) => node.type === 'button' && node.children.includes('AI 推荐')).props.onClick()
  await new Promise(setImmediate)
  assert.equal(state[7].length, 0)
  let view = render()
  find(view, (node) => node.type === 'input' && node.props.placeholder === '例如：CS2 赛事').props.onChange({ target: { value: '别的话题' } })
  view = render()
  find(view, (node) => node.type === 'input' && node.props.type === 'checkbox' && node.props.checked === false).props.onChange({ target: { checked: true } })
  view = render()
  find(view, (node) => node.type === 'button' && node.children.includes('加入话题池')).props.onClick()
  view = render()
  assert.match(JSON.stringify(view), /来聊 CS2 吗？/)
  find(view, (node) => node.type === 'button' && node.children.includes('保存')).props.onClick()
  await done
  assert.equal(payload.values.topics[0].text, '来聊 CS2 吗？')
  assert.deepEqual(payload.values.topics[0].tags, ['CS2'])
})

test('话题全部禁用时立即发起提示跳过', async () => {
  const notices = []
  let finished
  const done = new Promise((resolve) => { finished = resolve })
  const ChatCard = createChatCard({ React, h, C, styles, ...common, FEATURES_PATH: '/features', FEATURES_RUN_PATH: '/features/run',
    postJson: async (path, body) => path === '/features' ? { features: [{ id: body.id, enabled: false }] } : { result: { sent: 0, warning: '话题池没有启用的话题，已跳过闲聊' } } })
  const view = ChatCard({ feature: { id: 'casual-chat', label: '偶尔闲聊', enabled: false, target: { sessionId: 'session-1' }, values: { topics: [{ id: 'a', text: '话题', tags: [], enabled: false }] } },
    sessions: [{ sessionId: 'session-1', scope: 'group' }], open: true, onSaved: () => {}, onRun: finished, onNotice: (notice) => notices.push(notice) })
  const visit = (node) => {
    if (Array.isArray(node)) return node.map(visit).find(Boolean)
    if (!node || typeof node !== 'object') return null
    if (node.type === 'button' && node.children.includes('立即发起')) return node
    return visit(node.children)
  }
  visit(view).props.onClick()
  await done
  assert.match(notices.at(-1).text, /已跳过闲聊/)
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
  const headings = []
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (node === null || typeof node !== 'object') return
    if (node.type === 'h3') headings.push(node.children.join(''))
    node.children?.forEach(visit)
  }
  visit(view)
  assert.deepEqual(headings, ['数据源', '通知目标与赛事', '通知规则', '模板选择', '通知内容'])
  assert.match(JSON.stringify(view), /每日汇总/)
  assert.match(JSON.stringify(view), /赛前提醒/)
  assert.match(JSON.stringify(view), /添加规则/)
  assert.match(JSON.stringify(view), /执行时间/)
  assert.match(JSON.stringify(view), /保存后更新下次执行时间/)
  assert.match(JSON.stringify(view), /刷新选项/)
})

test('启用赛前提醒不会关闭每日汇总，并保存各自检查计划', async () => {
  const state = []
  let cursor = 0
  const StatefulReact = { useState: (initial) => {
    const index = cursor++
    if (!(index in state)) state[index] = initial
    return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
  } }
  let saved
  const done = new Promise((resolve) => { saved = resolve })
  let payload
  const FeatureCard = createFeatureCard({
    React: StatefulReact, h, C, styles, ...common, FEATURES_PATH: '/features', FEATURES_RUN_PATH: '/features/run',
    postJson: async (_path, body) => { payload = body; return { features: [{ id: body.id, enabled: body.enabled }] } },
  })
  const props = {
    feature: { id: 'cs2-matches', label: 'CS2 赛事通知', enabled: false,
      noticeMode: 'daily-digest', digestDay: 'tomorrow', leadMinutes: 60,
      source: { id: 'none' }, target: { sessionId: 'session-1' }, values: { teams: [], tiers: [] }, fields: [],
      scheduleMode: 'cron', cron: ['0 18 * * *'], credential: {} },
    sessions: [{ sessionId: 'session-1', title: '通知群', scope: 'group' }], open: true,
    onToggle: () => {}, onSaved: saved, onRun: () => {}, onNotice: () => {},
  }
  const render = () => { cursor = 0; return FeatureCard(props) }
  const buttons = (view) => {
    const found = []
    const visit = (node) => {
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (!node || typeof node !== 'object') return
      if (node.type === 'button') found.push(node)
      node.children?.forEach(visit)
    }
    visit(view)
    return found
  }
  const switches = []
  const collect = (node) => {
    if (Array.isArray(node)) { node.forEach(collect); return }
    if (!node || typeof node !== 'object') return
    if (node.type === common.Switch && node.props.label === '赛前提醒开关') switches.push(node)
    node.children?.forEach(collect)
  }
  collect(render())
  switches[0].props.onChange(true)
  const view = render()
  assert.match(JSON.stringify(view), /最多提前提醒/)
  assert.match(JSON.stringify(view), /保存后更新下次执行时间/)
  buttons(view).find((item) => item.children.includes('保存')).props.onClick()
  await done
  assert.equal(payload.noticeRules['daily-digest'].enabled, true)
  assert.equal(payload.noticeRules['pre-match'].enabled, true)
  assert.equal(payload.noticeRules['daily-digest'].scheduleMode, 'cron')
  assert.equal(payload.noticeRules['pre-match'].scheduleMode, 'interval')
  assert.equal(payload.noticeRules['pre-match'].intervalMinutes, 15)
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
  assert.deepEqual(calls[1].body, { id: 'cs2-matches', noticeMode: 'daily-digest', forceResend: true })
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
  assert.match(JSON.stringify(view), /内容生成方式/)
  assert.match(JSON.stringify(view), /AI 焦点分析/)
  assert.match(JSON.stringify(view), /固定赛事内容/)
  assert.match(JSON.stringify(view), /恢复默认模板/)
  assert.equal(nodes.find((node) => node.type === 'textarea')?.props.value, template)
  nodes.find((node) => node.type === 'button' && node.children.includes('保存')).props.onClick()
  await done
  assert.equal(submitted[0].deliveryMode, 'service-turn')
  assert.equal(submitted[0].serviceTemplate, template)
})

test('CS2 切换汇总和赛前提醒时显示各自模板并同时保存', async () => {
  const state = []
  let cursor = 0
  const StatefulReact = { useState: (initial) => {
    const index = cursor++
    if (!(index in state)) state[index] = initial
    return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
  } }
  let saved
  const done = new Promise((resolve) => { saved = resolve })
  let payload
  const digestTemplate = '# 汇总 {{title}}\n{{schedule}}\n{{focusAnalysis}}\n[Liquipedia]({{sourceUrl}})'
  const preMatchTemplate = '# 赛前 {{tournament}}\n{{matchups}}\n{{focusAnalysis}}\n[Liquipedia]({{sourceUrl}})'
  const FeatureCard = createFeatureCard({ React: StatefulReact, h, C, styles, ...common, FEATURES_PATH: '/features', FEATURES_RUN_PATH: '/features/run',
    postJson: async (_path, body) => { payload = body; return { features: [{ id: body.id, enabled: body.enabled }] } } })
  const props = { feature: { id: 'cs2-matches', label: 'CS2 赛事通知', enabled: false, noticeMode: 'daily-digest', deliveryMode: 'service-turn',
    digestTemplate, preMatchTemplate, source: { id: 'liquipedia' }, target: { sessionId: 'session-1' }, values: { teams: [], tiers: [] },
    scheduleMode: 'cron', cron: ['0 18 * * *'], credential: {} },
    sessions: [{ sessionId: 'session-1', scope: 'group' }], open: true, onSaved: saved, onRun: () => {}, onNotice: () => {} }
  const render = () => { cursor = 0; return FeatureCard(props) }
  const find = (view, predicate) => {
    const visit = (node) => {
      if (Array.isArray(node)) return node.map(visit).find(Boolean)
      if (!node || typeof node !== 'object') return null
      if (predicate(node)) return node
      return visit(node.children)
    }
    return visit(view)
  }
  assert.equal(find(render(), (node) => node.type === 'textarea')?.props.value, digestTemplate)
  find(render(), (node) => node.type === 'button' && node.children.includes('赛前提醒模板')).props.onClick()
  assert.equal(find(render(), (node) => node.type === 'textarea')?.props.value, preMatchTemplate)
  find(render(), (node) => node.type === 'button' && node.children.includes('保存')).props.onClick()
  await done
  assert.equal(payload.digestTemplate, digestTemplate)
  assert.equal(payload.preMatchTemplate, preMatchTemplate)
})

test('CS2 直接发送模式隐藏内容设置，显示实际排版预览和红字原因', async () => {
  let submitted
  let finished
  const done = new Promise((resolve) => { finished = resolve })
  const FeatureCard = createFeatureCard({
    React, h, C, styles, ...common, FEATURES_PATH: '/features', FEATURES_RUN_PATH: '/features/run',
    postJson: async (_path, body) => {
      submitted = body
      return { features: [{ id: 'cs2-matches', enabled: body.enabled, focusCard: body.focusCard }] }
    },
  })
  const view = FeatureCard({
    feature: {
      id: 'cs2-matches', label: 'CS2 赛事通知', enabled: false,
      source: { id: 'liquipedia', baseUrl: '' }, sources: [], target: { sessionId: 'session-1' },
      deliveryMode: 'service-turn',
      values: { teams: [], tiers: [] }, fields: [], intervalMinutes: 60,
      scheduleMode: 'interval', cron: [], timeZone: 'Asia/Shanghai', focusCard: true,
      credential: { configured: false, writable: false }, lastRunAt: 0,
    },
    settings: { deliveryMethod: 'upstream-sdk' },
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
  const rendered = JSON.stringify(view)
  assert.match(rendered, /全局已选择“直接发送 Markdown”/)
  assert.match(rendered, /每日汇总 · 发送内容示例/)
  assert.match(rendered, /赛前提醒 · 发送内容示例/)
  assert.match(rendered, /队伍 A/)
  assert.match(rendered, /Liquipedia/)
  assert.ok(nodes.some((node) => node.type === 'p' && node.props.style?.color === C.error && node.children[0].includes('无法设置')))
  assert.equal(nodes.some((node) => node.type === 'textarea'), false)
  assert.equal(nodes.some((node) => node.type === 'button' && ['固定赛事内容', 'AI 焦点分析', '恢复默认模板', '每日汇总模板'].includes(node.children[0])), false)
  nodes.find((node) => node.type === 'button' && node.children.includes('保存')).props.onClick()
  await done
  assert.equal(submitted.deliveryMode, 'service-turn')
})
