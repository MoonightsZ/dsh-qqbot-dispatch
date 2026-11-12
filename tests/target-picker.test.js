import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTargetPicker } from '../client/target-picker.js'
import { styles } from '../client/theme.js'

const h = (type, props, ...children) => ({ type, props, children })
function nodes(view) {
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

test('多选控件可搜索私聊、刷新后保留未保存选择并移除失效目标', () => {
  const state = []
  let cursor = 0
  const React = { useState: (initial) => {
    const index = cursor++
    if (!(index in state)) state[index] = initial
    return [state[index], (next) => { state[index] = next }]
  } }
  const TargetPicker = createTargetPicker({ React, h, styles })
  let selected = ['group-one']
  let refreshes = 0
  let sessions = [
    { sessionId: 'group-one', scope: 'group', title: '赛事群' },
    { sessionId: 'private-two', scope: 'c2c', title: '私聊用户' },
  ]
  const render = () => { cursor = 0; return TargetPicker({ sessions, selectedIds: selected,
    onChange: (ids) => { selected = ids }, onRefreshSessions: () => { refreshes++ }, label: '目标会话' }) }
  let view = render()
  nodes(view).find((node) => node.type === 'button' && node.props['aria-label'] === '选择目标会话').props.onClick()
  assert.equal(refreshes, 1)
  view = render()
  nodes(view).find((node) => node.type === 'input' && node.props.type === 'search').props.onChange({ target: { value: '私聊' } })
  view = render()
  const checkbox = nodes(view).find((node) => node.type === 'input' && node.props.value === 'private-two')
  assert.equal(checkbox.props.checked, false)
  checkbox.props.onChange({ target: { checked: true } })
  assert.deepEqual(selected, ['group-one', 'private-two'])
  sessions = [{ sessionId: 'private-two', scope: 'c2c', title: '私聊用户' }]
  view = render()
  assert.match(JSON.stringify(view), /已失效/)
  nodes(view).find((node) => node.type === 'button' && node.props['aria-label'] === '移除 group-one').props.onClick()
  assert.deepEqual(selected, ['private-two'])
})
