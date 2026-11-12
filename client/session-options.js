function asIds(value) {
  return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
}

export function sessionTargetOptions(sessions, selectedIds) {
  const selected = asIds(selectedIds)
  const available = sessions.filter((session) => session.groupStatus !== 'unavailable')
  const options = available.map((session) => ({
    value: session.sessionId,
    label: `${session.groupName || session.title || '(无标题)'} · ${session.scope === 'group' ? '群聊' : '私聊'} · ${session.sessionId.slice(-8)}`,
    disabled: false,
  }))
  const invalidIds = selected.filter((id) => !available.some((session) => session.sessionId === id))
  const unavailableIds = invalidIds.filter((id) => sessions.some((session) => session.sessionId === id && session.groupStatus === 'unavailable'))
  for (const id of invalidIds) {
    options.push({ value: id, label: `${unavailableIds.includes(id) ? '群不可用' : '已失效'} · ${id.slice(-8)}`, disabled: true })
  }
  return { options, invalidSelected: invalidIds.length > 0, unavailableSelected: unavailableIds.length > 0, invalidIds, unavailableIds }
}

export function featureTargetOptions(sessions, selectedIds, defaultIds = []) {
  const selected = asIds(selectedIds)
  const defaults = asIds(defaultIds)
  const effectiveSessionIds = selected.length > 0 ? selected : defaults
  const result = sessionTargetOptions(sessions, effectiveSessionIds)
  const defaultLabel = defaults.length === 0 ? '未设置' : defaults.length > 1 ? `${defaults.length} 个目标`
    : sessionTargetOptions(sessions, defaults).options.find((option) => option.value === defaults[0])?.label ?? '未设置'
  return { ...result, effectiveSessionIds, effectiveSessionId: effectiveSessionIds[0] ?? '', defaultLabel }
}
