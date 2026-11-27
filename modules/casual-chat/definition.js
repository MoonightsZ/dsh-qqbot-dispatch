export const definition = {
  id: 'casual-chat',
  label: '偶尔闲聊',
  description: '仅用于群聊。每天定点检查一次；服务回合优先延续群聊讨论，必要时搜索公开话题。',
  provider: 'builtin',
  providerLabel: '内置',
  defaults: { source: { id: 'none', baseUrl: '' }, intervalMinutes: 1440, scheduleMode: 'cron', cron: ['0 19 * * *'] },
  fields: [
    { key: 'chancePercent', kind: 'text', default: '30' },
    { key: 'cooldownHours', kind: 'text', default: '72' },
    { key: 'quietStart', kind: 'text', default: '22' },
    { key: 'quietEnd', kind: 'text', default: '9' },
    { key: 'interestHint', kind: 'text', default: '' },
    { key: 'avoidHint', kind: 'text', default: '' },
    { key: 'topics', kind: 'topics', default: [] },
  ],
}
