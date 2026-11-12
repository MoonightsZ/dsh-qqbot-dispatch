import { sessionTargetOptions } from './session-options.js'

/** Searchable, keyboard-friendly QQ session picker shared by global and module settings. */
export function createTargetPicker({ React, h, styles }) {
  const { useState } = React
  return function TargetPicker({ sessions = [], selectedIds = [], onChange, onRefreshSessions, label = '目标会话', inheritLabel = '' }) {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState('')
    const selected = Array.isArray(selectedIds) ? selectedIds : []
    const { options, invalidIds } = sessionTargetOptions(sessions, selected)
    const query = search.trim().toLocaleLowerCase()
    const visible = options.filter((option) => option.label.toLocaleLowerCase().includes(query))
    const toggle = (id, checked) => onChange(checked ? [...selected, id] : selected.filter((item) => item !== id))

    return h('div', { style: { display: 'grid', gap: 8, minWidth: 0 } },
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
        h('button', { type: 'button', style: styles.ghostButton, 'aria-label': `选择${label}`, 'aria-expanded': open,
          onClick: () => { if (!open) void onRefreshSessions?.(); setOpen(!open) } },
        open ? '收起会话' : `选择会话（${selected.length}）`),
        h('button', { type: 'button', style: styles.ghostButton, onClick: () => { void onRefreshSessions?.() } }, '刷新选项'),
        inheritLabel ? h('button', { type: 'button', style: styles.ghostButton, disabled: selected.length === 0,
          onClick: () => onChange([]) }, `使用全局默认（${inheritLabel}）`) : null),
      selected.length === 0 ? h('span', { style: styles.desc }, inheritLabel ? `当前继承全局默认（${inheritLabel}）` : '尚未选择目标会话')
        : h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', minWidth: 0 } },
          ...selected.map((id) => {
            const option = options.find((item) => item.value === id)
            return h('span', { key: id, style: { ...styles.chip, display: 'inline-flex', alignItems: 'center', gap: 4,
              maxWidth: '100%', overflowWrap: 'anywhere' } },
            option?.label ?? id,
            h('button', { type: 'button', 'aria-label': `移除 ${id}`, style: { ...styles.ghostButton, padding: '1px 5px' },
              onClick: () => toggle(id, false) }, '×'))
          })),
      invalidIds.length > 0 ? h('span', { role: 'alert', style: styles.warnText }, `有 ${invalidIds.length} 个目标已失效或群不可用，请移除后保存。`) : null,
      open ? h('div', { style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8,
        padding: 10, maxHeight: 260, overflowY: 'auto', minWidth: 0 } },
        h('input', { type: 'search', 'aria-label': '搜索群聊或私聊', style: { ...styles.input, width: '100%' },
          value: search, placeholder: '搜索群名、私聊或会话 ID', onChange: (event) => setSearch(event.target.value) }),
        visible.length === 0 ? h('p', { style: styles.desc }, '没有匹配的会话；请先让 QQ Bot 收到消息并刷新。') : null,
        ...visible.map((option) => h('label', { key: option.value, style: { display: 'flex', gap: 8, alignItems: 'flex-start',
          padding: '7px 2px', overflowWrap: 'anywhere', cursor: option.disabled ? 'not-allowed' : 'pointer' } },
        h('input', { type: 'checkbox', value: option.value, checked: selected.includes(option.value),
          disabled: option.disabled || (!selected.includes(option.value) && selected.length >= 20),
          onChange: (event) => toggle(option.value, event.target.checked) }),
        h('span', null, option.label)))) : null,
    )
  }
}
