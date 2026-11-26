/** QQ Bot dispatch supplement for @tencent-connect/dsh-qqbot. */
import { createFeatureRuntime } from './features.js'
import { createCs2Provider } from './modules/cs2-matches/provider.js'
import { createSessionResolver } from './session-resolver.js'
import { createGroupNameStore } from './group-names.js'
import { createGroupHealthStore } from './group-health.js'
import { createServiceTurnDispatcher } from './service-turn.js'
import { createUpstreamSender } from './upstream-sender.js'
import { createNotificationDispatcher } from './notification-dispatcher.js'
import { createGroupChatGate } from './modules/group-chat-gate/provider.js'
import { createChatProvider } from './modules/casual-chat/provider.js'
import { createLazyProvider, discoverModules } from './module-discovery.js'
import { registerDispatchTools } from './tools.js'
import { registerDispatchRoutes } from './routes.js'
import { loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as qqbotApi from './qqbot-creds.js'

export const name = 'qqbot-dispatch'
export const inject = ['tools', 'sessionController', 'sessions', 'sessionPersistence']

export async function apply(ctx, config = {}) {
  const resolver = createSessionResolver({ appId: config.appId, prefsPath: config.prefsPath })
  const groupNames = createGroupNameStore()
  const groupHealth = createGroupHealthStore(config.groupHealthPath)
  const defaultMode = config.defaultMode ?? 'queue'
  const modules = await discoverModules({ onError: (id, error) => console.warn(`[qqbot-dispatch] 跳过模组 ${id}：${String(error?.message ?? error)}`) })
  const features = createFeatureRuntime({ ctx, modules: modules.map((item) => item.definition) })
  const serviceTurn = createServiceTurnDispatcher(ctx, { resolver, groupHealth, createUserMessage })
  let upstreamSender
  try {
    const { QQBot } = await import('@tencent-connect/qqbot-nodejs')
    try {
      const gateFeature = features.getFeature('group-chat-gate')
      const gate = createGroupChatGate({ QQBot, feature: gateFeature,
        onError: (error) => console.warn(`[qqbot-dispatch] 群聊频控重放失败：${String(error?.message ?? error)}`) })
      const unsubscribe = features.onSave('group-chat-gate', (feature) => gate.update(feature))
      ctx.effect(() => () => { unsubscribe(); gate.dispose() }, 'qqbot-dispatch.group-chat-gate')
    } catch (error) {
      const message = String(error?.message ?? error)
      features.setRuntimeError('group-chat-gate', message)
      console.warn(`[qqbot-dispatch] 群聊频控不可用：${message}`)
    }
    upstreamSender = createUpstreamSender({ QQBot, resolver, groupHealth })
    ctx.effect(() => () => upstreamSender.dispose(), 'qqbot-dispatch.upstream-sender')
  } catch (error) {
    features.setRuntimeError('group-chat-gate', `上游 QQ Bot SDK 不可用：${String(error?.message ?? error)}`)
    upstreamSender = { send: async () => { throw new Error(`上游 QQ Bot 发送器不可用：${String(error?.message ?? error)}`) } }
  }
  const notificationDispatcher = createNotificationDispatcher({ serviceTurn, upstreamSender })
  for (const module of modules) {
    const id = module.definition.id
    if (id === 'group-chat-gate') continue
    const provider = id === 'cs2-matches'
      ? createCs2Provider({ notificationDispatcher })
      : id === 'casual-chat'
        ? createChatProvider({ notificationDispatcher })
        : createLazyProvider(module.providerPath, { notificationDispatcher })
    features.registerProvider(id, provider)
  }
  ctx.effect(() => features.start(), 'qqbot-dispatch.features')
  registerDispatchTools(ctx, { resolver, defaultMode, groupHealth })
  registerDispatchRoutes(ctx, { resolver, groupNames, groupHealth, features, defaultMode, qqbotApi, loadOptionalPatches })
}
