import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeTopics, pickTopic, topicPool } from '../modules/casual-chat/topics.js'

test('旧分隔文本迁移为独立话题，保留句中空格', () => {
  assert.deepEqual(normalizeTopics('今天  有什么新鲜事？| 最近想聊 CS2 吗？\n'), [
    { id: 'legacy-0', text: '今天  有什么新鲜事？', tags: [], sourceKeyword: '', enabled: true },
    { id: 'legacy-1', text: '最近想聊 CS2 吗？', tags: [], sourceKeyword: '', enabled: true },
  ])
})

test('多标签话题去重且全部禁用时不回退内置话题', () => {
  const items = normalizeTopics([{ id: 'a', text: '  来聊比赛？ ', tags: [' CS2 ', '赛前', 'CS2'], sourceKeyword: '赛事', enabled: false }])
  assert.deepEqual(items[0].tags, ['CS2', '赛前'])
  assert.equal(topicPool(items).length, 0)
  assert.equal(topicPool([]).length, 3)
})

test('重复话题 ID 会重建为唯一 ID，列表数量受限', () => {
  const items = normalizeTopics([{ id: 'legacy-1', text: '甲' }, { text: '乙' }, { id: 'legacy-1', text: '丙' }, ...Array.from({ length: 60 }, (_, index) => ({ id: `n-${index}`, text: `话题 ${index}` }))])
  assert.equal(items.length, 50)
  assert.equal(new Set(items.map((item) => item.id)).size, items.length)
})

test('标签先均匀抽取，多标签话题在标签内按标签数降权', () => {
  const topics = normalizeTopics([
    { id: 'a', text: '单标签', tags: ['A'], enabled: true },
    { id: 'b', text: '多标签', tags: ['A', 'B'], enabled: true },
    { id: 'c', text: 'B 话题', tags: ['B'], enabled: true },
  ])
  assert.equal(pickTopic(topics, '', () => 0).id, 'a')
  assert.equal(pickTopic(topics, '', (() => { const values = [0, 0.7]; return () => values.shift() })()).id, 'b')
  assert.equal(pickTopic(topics, 'a', () => 0).id, 'b')
})
