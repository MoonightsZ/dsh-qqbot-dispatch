export function createSessionTables({ h, C, styles, formatRelative, formatAbsolute, StatusPill }) {
function SessionTable({ rows, rowBusy, onRefresh }) {
  return h('table', { style: styles.table },
    h('thead', null, h('tr', null,
      h('th', { style: styles.th }, '会话'),
      h('th', { style: styles.th }, '状态'),
      h('th', { style: { ...styles.th, textAlign: 'right' } }, '最后活动'),
      h('th', { style: { ...styles.th, textAlign: 'right' } }, '群信息'),
    )),
    h('tbody', null, rows.map((row) => h('tr', { key: row.sessionId, className: 'qqd-row' },
      h('td', { style: styles.td },
        h('div', { style: styles.rowTitle },
          row.groupName ?? row.title ?? '(无标题)',
          typeof row.groupMemberNum === 'number' && row.groupMemberNum > 0
            ? h('span', { style: { color: C.secondary, fontSize: 11, fontWeight: 400 } }, ` · ${row.groupMemberNum} 人`)
            : null,
        ),
        h('div', { style: styles.rowSub, title: row.sessionId }, row.sessionId),
      ),
      h('td', { style: styles.td }, row.groupStatus === 'unavailable'
        ? h('span', { style: { color: C.warn }, title: row.groupStatusReason ?? '群不可用' }, '群不可用')
        : h(StatusPill, { live: row.hasSession })),
      h('td', { style: { ...styles.td, textAlign: 'right', color: C.secondary, whiteSpace: 'nowrap' }, title: formatAbsolute(row.updatedAt) },
        formatRelative(row.updatedAt)),
      h('td', { style: { ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' } },
        row.scope === 'group'
          ? h('button', {
            type: 'button',
            className: 'qqd-btn',
            style: { ...styles.ghostButton, ...(rowBusy === row.sessionId ? styles.disabledButton : {}) },
            disabled: rowBusy === row.sessionId,
            title: `群 openid：${row.groupOpenid}`,
            onClick: () => onRefresh(row),
          }, rowBusy === row.sessionId ? '同步中…' : '刷新群名')
          : '—',
      ),
    ))),
  )
}

return { SessionTable }
}
