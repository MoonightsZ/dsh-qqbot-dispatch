export const definition = {
  id: 'casual-chat',
  label: '偶尔闲聊',
  description: '每天定点检查一次；按概率、冷却和安静时段设置，偶尔在指定 QQ 会话发起简短聊天。',
  provider: 'builtin',
  providerLabel: '内置',
  defaults: { source: { id: 'none', baseUrl: '' }, intervalMinutes: 1440, scheduleMode: 'cron', cron: ['0 19 * * *'] },
  fields: [
    { key: 'chancePercent', kind: 'text', default: '30' },
    { key: 'cooldownHours', kind: 'text', default: '72' },
    { key: 'quietStart', kind: 'text', default: '22' },
    { key: 'quietEnd', kind: 'text', default: '9' },
    { key: 'topics', kind: 'text', default: '' },
  ],
}
