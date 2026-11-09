import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

export function isUnavailableGroupError(error) {
  return error?.httpStatus === 404
}

export function assertGroupAvailable(groupHealth, peer) {
  if (peer?.scope === 'group' && groupHealth?.statusFor(peer)?.status === 'unavailable') {
    throw new Error('群不可用（可能已解散或机器人已退出），请先同步群名确认')
  }
}

export function createGroupHealthStore(path = resolve(homedir(), '.dsh-qqbot', 'group-health.json')) {
  let cached
  const read = () => {
    cached ??= existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { sessions: {} }
    return cached
  }
  const write = (state) => {
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, path)
    cached = state
  }

  const statusFor = (peer) => {
    if (peer?.scope !== 'group') return null
    const record = read().sessions?.[peer.sessionId]
    return record?.openid === peer.peerId
      ? { status: 'unavailable', reason: record.reason, checkedAt: record.checkedAt }
      : null
  }

  const markUnavailable = (peer, reason) => {
    if (peer?.scope !== 'group') return
    const state = read()
    state.sessions ??= {}
    state.sessions[peer.sessionId] = {
      openid: peer.peerId,
      reason: String(reason ?? '群消息接口返回 HTTP 404').slice(0, 200),
      checkedAt: Date.now(),
    }
    write(state)
  }

  const markAvailable = (peer) => {
    if (statusFor(peer) === null) return
    const state = read()
    delete state.sessions[peer.sessionId]
    write(state)
  }

  return { statusFor, markUnavailable, markAvailable }
}
