import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listTopicModels, recommendTopics } from '../modules/casual-chat/recommend.js'

test('发现已注册模型并去掉空目录', async () => {
  const llm = { listProviders: () => [{ id: 'one', name: '提供方一' }, { id: 'two', name: '提供方二' }], listModels: async (id) => id === 'one' ? [{ id: 'model-a', name: '模型 A' }] : [] }
  assert.deepEqual(await listTopicModels(llm), [{ provider: 'one', model: 'model-a', label: '提供方一 · 模型 A' }])
})

test('按主题词生成并清理候选，模型调用不带 QQ 会话内容', async () => {
  let request
  const llm = { stream: async function * (options) {
    request = options
    yield { type: 'text-delta', index: 0, text: '["今天想聊聊 CS2 的精彩对局吗？","今天想聊聊 CS2 的精彩对局吗？","你最期待哪场 CS2 比赛？"]' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  const topics = await recommendTopics(llm, { keyword: 'CS2 赛事', provider: 'one', model: 'model-a' })
  assert.deepEqual(topics, ['今天想聊聊 CS2 的精彩对局吗？', '你最期待哪场 CS2 比赛？'])
  assert.equal(request.provider, 'one')
  assert.equal(request.model, 'model-a')
  assert.match(request.messages[0].content[0].text, /CS2 赛事/)
  assert.equal(request.sessionId, undefined)
})

test('模型不可用与错误输出明确失败', async () => {
  await assert.rejects(recommendTopics(null, { keyword: 'CS2', provider: 'one', model: 'a' }), /模型服务不可用/)
  await assert.rejects(recommendTopics({ stream: async function * () { yield { type: 'text-delta', text: '无效' }; yield { type: 'finish', reason: { kind: 'stop' } } } }, { keyword: 'CS2', provider: 'one', model: 'a' }), /候选格式/)
})
