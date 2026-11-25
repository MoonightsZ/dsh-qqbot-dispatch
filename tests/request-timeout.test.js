import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFeatureRuntime } from '../features.js'
import { createCs2Provider } from '../modules/cs2-matches/provider.js'
import { loadPandaScoreMatches } from '../modules/cs2-matches/pandascore.js'
import { createRequestTimeoutSettings } from '../client/request-timeout-settings.js'

function runtimeAt(path) {
  return createFeatureRuntime({ ctx: { get: () => undefined }, statePath: path })
}

test('全局请求超时默认 30 秒，旧配置可读取并独立保存', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-timeout-')), 'state.json')
  writeFileSync(path, JSON.stringify({ settings: { deliveryMethod: 'service-turn', defaultTargetSessionIds: ['group'] }, features: {} }), 'utf8')
  const runtime = runtimeAt(path)
  assert.equal((await runtime.snapshot()).settings.requestTimeoutSeconds, 30)
  runtime.saveSettings({ requestTimeoutSeconds: 45 })
  assert.deepEqual((await runtimeAt(path).snapshot()).settings, {
    deliveryMethod: 'service-turn', defaultTargetSessionIds: ['group'], requestTimeoutSeconds: 45,
  })
  for (const value of [4, 121, 30.5, '30', null]) {
    assert.throws(() => runtime.saveSettings({ requestTimeoutSeconds: value }), /请求超时/)
  }
  assert.equal((await runtimeAt(path).snapshot()).settings.requestTimeoutSeconds, 45)
})

test('两个 CS2 渠道使用同一个全局请求超时', async () => {
  let pandaTimeout
  const panda = createCs2Provider({ loadPandaScoreMatches: async ({ timeoutMs }) => { pandaTimeout = timeoutMs; return [] } })
  await panda({ feature: { source: { id: 'pandascore' }, values: {}, seen: {} },
    settings: { requestTimeoutSeconds: 45 }, target: { sessionId: 'one' },
    ctx: { get: () => ({ resolve: async () => ({ value: 'test-key' }) }) }, now: () => Date.now() })
  assert.equal(pandaTimeout, 45_000)

  let liquipediaTimeout
  const liquipedia = createCs2Provider({ loadMatches: async (timeoutMs) => { liquipediaTimeout = timeoutMs; return [] } })
  await liquipedia({ feature: { source: { id: 'liquipedia' }, values: {}, seen: {} },
    settings: { requestTimeoutSeconds: 45 }, target: { sessionId: 'one' }, now: () => Date.now() })
  assert.equal(liquipediaTimeout, 45_000)
})

test('Liquipedia 超时会报告超时，而不是请求过于频繁', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') }
  try {
    const provider = createCs2Provider()
    await assert.rejects(provider({ feature: { source: { id: 'liquipedia' }, values: {}, seen: {} },
      settings: { requestTimeoutSeconds: 30 }, target: { sessionId: 'one' }, now: () => Date.now() }), /Liquipedia 请求超时/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Liquipedia 超时后不使用过期赛程缓存发送通知', async () => {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  let wall = originalNow() + 60 * 60_000
  let requests = 0
  Date.now = () => wall
  globalThis.fetch = async () => {
    requests++
    if (requests > 1) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    return { ok: true, json: async () => ({ parse: { text: '<div class="match-info"><span data-timestamp="1794412800"></span><span class="name"><a href="/counterstrike/Team_A" title="Team A"></a></span><span class="name"><a href="/counterstrike/Team_B" title="Team B"></a></span></div>' } }) }
  }
  try {
    const provider = createCs2Provider()
    const args = { feature: { source: { id: 'liquipedia' }, values: {}, seen: {} },
      settings: { requestTimeoutSeconds: 30 }, target: { sessionId: 'one' }, now: () => wall }
    await provider(args)
    wall += 16 * 60_000
    await assert.rejects(provider(args), /Liquipedia 请求超时/)
    assert.equal(requests, 2)
  } finally {
    globalThis.fetch = originalFetch
    Date.now = originalNow
  }
})

test('PandaScore 请求使用传入的超时', async () => {
  const keepAlive = setTimeout(() => {}, 50)
  try {
    await assert.rejects(loadPandaScoreMatches({ token: 'test-key', nowMs: Date.now(), timeoutMs: 20,
      fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    }), { name: 'TimeoutError' })
  } finally {
    clearTimeout(keepAlive)
  }
})

test('全局设置页可修改并保存请求超时', async () => {
  const state = []
  let cursor = 0
  const React = { useState: (initial) => {
    const index = cursor++
    if (!(index in state)) state[index] = initial
    return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next }]
  } }
  const h = (type, props, ...children) => ({ type, props, children })
  const saved = []
  const calls = []
  const Settings = createRequestTimeoutSettings({ React, h, styles: { panel: {}, desc: {}, field: {}, label: {}, input: {}, primaryButton: {}, warnText: {} },
    SETTINGS_PATH: '/settings', postJson: async (path, body) => {
      calls.push([path, body])
      return { settings: { deliveryMethod: 'service-turn', requestTimeoutSeconds: body.requestTimeoutSeconds } }
    } })
  const render = () => { cursor = 0; return Settings({ settings: { requestTimeoutSeconds: 30 }, onSaved: (next) => saved.push(next), onNotice: () => {} }) }
  const find = (node, type) => {
    if (Array.isArray(node)) return node.map((item) => find(item, type)).find(Boolean)
    if (!node || typeof node !== 'object') return null
    if (node.type === type) return node
    return node.children?.map((item) => find(item, type)).find(Boolean)
  }
  assert.equal(find(render(), 'button').props.disabled, true)
  find(render(), 'input').props.onChange({ target: { value: '45' } })
  const button = find(render(), 'button')
  assert.equal(button.props.disabled, false)
  button.props.onClick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, [['/settings', { requestTimeoutSeconds: 45 }]])
  assert.equal(saved[0].requestTimeoutSeconds, 45)
})
