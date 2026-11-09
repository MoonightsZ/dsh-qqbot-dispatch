/** QQ Bot dispatch supplement for @tencent-connect/dsh-qqbot. */
import { createFeatureRuntime } from './features.js'
import { createLiquipediaProvider } from './modules/cs2-matches/provider.js'
import { createSessionResolver } from './session-resolver.js'
import { createGroupNameStore } from './group-names.js'
import { createFeatureDelivery } from './delivery.js'
import { createServiceTurnDispatcher } from './service-turn.js'
import { createChatProvider } from './modules/casual-chat/provider.js'
import { registerDispatchTools } from './tools.js'
import { registerDispatchRoutes } from './routes.js'
import { loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as qqbotApi from './qqbot-creds.js'

export const name = 'qqbot-dispatch'
export const inject = ['tools', 'sessionController', 'sessions', 'sessionPersistence']

export function apply(ctx, config = {}) {
  const resolver = createSessionResolver({ appId: config.appId, prefsPath: config.prefsPath })
  const groupNames = createGroupNameStore()
  const defaultMode = config.defaultMode ?? 'queue'
  const features = createFeatureRuntime({ ctx })
  const serviceTurn = createServiceTurnDispatcher(ctx, { resolver, createUserMessage })
  const deliver = createFeatureDelivery(groupNames, { qqbotApi, loadOptionalPatches, serviceTurn })
  features.registerProvider('cs2-matches', createLiquipediaProvider({ deliver }))
  features.registerProvider('casual-chat', createChatProvider({ serviceTurn }))
  ctx.effect(() => features.start(), 'qqbot-dispatch.features')
  registerDispatchTools(ctx, { resolver, defaultMode })
  registerDispatchRoutes(ctx, { resolver, groupNames, features, defaultMode, qqbotApi, loadOptionalPatches })
}
