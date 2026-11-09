/**
 * qqbot-dispatch — dispatch a task into a QQ Bot IM session created by
 * `@tencent-connect/dsh-qqbot`.
 *
 * Route A (no changes to the qqbot plugin): the tool resolves the target
 * Session id the same way `SessionManager` does — `qqbot:<appId>:<scope>:<peerId>`
 * through the per-peer prefs file, falling back to the derived sha256 id — then
 * admits one user message through `ctx.sessionController.prompt()`.
 *
 * Known limitation: the qqbot outbound handler looks the reply target up with
 * `SessionManager.findBySessionId()`, which only knows sessions the plugin
 * itself created in this process. A cold target therefore runs the turn and
 * records it in its own log, but no message goes back to QQ.
 *
 * @module dsh-tool-qqbot-dispatch
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { createFeatureRuntime } from './features.js'
import * as qqbotApi from './qqbot-creds.js'
import { createLiquipediaProvider } from './liquipedia.js'

/** Cordis plugin name. */
export const name = 'tool-qqbot-dispatch'

/** Services used by the tools. */
export const inject = ['tools', 'sessionController']

const SCOPES = ['c2c', 'group']

/** The session key the qqbot SessionManager builds for one peer. */
function sessionKey(appId, scope, peerId) {
  return `qqbot:${appId}:${scope}:${peerId}`
}

/** The deterministic Session id qqbot derives when no per-peer override exists. */
function deriveSessionId(key) {
  const hash = createHash('sha256').update(key).digest('hex')
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`
}

/** Read the qqbot per-peer prefs document; a missing or broken file reads as empty. */
function readPrefs(prefsPath) {
  try {
    if (!existsSync(prefsPath)) return {}
    const data = JSON.parse(readFileSync(prefsPath, 'utf8'))
    return data !== null && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function assertScope(scope) {
  if (!SCOPES.includes(scope)) throw new Error(`scope must be one of ${SCOPES.join(' | ')}, received "${scope}"`)
}

function describeFailure(error) {
  const code = error?.code ?? error?.name
  const message = error instanceof Error ? error.message : String(error)
  return code === undefined ? message : `${code}: ${message}`
}

/**
 * Register the dispatch tools for this composition.
 * @param ctx - context providing the tool registry and the Session controller.
 * @param config - optional `appId`, `prefsPath`, and `defaultMode`.
 */
export function apply(ctx, config = {}) {
  const configuredAppId = config.appId
  const prefsPath = config.prefsPath ?? resolve(homedir(), '.dsh-qqbot', 'model-prefs.json')
  const defaultMode = config.defaultMode ?? 'queue'
  const groupNamesPath = resolve(homedir(), '.dsh-qqbot', 'group-names.json')

  /** Persisted group_openid → { sessionId, name, memberNum } learned from the QQ API. */
  function readGroupNames() {
    try {
      if (!existsSync(groupNamesPath)) return {}
      const data = JSON.parse(readFileSync(groupNamesPath, 'utf8'))
      return data !== null && typeof data === 'object' ? data : {}
    } catch {
      return {}
    }
  }

  function writeGroupNames(map) {
    try {
      mkdirSync(dirname(groupNamesPath), { recursive: true })
      writeFileSync(`${groupNamesPath}.${process.pid}.tmp`, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 })
      renameSync(`${groupNamesPath}.${process.pid}.tmp`, groupNamesPath)
    } catch {
      /* best effort */
    }
  }

  function resolvedAppId() {
    const appId = configuredAppId ?? process.env.QQBOT_APPID
    if (appId === undefined || appId === '') {
      throw new Error(
        'qqbot_dispatch: no QQ Bot appId — set `appId` on this plugin in the profile cordis.patch.yml, or export QQBOT_APPID',
      )
    }
    return appId
  }

  function resolveTarget(scope, peerId) {
    assertScope(scope)
    if (typeof peerId !== 'string' || peerId.trim() === '') throw new Error('peerId must be a non-empty peer openid')
    const appId = resolvedAppId()
    const key = sessionKey(appId, scope, peerId)
    const record = readPrefs(prefsPath).sessionIds?.[key]
    if (typeof record === 'string' && record !== '') return { key, sessionId: record, from: 'prefs' }
    return { key, sessionId: deriveSessionId(key), from: 'derived' }
  }

  const features = createFeatureRuntime({ ctx })
  /**
   * Deliver one feature message: straight to the QQ group when its openid is
   * known, otherwise as a prompt into the target Session (route A fallback).
   */
  async function deliverFeatureMessage({ target, text, markdown, card }) {
    const names = readGroupNames()
    const openid = Object.keys(names).find((key) => names[key]?.sessionId === target.sessionId)
    if (openid !== undefined) {
      const credentials = await qqbotApi.readQqbotCredentials(loadOptionalPatches)
      if (credentials !== undefined) {
        try {
          const warnings = []
          let channel = 'qq'
          if (card !== undefined && card !== null) {
            try {
              await qqbotApi.sendGroupCard(openid, card, credentials)
              channel = 'qq-card'
            } catch (error) {
              if (error?.code === 40034100) throw error
              warnings.push(`卡片未发送：${describeFailure(error)}`)
            }
          }
          if (typeof markdown === 'string' && markdown !== '') {
            try {
              await qqbotApi.sendGroupMarkdown(openid, markdown, credentials)
              return { channel: channel === 'qq-card' ? 'qq-card+md' : 'qq-md', ...(warnings.length === 0 ? {} : { warning: warnings.join('；') }) }
            } catch (error) {
              if (error?.code === 40034100) throw error
              warnings.push(`Markdown 未发送：${describeFailure(error)}`)
            }
          }
          await qqbotApi.sendGroupText(openid, text, credentials)
          return { channel, ...(warnings.length === 0 ? {} : { warning: warnings.join('；') }) }
        } catch (error) {
          const reason = error?.code === 40034100
            ? 'QQ 主动消息发送受限（40034100：频率过高或对方关闭了主动消息）'
            : describeFailure(error)
          await ctx.sessionController.prompt({
            requestId: randomUUID(),
            sessionId: target.sessionId,
            mode: 'queue',
            content: [{ type: 'text', text }],
          }, new AbortController().signal)
          return { channel: 'session', warning: reason }
        }
      }
    }
    await ctx.sessionController.prompt({
      requestId: randomUUID(),
      sessionId: target.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    }, new AbortController().signal)
    return { channel: 'session' }
  }


  features.registerProvider('cs2-matches', createLiquipediaProvider({ deliver: deliverFeatureMessage }))
  ctx.effect(() => features.start(), 'qqbot-dispatch.features')

  ctx.tools.register(defineTool({
    name: 'qqbot_dispatch',
    description: [
      'Dispatch one task into a QQ Bot session created by the dsh-qqbot plugin.',
      'Address the target the way QQ does: scope "c2c" plus the user openid, or scope "group" plus the group openid.',
      'The prompt is admitted as a user message in that session and the session runs on its own; this tool returns as soon as it is accepted.',
      'It does not wait for the target turn and does not relay the target reply back to this session.',
    ].join(' '),
    parameters: {
      scope: {
        type: 'string',
        required: true,
        description: 'QQ chat kind: "c2c" for a direct message, "group" for a group chat.',
      },
      peerId: {
        type: 'string',
        required: true,
        description: 'Target peer openid: the user openid for c2c, the group openid for group.',
      },
      text: {
        type: 'string',
        required: true,
        description: 'Task text delivered as one user message in the target session.',
      },
      mode: {
        type: 'string',
        description: '"queue" appends behind a running turn; "steer" interrupts into it. Omit for the configured default.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', required: true, description: 'Session that accepted the prompt.' },
          sessionKey: { type: 'string', required: true, description: 'qqbot peer key the session id was resolved from.' },
          resolvedFrom: { type: 'string', required: true, description: '"prefs" when the per-peer override supplied the id, "derived" otherwise.' },
          mode: { type: 'string', required: true, description: 'Delivery mode used for the prompt.' },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `dispatched to ${value.sessionId} (${value.sessionKey}, ${value.resolvedFrom}, ${value.mode})`,
      }],
    },
    async execute(args, exec) {
      const target = resolveTarget(args.scope, args.peerId)
      const mode = args.mode ?? defaultMode
      if (mode !== 'queue' && mode !== 'steer') throw new Error(`mode must be "queue" or "steer", received "${mode}"`)
      const signal = exec?.signal ?? new AbortController().signal
      try {
        await ctx.sessionController.prompt({
          requestId: randomUUID(),
          sessionId: target.sessionId,
          mode,
          content: [{ type: 'text', text: args.text }],
        }, signal)
      } catch (error) {
        throw new Error(
          `qqbot_dispatch failed for ${args.scope}:${args.peerId} → ${target.sessionId} (resolved from ${target.from}): ${describeFailure(error)}`,
        )
      }
      return { sessionId: target.sessionId, sessionKey: target.key, resolvedFrom: target.from, mode }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'qqbot_sessions',
    description: [
      'Inspect QQ Bot peer→session mappings known to the dsh-qqbot plugin.',
      'Pass scope and peerId to resolve one target exactly as qqbot_dispatch would; omit both to list every peer recorded in the per-peer prefs file.',
    ].join(' '),
    parameters: {
      scope: {
        type: 'string',
        description: 'QQ chat kind: "c2c" or "group". Required together with peerId.',
      },
      peerId: {
        type: 'string',
        description: 'Peer openid to resolve. Required together with scope.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          appId: { type: 'string', required: true, description: 'QQ Bot appId the keys are scoped to.' },
          prefsPath: { type: 'string', required: true, description: 'Per-peer prefs file that was read.' },
          entries: {
            type: 'array',
            required: true,
            description: 'Resolved peers: the requested one, or every peer recorded in prefs.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sessionKey: { type: 'string', required: true, description: 'qqbot peer key.' },
                scope: { type: 'string', required: true, description: 'c2c or group.' },
                peerId: { type: 'string', required: true, description: 'Peer openid.' },
                sessionId: { type: 'string', required: true, description: 'Session id the peer resolves to.' },
                resolvedFrom: { type: 'string', required: true, description: '"prefs" or "derived".' },
                hasSession: { type: 'boolean', required: true, description: 'Whether the Session is attached right now.' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.entries.length === 0
          ? `no peers recorded in ${value.prefsPath}`
          : value.entries.map((entry) => `${entry.sessionKey} → ${entry.sessionId} (${entry.resolvedFrom}, ${entry.hasSession ? 'live' : 'cold'})`).join('\n'),
      }],
    },
    execute(args) {
      const appId = resolvedAppId()
      const prefix = `qqbot:${appId}:`
      const entries = []
      const push = (scope, peerId, sessionId, from) => {
        entries.push({
          sessionKey: sessionKey(appId, scope, peerId),
          scope,
          peerId,
          sessionId,
          resolvedFrom: from,
          hasSession: ctx.get('sessions')?.get(sessionId) !== undefined,
        })
      }
      if (args.scope !== undefined || args.peerId !== undefined) {
        if (args.scope === undefined || args.peerId === undefined) throw new Error('pass both scope and peerId, or neither')
        const target = resolveTarget(args.scope, args.peerId)
        push(args.scope, args.peerId, target.sessionId, target.from)
      } else {
        for (const [key, sessionId] of Object.entries(readPrefs(prefsPath).sessionIds ?? {})) {
          if (!key.startsWith(prefix) || typeof sessionId !== 'string') continue
          const [scope, peerId] = key.slice(prefix.length).split(':')
          if (scope === undefined || peerId === undefined) continue
          push(scope, peerId, sessionId, 'prefs')
        }
      }
      return { appId, prefsPath, entries }
    },
  }))

  // ── Settings page backend ────────────────────────────────────────────────
  // Read-only, same-origin JSON that the `settings.section` page in client.js
  // renders. Registers only when the Web host composed a webServer; a CLI
  // profile without one keeps working with the tools alone.
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
    /** Peers qqbot recorded in the per-peer prefs file (forked or model-bound sessions). */
    const knownPeers = (appId) => {
      const prefix = `qqbot:${appId}:`
      const rows = []
      for (const [key, sessionId] of Object.entries(readPrefs(prefsPath).sessionIds ?? {})) {
        if (!key.startsWith(prefix) || typeof sessionId !== 'string' || sessionId === '') continue
        const [scope, peerId] = key.slice(prefix.length).split(':')
        if (scope === undefined || peerId === undefined) continue
        rows.push({ sessionKey: key, scope, peerId, sessionId, resolvedFrom: 'prefs' })
      }
      return rows
    }
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
    /**
     * Sessions qqbot created, read from the Session store without activating an Agent.
     * qqbot's ids are the derived uuid (bare, never the web shell's `session-` prefix) and take no
     * parent, so delegated subagent Sessions are skipped. Neither scope openid is persisted by
     * qqbot, so the peer stays unknown unless the prefs file records it.
     */
    async function listQqbotSessions(archived) {
      const controller = ctx.get('sessionController')
      if (controller?.list === undefined) return []
      const value = await controller.list({}, new AbortController().signal)
      const items = Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : []
      const live = liveSessionIds()
      const cwd = process.cwd()
      const rows = []
      for (const item of items ?? []) {
        const sessionId = String(item.sessionId)
        if (sessionId.startsWith('session-')) continue
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
      const appId = resolvedAppId()
      const controller = ctx.get('sessionController')
      const learned = readGroupNames()
      const targets = new Map()
      for (const [openid, entry] of Object.entries(learned)) {
        if (typeof entry?.sessionId === 'string' && entry.sessionId !== '') {
          targets.set(openid, { openid, sessionId: entry.sessionId })
        }
      }
      for (const peer of knownPeers(appId)) {
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
            const entries = knownPeers(appId).filter((entry) => !archived.has(entry.sessionId)).map((entry) => {
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
