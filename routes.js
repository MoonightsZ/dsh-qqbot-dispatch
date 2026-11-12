import { readPrefs, sessionKey } from './session-resolver.js'
import { listTopicModels, recommendTopics } from './modules/casual-chat/recommend.js'

function describeFailure(error) {
  const code = error?.code ?? error?.name
  const message = error instanceof Error ? error.message : String(error)
  return code === undefined ? message : `${code}: ${message}`
}

export function registerDispatchRoutes(ctx, { resolver, groupNames, groupHealth, features, defaultMode, qqbotApi, loadOptionalPatches }) {
  const { resolvedAppId, knownPeers, prefsPath } = resolver
  const { readGroupNames, writeGroupNames } = groupNames
  ctx.inject(['webServer'], (scoped) => {
    const webServer = scoped.webServer
    if (webServer === undefined || typeof webServer.register !== 'function') return
    const SESSIONS_PATH = '/qqbot-tool-dispatch/sessions'
    const FEATURES_PATH = '/qqbot-tool-dispatch/features'
    const SETTINGS_PATH = '/qqbot-tool-dispatch/settings'
    const FEATURES_RUN_PATH = '/qqbot-tool-dispatch/features/run'
    const TOPIC_MODELS_PATH = '/qqbot-tool-dispatch/chat/models'
    const TOPIC_RECOMMEND_PATH = '/qqbot-tool-dispatch/chat/recommend'
    const GROUP_INFO_PATH = '/qqbot-tool-dispatch/group-info'
    const TITLES_PATH = '/qqbot-tool-dispatch/titles/refresh'
    const GROUP_CACHE_MS = 10 * 60 * 1000
    const groupCache = new Map()
    const titleCache = new Map()

    const sendJson = (res, status, body) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify(body))
    }
    /** Minimal CSRF gate: a request carrying an Origin must match this Host. */
    const sameOrigin = (req) => {
      const origin = req.headers.origin
      if (origin === undefined) return true
      try {
        return new URL(origin).host === req.headers.host
      } catch {
        return false
      }
    }
    const guard = (req, res) => {
      if (!sameOrigin(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return false
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' })
        return false
      }
      return true
    }
    /** Read one small JSON request body. */
    const readJsonBody = (req) => new Promise((settle, fail) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > 64 * 1024) {
          fail(new Error('body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        try {
          settle(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          fail(new Error('invalid JSON body'))
        }
      })
      req.on('error', fail)
    })

    /** Session ids with a live in-process Agent right now — the only ones whose reply can reach QQ. */
    const liveSessionIds = () => new Set((ctx.get('agents')?.list?.() ?? []).map((agent) => agent.id))
    /**
     * One Session's title, read without activating its Agent. The list projection column is
     * often empty for a cold Session, so this asks per Session.
     */
    async function sessionPreview(controller, sessionId, fresh = false) {
      const cached = titleCache.get(sessionId)
      if (!fresh && cached !== undefined && Date.now() - cached.at < 60_000) return cached.preview
      const abort = new AbortController()
      let timer
      try {
        const value = await Promise.race([
          controller.projections({ sessionId }, abort.signal),
          new Promise((resolve) => { timer = setTimeout(() => { abort.abort(); resolve(null) }, 5000) }),
        ])
        const title = value?.values?.title
        const preview = typeof title === 'string' && title !== ''
          ? { title }
          : typeof title?.val === 'string' && title.val !== '' ? { title: title.val } : {}
        if (value !== null) titleCache.set(sessionId, { at: Date.now(), preview })
        return preview
      } catch {
        return {}
      } finally {
        clearTimeout(timer)
      }
    }
    /**
     * Session ids the workspace registry currently lists as archived. The registry exposes them
     * only through its follow stream, so read the first baseline frame and close the stream again.
     */
    async function archivedSessionIds() {
      const controller = ctx.get('workspaceController')
      if (controller?.follow === undefined) return new Set()
      const abort = new AbortController()
      try {
        for await (const frame of controller.follow(abort.signal)) {
          if (frame?.type === 'baseline' || frame?.type === 'replace') {
            return new Set((frame.value?.archivedSessionIds ?? []).map((id) => String(id)))
          }
        }
        return new Set()
      } catch {
        return new Set()
      } finally {
        abort.abort()
      }
    }
    /** Join current QQ Bot peer mappings with Sessions in the host store. */
    async function listQqbotSessions(archived, peers) {
      const controller = ctx.get('sessionController')
      if (controller?.list === undefined) return []
      const value = await controller.list({}, new AbortController().signal)
      const items = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : []
      const live = liveSessionIds()
      const peerBySession = new Map(peers.map((peer) => [peer.sessionId, peer]))
      const candidates = items.filter((item) => {
        const sessionId = String(item.sessionId)
        return peerBySession.has(sessionId)
          && item.parentSessionId === undefined
          && item.origin !== 'subagent'
          && !archived.has(sessionId)
      })
      const rows = []
      for (let offset = 0; offset < candidates.length; offset += 6) {
        rows.push(...await Promise.all(candidates.slice(offset, offset + 6).map(async (item) => {
          const sessionId = String(item.sessionId)
          const peer = peerBySession.get(sessionId)
          const preview = typeof item.title === 'string' && item.title !== ''
            ? { title: item.title }
            : await sessionPreview(controller, sessionId)
          return {
            sessionId,
            ...(preview.title === undefined ? {} : { title: preview.title }),
            hasSession: live.has(sessionId),
            updatedAt: item.updatedAt,
            scope: peer.scope,
            peerId: peer.peerId,
            resolvedFrom: peer.resolvedFrom,
          }
        })))
      }
      return rows
    }

    /**
     * Pull each known group's name from the QQ platform and rename its Session
     * title to that name. The current qqbot peer mapping determines the target;
     * cached names never decide which Session belongs to a group.
     */
    async function refreshSessionTitles() {
      const credentials = await qqbotApi.readQqbotCredentials(loadOptionalPatches)
      if (credentials === undefined) {
        throw new Error('没有找到 QQ Bot 凭据：profile 的 im-qqbot 行里没有 appId/appSecret')
      }
      const controller = ctx.get('sessionController')
      if (typeof controller?.list !== 'function') throw new Error('会话列表不可用，无法同步群名')
      const learned = readGroupNames()
      const targets = (await listQqbotSessions(await archivedSessionIds(), knownPeers()))
        .filter((peer) => peer.scope === 'group')
        .map((peer) => ({ openid: peer.peerId, sessionId: peer.sessionId }))
      const entries = []
      let updated = 0
      let skipped = 0
      let failed = 0
      for (const target of targets.values()) {
        const peer = { scope: 'group', peerId: target.openid, sessionId: target.sessionId }
        try {
          const info = await qqbotApi.groupInfo(target.openid, credentials)
          groupHealth?.markAvailable(peer)
          const name = typeof info?.group_name === 'string' ? info.group_name.trim() : ''
          if (name === '') throw new Error('接口没有返回 group_name')
          const preview = await sessionPreview(controller, target.sessionId, true)
          if (preview.title === name) {
            skipped += 1
            entries.push({ openid: target.openid, sessionId: target.sessionId, name, status: 'unchanged' })
          } else {
            await controller.rename({ sessionId: target.sessionId, title: name })
            updated += 1
            entries.push({ openid: target.openid, sessionId: target.sessionId, name, status: 'renamed' })
          }
          titleCache.set(target.sessionId, { at: Date.now(), preview: { title: name } })
          learned[target.openid] = {
            sessionId: target.sessionId,
            name,
            classText: info?.group_class_text ?? learned[target.openid]?.classText ?? '',
            memberNum: typeof info?.group_member_num === 'number' ? info.group_member_num : (learned[target.openid]?.memberNum ?? 0),
            updatedAt: Date.now(),
          }
        } catch (error) {
          failed += 1
          entries.push({ openid: target.openid, sessionId: target.sessionId, status: 'failed', error: describeFailure(error) })
        }
      }
      writeGroupNames(learned)
      return { updated, skipped, failed, entries }
    }

    const disposers = [
      webServer.register({
        kind: 'exact',
        path: SESSIONS_PATH,
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const appId = resolvedAppId()
            const live = liveSessionIds()
            const peers = knownPeers()
            const archived = await archivedSessionIds()
            let sessions = []
            let warning
            try {
              sessions = await listQqbotSessions(archived, peers)
            } catch (error) {
              warning = describeFailure(error)
            }
            const groupNames = readGroupNames()
            sessions = sessions.map((row) => {
              if (row.scope !== 'group') return row
              const health = groupHealth?.statusFor(row)
              const status = health === null || health === undefined ? {} : { groupStatus: health.status, groupStatusReason: health.reason }
              const known = groupNames[row.peerId]
              if (known === undefined) return { ...row, groupOpenid: row.peerId, ...status }
              return {
                ...row,
                ...status,
                groupName: known.name,
                groupMemberNum: known.memberNum,
                groupClassText: known.classText,
                groupOpenid: row.peerId,
              }
            })
            const byId = new Map(sessions.map((row) => [row.sessionId, row]))
            const entries = peers.filter((entry) => !archived.has(entry.sessionId)).map((entry) => {
              const row = byId.get(entry.sessionId)
              const groupStatus = groupHealth?.statusFor(entry)?.status
              return { ...entry, hasSession: live.has(entry.sessionId), exists: row !== undefined, ...(groupStatus === undefined || groupStatus === null ? {} : { groupStatus }) }
            })
            sendJson(res, 200, {
              appId,
              prefsPath,
              defaultMode,
              entries,
              sessions,
              ...(warning === undefined ? {} : { warning }),
            })
          } catch (error) {
            sendJson(res, 500, { error: describeFailure(error) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: TITLES_PATH,
        handler: async (req, res) => {
          if (!sameOrigin(req)) {
            sendJson(res, 403, { error: 'forbidden' })
            return
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed' })
            return
          }
          try {
            sendJson(res, 200, await refreshSessionTitles())
          } catch (error) {
            sendJson(res, 400, { error: describeFailure(error) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: FEATURES_PATH,
        handler: async (req, res) => {
          if (!sameOrigin(req)) {
            sendJson(res, 403, { error: 'forbidden' })
            return
          }
          if (req.method === 'GET' || req.method === 'HEAD') {
            sendJson(res, 200, await features.snapshot())
            return
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed' })
            return
          }
          try {
            const body = await readJsonBody(req)
            await features.save(String(body?.id ?? ''), body)
            sendJson(res, 200, await features.snapshot())
          } catch (error) {
            sendJson(res, 400, { error: describeFailure(error) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: SETTINGS_PATH,
        handler: async (req, res) => {
          if (!sameOrigin(req)) {
            sendJson(res, 403, { error: 'forbidden' })
            return
          }
          if (req.method === 'GET' || req.method === 'HEAD') {
            sendJson(res, 200, { settings: (await features.snapshot()).settings })
            return
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed' })
            return
          }
          try {
            const body = await readJsonBody(req)
            sendJson(res, 200, { settings: features.saveSettings(body) })
          } catch (error) {
            sendJson(res, 400, { error: describeFailure(error) })
          }
        },
      }),
      webServer.register({
        kind: 'exact', path: TOPIC_MODELS_PATH,
        handler: async (req, res) => {
          if (!guard(req, res)) return
          sendJson(res, 200, { models: await listTopicModels(ctx.get('llm')) })
        },
      }),
      webServer.register({
        kind: 'exact', path: TOPIC_RECOMMEND_PATH,
        handler: async (req, res) => {
          if (!sameOrigin(req)) return sendJson(res, 403, { error: 'forbidden' })
          if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
          try {
            const input = await readJsonBody(req)
            const llm = ctx.get('llm')
            const models = await listTopicModels(llm)
            const provider = String(input.provider ?? '')
            const model = String(input.model ?? '')
            if (!models.some((item) => item.provider === provider && item.model === model)) throw new Error('推荐模型不可用，请刷新模型列表')
            sendJson(res, 200, { topics: await recommendTopics(llm, { keyword: input.keyword, provider, model }) })
          } catch (error) {
            sendJson(res, 400, { error: describeFailure(error) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: GROUP_INFO_PATH,
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const url = new URL(req.url ?? GROUP_INFO_PATH, 'http://localhost')
            const openid = (url.searchParams.get('openid') ?? '').trim()
            if (openid === '') {
              sendJson(res, 400, { error: '缺少 group_openid' })
              return
            }
            const credentials = await qqbotApi.readQqbotCredentials(loadOptionalPatches)
            if (credentials === undefined) {
              sendJson(res, 400, {
                error: '没有找到 QQ Bot 凭据：profile 的 im-qqbot 行里没有 appId/appSecret',
                lookup: await qqbotApi.describeCredentialLookup(loadOptionalPatches),
              })
              return
            }
            const key = sessionKey(resolvedAppId(), 'group', openid)
            const prefsId = readPrefs(prefsPath).sessionIds?.[key]
            const askedSessionId = (url.searchParams.get('sessionId') ?? '').trim()
            if (typeof prefsId !== 'string' || prefsId === '') {
              sendJson(res, 404, { error: '上游尚未记录这个群的会话' })
              return
            }
            if (askedSessionId !== '' && askedSessionId !== prefsId) {
              sendJson(res, 409, { error: '群的会话映射已变化，请刷新会话列表' })
              return
            }
            const targetSessionId = prefsId
            const peer = { scope: 'group', peerId: openid, sessionId: targetSessionId }
            const cached = groupCache.get(openid)
            const fresh = url.searchParams.get('fresh') === '1' || groupHealth?.statusFor(peer)?.status === 'unavailable'
            let info = !fresh && cached !== undefined && Date.now() - cached.at < GROUP_CACHE_MS ? cached.info : undefined
            if (info === undefined) {
              info = await qqbotApi.groupInfo(openid, credentials)
              groupHealth?.markAvailable(peer)
              groupCache.set(openid, { at: Date.now(), info })
            }
            let members
            if (url.searchParams.get('members') === '1') {
              try {
                members = await qqbotApi.groupMembers(openid, credentials)
              } catch (error) {
                members = { error: describeFailure(error), code: error?.code }
              }
            }
            const learned = readGroupNames()
            learned[openid] = {
              sessionId: targetSessionId,
              name: info?.group_name ?? '',
              classText: info?.group_class_text ?? '',
              memberNum: info?.group_member_num ?? 0,
              updatedAt: Date.now(),
            }
            writeGroupNames(learned)
            // A successful lookup also fixes the Session title, so a manual
            // group lookup behaves like the list refresh.
            const groupName = typeof info?.group_name === 'string' ? info.group_name.trim() : ''
            if (groupName !== '') {
              try {
                const controller = ctx.get('sessionController')
                const preview = await sessionPreview(controller, targetSessionId, true)
                if (preview.title !== groupName) {
                  await controller.rename({ sessionId: targetSessionId, title: groupName })
                }
                titleCache.set(targetSessionId, { at: Date.now(), preview: { title: groupName } })
              } catch {
                /* the lookup still succeeded; the title is best effort */
              }
            }
            sendJson(res, 200, {
              sessionId: targetSessionId,
              info,
              ...(members === undefined ? {} : { members }),
              credentialsFrom: credentials.source,
            })
          } catch (error) {
            sendJson(res, 400, { error: describeFailure(error) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: FEATURES_RUN_PATH,
        handler: async (req, res) => {
          if (!sameOrigin(req)) {
            sendJson(res, 403, { error: 'forbidden' })
            return
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'method not allowed' })
            return
          }
          try {
            const body = await readJsonBody(req)
            const result = await Promise.resolve(features.run(String(body?.id ?? ''), {
              manual: true,
              ...(body?.id === 'cs2-matches' && body?.forceResend === true ? { forceResend: true } : {}),
              ...(body?.id === 'cs2-matches' && typeof body?.noticeMode === 'string' ? { noticeMode: body.noticeMode } : {}),
            }))
            sendJson(res, 200, { result })
          } catch (error) {
            sendJson(res, 400, { error: describeFailure(error) })
          }
        },
      }),
    ]
    scoped.effect(() => () => {
      for (const dispose of disposers) dispose()
    }, 'qqbot-dispatch.routes')
  })
}
