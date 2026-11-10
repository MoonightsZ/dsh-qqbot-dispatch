export function sessionTargetOptions(sessions, selectedId) {
  const available = sessions.filter((session) => session.groupStatus !== 'unavailable')
  const options = available.map((session) => ({
    value: session.sessionId,
    label: `${session.groupName || session.title || '(无标题)'} · ${session.scope === 'group' ? '群聊' : '私聊'} · ${session.sessionId.slice(-8)}`,
    disabled: false,
  }))
  const unavailableSelected = sessions.some((session) => session.sessionId === selectedId && session.groupStatus === 'unavailable')
  const invalidSelected = selectedId !== '' && !available.some((session) => session.sessionId === selectedId)
  if (invalidSelected) {
    options.push({ value: selectedId, label: `${unavailableSelected ? '群不可用' : '已失效'} · ${selectedId.slice(-8)}`, disabled: true })
  }
  return { options, invalidSelected, unavailableSelected }
}

export function featureTargetOptions(sessions, selectedId, defaultId = '') {
  const effectiveSessionId = selectedId || defaultId
  const result = sessionTargetOptions(sessions, effectiveSessionId)
  const defaultLabel = defaultId === '' ? '未设置' : sessionTargetOptions(sessions, defaultId).options.find((option) => option.value === defaultId)?.label ?? '未设置'
  return { ...result, effectiveSessionId, defaultLabel }
}
