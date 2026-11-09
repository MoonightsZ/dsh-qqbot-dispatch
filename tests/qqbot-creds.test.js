import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupInfo } from '../qqbot-creds.js'

test('群接口失败时保留 HTTP 状态以区分永久不可达', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => String(url).includes('getAppAccessToken')
    ? { ok: true, json: async () => ({ access_token: 'token', expires_in: 7200 }) }
    : { ok: false, status: 404, json: async () => ({ code: 123, message: '群不可达' }) }
  try {
    await assert.rejects(groupInfo('group-openid', { appId: 'health-test', appSecret: 'secret' }), (error) => {
      assert.equal(error.httpStatus, 404)
      assert.equal(error.code, 123)
      return true
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
