import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFeatureNavigation } from '../client/feature-navigation.js'

const h = (type, props, ...children) => ({ type, props, children })

test('功能导航从模组清单生成并切换选中项', () => {
  const selected = []
  const FeatureNavigation = createFeatureNavigation({ h, styles: {} })
  const view = FeatureNavigation({
    features: [
      { id: 'cs2-matches', label: 'CS2 赛事通知', enabled: true },
      { id: 'casual-chat', label: '偶尔闲聊', enabled: false },
    ],
    selectedId: 'cs2-matches', onSelect: (id) => selected.push(id),
  })
  assert.equal(view.type, 'nav')
  assert.equal(view.children.length, 2)
  assert.equal(view.children[0].props['aria-current'], 'page')
  assert.equal(view.children[1].props['aria-current'], undefined)
  view.children[1].props.onClick()
  assert.deepEqual(selected, ['casual-chat'])
})
