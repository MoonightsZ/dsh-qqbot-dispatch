export const definition = {
  id: 'cs2-matches',
  label: 'CS2 赛事通知',
  description: '按设定的间隔或 Cron 检查关注队伍与赛事等级，直发或通过服务回合生成通知。',
  provider: null,
  providerLabel: '未接入',
  fields: [
    { key: 'teams', label: '关注队伍', kind: 'list', placeholder: '例如 Spirit, Vitality', hint: '留空表示全部队伍' },
    { key: 'tiers', label: '关注赛事等级', kind: 'options', options: ['S', 'A', 'B', 'C'], hint: '留空表示全部等级' },
  ],
}
