import { deriveSessionId, readPrefs, sessionKey } from './session-resolver.js'

function describeFailure(error) {
  const code = error?.code ?? error?.name
  const message = error instanceof Error ? error.message : String(error)
  return code === undefined ? message : `${code}: ${message}`
}

export function registerDispatchRoutes(ctx, { resolver, groupNames, features, defaultMode, qqbotApi, loadOptionalPatches }) {
  const { resolvedAppId, knownPeers, prefsPath } = resolver
  const { readGroupNames, writeGroupNames } = groupNames
  ctx.inject(['webServer'], (scoped) => {
    const webServer = scoped.webServer
    if (webServer === undefined || typeof webServer.register !== 'function') return
    const SESSIONS_PATH = '/qqbot-tool-dispatch/sessions'
    const FEATURES_PATH = '/qqbot-tool-dispatch/features'
    const FEATURES_RUN_PATH = '/qqbot-tool-dispatch/features/run'
    const GROUP_INFO_PATH = '/qqbot-tool-dispatch/group-info'
    const TITLES_PATH = '/qqbot-tool-dispatch/titles/refresh'
    const GROUP_CACHE_MS = 10 * 60 * 1000
    const groupCache = new Map()

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
    async function sessionPreview(controller, sessionId) {
      try {
        const value = await controller.projections({ sessionId }, new AbortController().signal)
        const title = value?.values?.title
        if (typeof title === 'string' && title !== '') return { title }
        if (typeof title?.val === 'string' && title.val !== '') return { title: title.val }
        return {}
      } catch {
        return {}
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
    /** QQ Bot Sessions from the store; current qqbot ids may start with `session-`. */
    async function listQqbotSessions(archived) {
      const controller = ctx.get('sessionController')
      if (controller?.list === undefined) return []
      const value = await controller.list({}, new AbortController().signal)
      const items = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : []
      const live = liveSessionIds()
      const knownIds = new Set(knownPeers().map((peer) => peer.sessionId))
      const cwd = process.cwd()
      const rows = []
      for (const item of items ?? []) {
        const sessionId = String(item.sessionId)
        if (sessionId.startsWith('session-') && !knownIds.has(sessionId)) continue
        if (item.parentSessionId !== undefined || item.origin === 'subagent') continue
        if (item.cwd !== undefined && item.cwd !== cwd) continue
        if (archived.has(sessionId)) continue
        const preview = await sessionPreview(controller, sessionId)
        rows.push({
          sessionId,
          ...(preview.title === undefined ? {} : { title: preview.title }),
          hasSession: live.has(sessionId),
          updatedAt: item.updatedAt,
        })
      }
      return rows
    }

    /**
     * Pull each known group's name from the QQ platform and rename its Session
     * title to that name. Covers every group this plugin can name: peers learned
     * from the QQ API (`group-names.json`) plus peers qqbot recorded in its
     * per-peer prefs file. A group whose title already matches is not renamed
     * again, so repeated refreshes write nothing.
     */
    async function refreshSessionTitles() {
      const credentials = await qqbotApi.readQqbotCredentials(loadOptionalPatches)
      if (credentials === undefined) {
        throw new Error('没有找到 QQ Bot 凭据：profile 的 im-qqbot 行里没有 appId/appSecret')
      }
      const controller = ctx.get('sessionController')
      const learned = readGroupNames()
      const targets = new Map()
      for (const [openid, entry] of Object.entries(learned)) {
        if (typeof entry?.sessionId === 'string' && entry.sessionId !== '') {
          targets.set(openid, { openid, sessionId: entry.sessionId })
        }
      }
      for (const peer of knownPeers()) {
        if (peer.scope !== 'group' || targets.has(peer.peerId)) continue
        targets.set(peer.peerId, { openid: peer.peerId, sessionId: peer.sessionId })
      }
      const entries = []
      let updated = 0
      let skipped = 0
      let failed = 0
      for (const target of targets.values()) {
        try {
          const info = await qqbotApi.groupInfo(target.openid, credentials)
          const name = typeof info?.group_name === 'string' ? info.group_name.trim() : ''
          if (name === '') throw new Error('接口没有返回 group_name')
          const preview = await sessionPreview(controller, target.sessionId)
          if (preview.title === name) {
            skipped += 1
            entries.push({ openid: target.openid, sessionId: target.sessionId, name, status: 'unchanged' })
          } else {
            await controller.rename({ sessionId: target.sessionId, title: name })
            updated += 1
            entries.push({ openid: target.openid, sessionId: target.sessionId, name, status: 'renamed' })
          }
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
            const archived = await archivedSessionIds()
            let sessions = []
            let warning
            try {
              sessions = await listQqbotSessions(archived)
            } catch (error) {
              warning = describeFailure(error)
            }
            const groupNames = readGroupNames()
            const nameBySession = new Map(
              Object.entries(groupNames)
                .filter(([, entry]) => entry !== null && typeof entry === 'object' && typeof entry.sessionId === 'string')
                .map(([openid, entry]) => [entry.sessionId, { ...entry, openid }]),
            )
            sessions = sessions.map((row) => {
              const known = nameBySession.get(row.sessionId)
              if (known === undefined) return row
              return {
                ...row,
                groupName: known.name,
                groupMemberNum: known.memberNum,
                groupClassText: known.classText,
                groupOpenid: known.openid,
              }
            })
            const byId = new Map(sessions.map((row) => [row.sessionId, row]))
            const entries = knownPeers().filter((entry) => !archived.has(entry.sessionId)).map((entry) => {
              const row = byId.get(entry.sessionId)
              if (row !== undefined && row.peerId === undefined) {
                row.scope = entry.scope
                row.peerId = entry.peerId
                row.resolvedFrom = 'prefs'
              }
              return { ...entry, hasSession: live.has(entry.sessionId), exists: row !== undefined }
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
            // A caller that already knows which Session this group talks to
            // (the sidebar row being bound) overrides the derived identity.
            const askedSessionId = (url.searchParams.get('sessionId') ?? '').trim()
            const targetSessionId = askedSessionId !== ''
              ? askedSessionId
              : typeof prefsId === 'string' && prefsId !== '' ? prefsId : deriveSessionId(key)
            const cached = groupCache.get(openid)
            const fresh = url.searchParams.get('fresh') === '1'
            let info = !fresh && cached !== undefined && Date.now() - cached.at < GROUP_CACHE_MS ? cached.info : undefined
            if (info === undefined) {
              info = await qqbotApi.groupInfo(openid, credentials)
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
                const preview = await sessionPreview(controller, targetSessionId)
                if (preview.title !== groupName) {
                  await controller.rename({ sessionId: targetSessionId, title: groupName })
                }
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
            const result = await Promise.resolve(features.run(String(body?.id ?? ''), { manual: true }))
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
