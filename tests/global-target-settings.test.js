import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGlobalTargetSettings } from '../client/global-target-settings.js'
import { styles } from '../client/theme.js'

const h = (type, props, ...children) => ({ type, props, children })
const React = { useState: (initial) => [initial, () => {}] }

test('全局目标设置显示继承模组和独立覆盖的区别', () => {
  const GlobalTargetSettings = createGlobalTargetSettings({ React, h, styles, postJson: async () => {}, SETTINGS_PATH: '/settings' })
  const view = GlobalTargetSettings({
    settings: { defaultTargetSessionId: 'shared' },
    features: [
      { id: 'cs2', label: 'CS2 赛事通知', enabled: true, target: { sessionId: '' } },
      { id: 'chat', label: '偶尔闲聊', enabled: true, target: { sessionId: 'chat-only' } },
    ],
    sessions: [{ sessionId: 'shared', title: '通知群', scope: 'group' }],
    onSaved: () => {}, onNotice: () => {},
  })
  const rendered = JSON.stringify(view)
  assert.match(rendered, /CS2 赛事通知/)
  assert.doesNotMatch(rendered, /偶尔闲聊/)
  assert.match(rendered, /通知群/)
  assert.match(rendered, /保存默认目标/)
})

test('全局目标设置需显式保存，并阻止清空启用模组正在继承的目标', async () => {
  const state = []
  let cursor = 0
  const StatefulReact = { useState: (initial) => {
    const index = cursor++
    if (!(index in state)) state[index] = initial
    return [state[index], (value) => { state[index] = value }]
  } }
  const calls = []
  let saved
  const done = new Promise((resolve) => { saved = resolve })
  const GlobalTargetSettings = createGlobalTargetSettings({
    React: StatefulReact, h, styles, SETTINGS_PATH: '/settings',
    postJson: async (path, body) => { calls.push([path, body]); return { settings: { deliveryMethod: 'service-turn', ...body } } },
  })
  const props = {
    settings: { defaultTargetSessionId: 'old', deliveryMethod: 'service-turn' },
    features: [{ id: 'cs2', label: 'CS2', enabled: true, target: { sessionId: '' } }],
    sessions: [
      { sessionId: 'old', title: '旧群', scope: 'group' },
      { sessionId: 'new', title: '新群', scope: 'group' },
    ],
    onSaved: saved, onNotice: () => {},
  }
  const render = () => { cursor = 0; return GlobalTargetSettings(props) }
  const nodes = (view) => {
    const found = []
    const visit = (node) => {
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (!node || typeof node !== 'object') return
      found.push(node)
      node.children?.forEach(visit)
    }
    visit(view)
    return found
  }
  let view = render()
  assert.equal(nodes(view).find((node) => node.type === 'button' && node.children.includes('保存默认目标')).props.disabled, true)
  nodes(view).find((node) => node.type === 'select').props.onChange({ target: { value: 'new' } })
  view = render()
  nodes(view).find((node) => node.type === 'button' && node.children.includes('保存默认目标')).props.onClick()
  await done
  assert.deepEqual(calls, [['/settings', { defaultTargetSessionId: 'new' }]])

  nodes(view).find((node) => node.type === 'select').props.onChange({ target: { value: '' } })
  view = render()
  assert.match(JSON.stringify(view), /请先为已启用的继承模组指定独立目标/)
  assert.equal(nodes(view).find((node) => node.type === 'button' && node.children.includes('保存默认目标')).props.disabled, true)
})
