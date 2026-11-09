export function createSessionTables({ h, C, MONO, styles, formatRelative, formatAbsolute, StatusPill }) {
function SessionTable({ rows, binding, rowBusy, onRefresh, onBindStart, onBindChange, onBindSubmit, onBindCancel }) {
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
      h('td', { style: styles.td }, h(StatusPill, { live: row.hasSession })),
      h('td', { style: { ...styles.td, textAlign: 'right', color: C.secondary, whiteSpace: 'nowrap' }, title: formatAbsolute(row.updatedAt) },
        formatRelative(row.updatedAt)),
      h('td', { style: { ...styles.td, textAlign: 'right', whiteSpace: 'nowrap' } },
        row.groupOpenid !== undefined
          ? h('button', {
            type: 'button',
            className: 'qqd-btn',
            style: { ...styles.ghostButton, ...(rowBusy === row.sessionId ? styles.disabledButton : {}) },
            disabled: rowBusy === row.sessionId,
            title: `群 openid：${row.groupOpenid}`,
            onClick: () => onRefresh(row),
          }, rowBusy === row.sessionId ? '同步中…' : '刷新群名')
          : binding !== null && binding.sessionId === row.sessionId
            ? h('span', { style: { display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' } },
              h('input', {
                type: 'text',
                className: 'qqd-input',
                style: {
                  width: 200,
                  fontFamily: MONO,
                  fontSize: 11,
                  padding: '4px 6px',
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  background: C.layer1,
                  color: C.primary,
                },
                placeholder: 'group_openid',
                'aria-label': '群 openid',
                value: binding.value,
                autoFocus: true,
                onChange: (event) => onBindChange(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') onBindSubmit()
                  if (event.key === 'Escape') onBindCancel()
                },
              }),
              h('button', {
                type: 'button',
                className: 'qqd-btn',
                style: { ...styles.ghostButton, ...(rowBusy === row.sessionId ? styles.disabledButton : {}) },
                disabled: rowBusy === row.sessionId,
                onClick: () => onBindSubmit(),
              }, rowBusy === row.sessionId ? '…' : '保存'),
              h('button', { type: 'button', className: 'qqd-btn', style: styles.ghostButton, onClick: () => onBindCancel() }, '取消'))
            : h('button', {
              type: 'button',
              className: 'qqd-btn',
              style: styles.ghostButton,
              title: '粘贴该群的 group_openid，拉一次群信息并把群名写成会话标题',
              onClick: () => onBindStart(row.sessionId),
            }, '绑定群'),
      ),
    ))),
  )
}

function PeerTable({ rows }) {
  return h('table', { style: styles.table },
    h('thead', null, h('tr', null,
      h('th', { style: styles.th }, '会话键'),
      h('th', { style: styles.th }, 'sessionId'),
      h('th', { style: styles.th }, '来源'),
      h('th', { style: styles.th }, '状态'),
    )),
    h('tbody', null, rows.map((row) => h('tr', { key: row.sessionKey },
      h('td', { style: { ...styles.td, fontFamily: MONO, fontSize: 11, wordBreak: 'break-all' } }, row.sessionKey),
      h('td', { style: styles.td }, h('div', { style: styles.rowSub }, row.sessionId)),
      h('td', { style: styles.td }, row.resolvedFrom),
      h('td', { style: styles.td }, h(StatusPill, { live: row.hasSession })),
    ))),
  )
}


return { SessionTable, PeerTable }
}
