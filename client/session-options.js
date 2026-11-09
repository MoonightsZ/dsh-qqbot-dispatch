export function sessionTargetOptions(sessions, selectedId) {
  const options = sessions.map((session) => ({
    value: session.sessionId,
    label: `${session.groupName || session.title || '(无标题)'} · ${session.scope === 'group' ? '群聊' : '私聊'} · ${session.sessionId.slice(-8)}`,
    disabled: false,
  }))
  const invalidSelected = selectedId !== '' && !sessions.some((session) => session.sessionId === selectedId)
  if (invalidSelected) {
    options.push({ value: selectedId, label: `已失效 · ${selectedId.slice(-8)}`, disabled: true })
  }
  return { options, invalidSelected }
}
