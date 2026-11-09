import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readPrefs, sessionKey } from './session-resolver.js'
import { assertGroupAvailable } from './group-health.js'

function describeFailure(error) {
  const code = error?.code ?? error?.name
  const message = error instanceof Error ? error.message : String(error)
  return code === undefined ? message : `${code}: ${message}`
}

export function registerDispatchTools(ctx, { resolver, defaultMode, groupHealth }) {
  const { resolvedAppId, resolveTarget, prefsPath } = resolver
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
      assertGroupAvailable(groupHealth, { scope: args.scope, peerId: args.peerId, sessionId: target.sessionId })
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
                groupStatus: { type: 'string', description: 'unavailable when the group API confirmed this target is unreachable.' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.entries.length === 0
          ? `no peers recorded in ${value.prefsPath}`
          : value.entries.map((entry) => `${entry.sessionKey} → ${entry.sessionId} (${entry.resolvedFrom}, ${entry.hasSession ? 'live' : 'cold'}${entry.groupStatus === 'unavailable' ? ', 群不可用' : ''})`).join('\n'),
      }],
    },
    execute(args) {
      const appId = resolvedAppId()
      const prefix = `qqbot:${appId}:`
      const entries = []
      const push = (scope, peerId, sessionId, from) => {
        const groupStatus = groupHealth?.statusFor({ scope, peerId, sessionId })?.status
        entries.push({
          sessionKey: sessionKey(appId, scope, peerId),
          scope,
          peerId,
          sessionId,
          resolvedFrom: from,
          hasSession: ctx.get('sessions')?.get(sessionId) !== undefined,
          ...(groupStatus === undefined ? {} : { groupStatus }),
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

}
