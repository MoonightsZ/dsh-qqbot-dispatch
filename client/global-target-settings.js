import { sessionTargetOptions } from './session-options.js'
import { createTargetPicker } from './target-picker.js'

export function createGlobalTargetSettings({ React, h, styles, postJson, SETTINGS_PATH }) {
  const { useState } = React
  const TargetPicker = createTargetPicker({ React, h, styles })

  return function GlobalTargetSettings({ settings, features, sessions, onSaved, onNotice, onRefreshSessions }) {
    const [selected, setSelected] = useState(settings.defaultTargetSessionIds ?? [])
    const [busy, setBusy] = useState(false)
    const targetOptions = sessionTargetOptions(sessions, selected)
    const inheriting = features.filter((feature) => (feature.target?.sessionIds ?? []).length === 0)
    const enabledInheriting = inheriting.filter((feature) => feature.enabled)
    const clearingActiveTarget = selected.length === 0 && enabledInheriting.length > 0
    const changed = JSON.stringify(selected) !== JSON.stringify(settings.defaultTargetSessionIds ?? [])

    const save = async () => {
      if (targetOptions.invalidSelected || clearingActiveTarget) return
      setBusy(true)
      try {
        const result = await postJson(SETTINGS_PATH, { defaultTargetSessionIds: selected })
        onSaved(result.settings)
        onNotice({ kind: 'ok', text: '全局默认目标已保存' })
      } catch (error) {
        onNotice({ kind: 'error', text: `保存默认目标失败：${String(error?.message ?? error)}` })
      } finally {
        setBusy(false)
      }
    }

    return h('div', { style: { ...styles.panel, padding: '18px 20px' } },
      h('p', { style: { ...styles.desc, marginTop: 0, marginBottom: 14 } }, '未单独指定目标的模组会使用此目标组；可同时选择群聊和私聊。模组仍可选择自己的目标组。'),
      h('div', { style: styles.field },
        h('span', { style: styles.label }, '默认目标会话'),
        h(TargetPicker, { sessions, selectedIds: selected, onChange: setSelected, onRefreshSessions, label: '默认目标会话' }),
      ),
      targetOptions.invalidSelected ? h('p', { style: styles.warnText }, targetOptions.unavailableSelected ? '所选群不可用，请同步群名确认后再选择。' : '所选会话已失效，请重新选择。') : null,
      h('div', { style: styles.note }, inheriting.length === 0
        ? '目前没有模组继承全局默认目标。'
        : `继承此设置的模组：${inheriting.map((feature) => `${feature.label}${feature.enabled ? '（已启用）' : '（已关闭）'}`).join('、')}。${changed ? selected.length === 0 ? '保存后这些模组将不再有默认目标。' : '保存后将使用新目标组。' : ''}`),
      clearingActiveTarget ? h('p', { style: styles.warnText }, '请先为已启用的继承模组指定独立目标或关闭模组，再清空全局默认目标。') : null,
      h('div', { style: styles.cardFoot },
        h('button', {
          type: 'button', style: styles.primaryButton,
          disabled: busy || !changed || targetOptions.invalidSelected || clearingActiveTarget,
          onClick: () => { void save() },
        }, busy ? '保存中…' : '保存默认目标'),
      ),
    )
  }
}
