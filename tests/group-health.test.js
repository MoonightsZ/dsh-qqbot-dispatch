import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertGroupAvailable, createGroupHealthStore, isUnavailableGroupError } from '../group-health.js'

test('确认不可用的群状态持久化，但不影响更换后的会话', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'qqbot-group-health-')), 'health.json')
  const peer = { scope: 'group', peerId: 'group-openid', sessionId: 'session-old' }
  const store = createGroupHealthStore(path)
  store.markUnavailable(peer, 'HTTP 404')
  assert.equal(createGroupHealthStore(path).statusFor(peer)?.status, 'unavailable')
  assert.equal(store.statusFor({ ...peer, sessionId: 'session-new' }), null)
  store.markAvailable(peer)
  assert.equal(createGroupHealthStore(path).statusFor(peer), null)
})

test('群消息接口的 404 可用于标记当前目标不可达', () => {
  assert.equal(isUnavailableGroupError({ httpStatus: 404 }), true)
  assert.equal(isUnavailableGroupError({ httpStatus: 429 }), false)
  assert.equal(isUnavailableGroupError({ httpStatus: 500 }), false)
  assert.equal(isUnavailableGroupError(new Error('network timeout')), false)
})

test('手动任务也不能投递到已确认不可用的群', () => {
  const peer = { scope: 'group', peerId: 'group-openid', sessionId: 'session-old' }
  assert.throws(() => assertGroupAvailable({ statusFor: () => ({ status: 'unavailable' }) }, peer), /群不可用/)
  assert.doesNotThrow(() => assertGroupAvailable({ statusFor: () => ({ status: 'unavailable' }) }, { ...peer, scope: 'c2c' }))
})
