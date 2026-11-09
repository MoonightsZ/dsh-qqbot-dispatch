window.__ModuleLoader__.load({
  id: 'dsh-tool-qqbot-dispatch',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const SESSIONS_PATH = '/qqbot-tool-dispatch/sessions'
    const TITLES_PATH = '/qqbot-tool-dispatch/titles/refresh'
    const GROUP_INFO_PATH = '/qqbot-tool-dispatch/group-info'
    const FEATURES_PATH = '/qqbot-tool-dispatch/features'
    const FEATURES_RUN_PATH = '/qqbot-tool-dispatch/features/run'

    const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    const C = {
      primary: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l1)',
      borderStrong: 'var(--dsw-alias-border-l2)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      brand: 'var(--dsw-alias-brand-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }

    const styles = {
      page: {
        color: C.primary,
        fontSize: 13,
        lineHeight: 1.65,
        boxSizing: 'border-box',
        height: '100%',
        overflow: 'auto',
        padding: '22px 28px 32px',
      },
      inner: { maxWidth: 960, margin: '0 auto' },
      header: { display: 'flex', alignItems: 'flex-start', gap: 12, margin: '0 0 4px' },
      headerText: { flex: '1 1 auto', minWidth: 0 },
      title: { margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: 0.2 },
      subtitle: { margin: '2px 0 0', color: C.secondary, fontSize: 12 },
      tabs: {
        display: 'flex',
        gap: 20,
        margin: '14px 0 2px',
        borderBottom: `1px solid ${C.borderStrong}`,
      },
      tab: {
        fontSize: 13,
        padding: '8px 2px',
        cursor: 'pointer',
        color: C.secondary,
        background: 'transparent',
        border: 'none',
        borderBottom: '2px solid transparent',
        marginBottom: -1,
        transition: 'color .12s ease',
      },
      tabActive: {
        fontSize: 13,
        padding: '8px 2px',
        cursor: 'pointer',
        color: C.brand,
        background: 'transparent',
        border: 'none',
        borderBottom: `2px solid ${C.brand}`,
        marginBottom: -1,
        fontWeight: 600,
      },
      section: { margin: '16px 0 10px', display: 'flex', alignItems: 'baseline', gap: 8 },
      sectionTitle: { fontSize: 13.5, fontWeight: 600 },
      sectionMeta: { color: C.secondary, fontSize: 11.5 },
      sectionAction: { marginLeft: 'auto' },
      card: {
        border: `1px solid ${C.borderStrong}`,
        borderRadius: 14,
        padding: '14px 16px 16px',
        background: C.layer1,
        boxShadow: '0 1px 2px rgba(0,0,0,0.10), 0 10px 28px rgba(0,0,0,0.12)',
      },
      cardOn: {
        borderLeft: `3px solid ${C.ok}`,
      },
      segmented: {
        display: 'inline-flex',
        border: `1px solid ${C.borderStrong}`,
        borderRadius: 7,
        overflow: 'hidden',
        alignSelf: 'flex-start',
      },
      seg: {
        fontSize: 12,
        padding: '4px 12px',
        cursor: 'pointer',
        color: C.secondary,
        background: 'transparent',
        border: 'none',
      },
      segOn: {
        fontSize: 12,
        padding: '4px 12px',
        cursor: 'pointer',
        color: 'var(--dsw-alias-bg-base)',
        background: C.brand,
        border: 'none',
      },
      collapsedLine: {
        margin: '8px 0 0 18px',
        color: C.secondary,
        fontSize: 11.5,
      },
      cardHead: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        paddingBottom: 10,
        borderBottom: `1px solid ${C.border}`,
      },
      cardTitle: { fontSize: 14, fontWeight: 600 },
      chip: {
        fontSize: 11,
        lineHeight: 1.5,
        padding: '1px 8px',
        borderRadius: 999,
        color: C.secondary,
        background: C.layer2,
        border: `1px solid ${C.border}`,
      },
      chipWarn: {
        fontSize: 11,
        lineHeight: 1.5,
        padding: '1px 8px',
        borderRadius: 999,
        color: C.warn,
        background: 'transparent',
        border: `1px solid ${C.warn}`,
      },
      desc: { margin: '8px 0 0', color: C.secondary, fontSize: 12, maxWidth: 720 },
      divider: { height: 1, background: C.border, margin: '12px 0' },
      grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '12px 20px',
      },
      field: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 },
      label: { color: C.secondary, fontSize: 11.5 },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        fontSize: 12.5,
        padding: '6px 9px',
        borderRadius: 7,
        color: C.primary,
        background: 'var(--dsw-alias-bg-base)',
        border: `1px solid ${C.borderStrong}`,
        outline: 'none',
      },
      select: {
        width: '100%',
        boxSizing: 'border-box',
        fontSize: 12.5,
        padding: '6px 9px',
        borderRadius: 7,
        color: C.primary,
        background: 'var(--dsw-alias-bg-base)',
        border: `1px solid ${C.borderStrong}`,
      },
      tagBox: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 4,
        minHeight: 34,
        boxSizing: 'border-box',
        padding: '4px 6px',
        borderRadius: 7,
        background: 'var(--dsw-alias-bg-base)',
        border: `1px solid ${C.borderStrong}`,
      },
      tag: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11.5,
        lineHeight: 1.6,
        padding: '2px 4px 2px 8px',
        borderRadius: 6,
        color: C.primary,
        background: C.layer2,
        border: `1px solid ${C.border}`,
      },
      tagRemove: {
        border: 'none',
        background: 'transparent',
        color: C.secondary,
        cursor: 'pointer',
        fontSize: 13,
        lineHeight: 1,
        padding: '0 2px',
      },
      tagInput: {
        flex: '1 1 120px',
        minWidth: 90,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color: C.primary,
        fontSize: 12.5,
        padding: '3px 2px',
      },
      sourceBlock: {
        margin: '12px 0 0',
        padding: '10px 12px',
        borderRadius: 9,
        background: C.layer2,
        border: `1px solid ${C.border}`,
      },
      sourceHead: { display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 8px', flexWrap: 'wrap' },
      sourceTitle: { fontSize: 12.5, fontWeight: 600 },
      monoHint: { color: C.secondary, fontSize: 10.5, fontFamily: MONO, wordBreak: 'break-all' },
      chipOk: {
        fontSize: 11,
        lineHeight: 1.5,
        padding: '1px 8px',
        borderRadius: 999,
        color: C.ok,
        background: 'transparent',
        border: `1px solid ${C.ok}`,
      },
      keyRow: { display: 'flex', gap: 8, alignItems: 'center' },
      details: { marginTop: 10 },
      summary: {
        cursor: 'pointer',
        color: C.secondary,
        fontSize: 11.5,
        userSelect: 'none',
        listStyle: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: '100%',
      },
      summaryValue: { color: C.secondary, fontSize: 11, fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 },
      detailsBody: { marginTop: 6 },
      rangeRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minHeight: 34,
        boxSizing: 'border-box',
        padding: '0 2px',
      },
      rangeValue: { color: C.primary, fontSize: 12.5, whiteSpace: 'nowrap', minWidth: 56, textAlign: 'right' },
      cardFoot: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 14 },
      statusLine: { marginLeft: 'auto', color: C.secondary, fontSize: 11.5 },
      statusError: { marginLeft: 'auto', color: C.error, fontSize: 11.5 },
      primaryButton: {
        fontSize: 12.5,
        padding: '6px 16px',
        borderRadius: 7,
        cursor: 'pointer',
        color: 'var(--dsw-alias-bg-base)',
        background: C.brand,
        border: `1px solid ${C.brand}`,
      },
      ghostButton: {
        fontSize: 12.5,
        padding: '6px 14px',
        borderRadius: 7,
        cursor: 'pointer',
        color: C.primary,
        background: 'transparent',
        border: `1px solid ${C.borderStrong}`,
      },
      disabledButton: { opacity: 0.5, cursor: 'default' },
      panel: {
        border: `1px solid ${C.borderStrong}`,
        borderRadius: 14,
        background: C.layer1,
        boxShadow: '0 1px 2px rgba(0,0,0,0.10), 0 10px 28px rgba(0,0,0,0.12)',
        overflow: 'hidden',
      },
      table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: 12.5 },
      th: {
        textAlign: 'left',
        fontWeight: 500,
        color: C.secondary,
        fontSize: 11.5,
        padding: '6px 10px',
        borderBottom: `1px solid ${C.borderStrong}`,
        whiteSpace: 'nowrap',
      },
      td: { padding: '9px 10px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' },
      rowTitle: { color: C.primary, fontWeight: 500 },
      rowSub: { color: C.secondary, fontSize: 11, fontFamily: MONO, wordBreak: 'break-all' },
      pill: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5 },
      dot: { width: 6, height: 6, borderRadius: 999, flex: '0 0 auto' },
      empty: {
        border: `1px dashed ${C.borderStrong}`,
        borderRadius: 10,
        padding: '22px 16px',
        textAlign: 'center',
        color: C.secondary,
        fontSize: 12,
      },
      toast: {
        position: 'fixed',
        top: 18,
        right: 22,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        maxWidth: 380,
        boxSizing: 'border-box',
        padding: '10px 10px 10px 14px',
        borderRadius: 10,
        fontSize: 12.5,
        lineHeight: 1.5,
        background: C.layer1,
        boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
        animation: 'qqd-toast-in .16s ease-out',
      },
      toastOk: { border: `1px solid ${C.ok}`, color: C.ok },
      toastError: { border: `1px solid ${C.error}`, color: C.error },
      toastClose: {
        border: 'none',
        background: 'transparent',
        color: C.secondary,
        cursor: 'pointer',
        fontSize: 14,
        lineHeight: 1,
        padding: '0 2px',
      },
      errorText: { margin: '10px 0 0', color: C.error, fontSize: 12 },
      warnText: { margin: '8px 0 0', color: C.warn, fontSize: 12 },
      footer: { margin: '24px 0 0', paddingTop: 12, borderTop: `1px solid ${C.border}`, color: C.secondary, fontSize: 11 },
      footerRow: { display: 'flex', flexWrap: 'wrap', gap: '2px 10px', marginTop: 2 },
      mono: { fontFamily: MONO, wordBreak: 'break-all' },
      switchTrack: {
        width: 46,
        height: 26,
        borderRadius: 999,
        position: 'relative',
        padding: 0,
        border: 'none',
        cursor: 'pointer',
        transition: 'background .15s ease',
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.18)',
      },
      switchKnob: {
        position: 'absolute',
        top: 3,
        width: 20,
        height: 20,
        borderRadius: 999,
        background: '#fff',
        transition: 'left .15s ease',
        boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
      },
    }

    async function readJson(url, init) {
      const response = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init?.headers ?? {}) } })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    }

    function postJson(url, payload) {
      return readJson(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    }

    function formatRelative(time) {
      if (typeof time !== 'number' || !Number.isFinite(time) || time === 0) return '—'
      const diff = Date.now() - time
      if (diff < 60_000) return '刚刚'
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
      if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
      if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
      try {
        return new Date(time).toLocaleDateString()
      } catch {
        return '—'
      }
    }

    function formatAbsolute(time) {
      if (typeof time !== 'number' || !Number.isFinite(time) || time === 0) return '—'
      try {
        return new Date(time).toLocaleString()
      } catch {
        return '—'
      }
    }

    function PanelIcon({ size, active }) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        'aria-hidden': true,
        style: { display: 'block', color: active ? C.primary : C.secondary },
      },
        h('rect', { x: 2, y: 4, width: 20, height: 14, rx: 4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', {
          d: 'M9.5 11h5.5m-2.2-2.2L15 11l-2.2 2.2',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M7.5 21.5l2.6-3.5H7.5z', fill: 'currentColor' }),
      )
    }

    function Switch({ checked, disabled, label, onChange }) {
      const style = {
        ...styles.switchTrack,
        background: checked ? C.ok : 'var(--dsw-alias-border-l2)',
        ...(disabled ? styles.disabledButton : {}),
      }
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        'aria-label': label,
        disabled,
        onClick: () => onChange(!checked),
        style,
      }, h('span', { style: { ...styles.switchKnob, left: checked ? 23 : 3 } }))
    }

    function StatusPill({ live }) {
      return h('span', {
        style: styles.pill,
        title: live
          ? '进程内有 Agent，回复能推回 QQ'
          : '进程内没有 Agent（休眠）；收到 QQ 消息后会自动恢复，此时下发能执行但不会回 QQ',
      },
        h('span', { style: { ...styles.dot, background: live ? C.ok : C.borderStrong } }),
        h('span', { style: { color: live ? C.ok : C.secondary } }, live ? '活跃' : '休眠'),
      )
    }

    function Section({ title, meta, action, children }) {
      return h('div', null,
        h('div', { style: styles.section },
          h('span', { style: styles.sectionTitle }, title),
          meta === undefined ? null : h('span', { style: styles.sectionMeta }, meta),
          action === undefined ? null : h('span', { style: styles.sectionAction }, action),
        ),
        children,
      )
    }

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

    function splitTeam(text) {
      return String(text ?? '').split(/[,，;；\s]+/).map((item) => item.trim()).filter((item) => item !== '')
    }

    function TierRange({ options, tiers, onChange }) {
      const max = options.length - 1
      const picked = tiers.map((tier) => options.indexOf(tier)).filter((index) => index >= 0)
      const lo = picked.length === 0 ? 0 : Math.min(...picked)
      const hi = picked.length === 0 ? max : Math.max(...picked)
      const apply = (left, right) => {
        const start = Math.max(0, Math.min(max, Math.min(left, right)))
        const end = Math.max(0, Math.min(max, Math.max(left, right)))
        onChange(start === 0 && end === max ? [] : options.slice(start, end + 1))
      }
      const percent = (index) => (max === 0 ? 0 : (index / max) * 100)
      return h('div', { style: styles.rangeRow },
        h('div', { className: 'qqd-slider' },
          h('div', { className: 'qqd-range' },
            h('div', {
              className: 'qqd-range-fill',
              style: { left: `${percent(lo)}%`, width: `${percent(hi) - percent(lo)}%` },
            }),
            h('input', {
              type: 'range', min: 0, max, step: 1, value: lo,
              'aria-label': '最低赛事等级', 'aria-valuetext': options[lo],
              style: { zIndex: 3 },
              onChange: (event) => apply(Number(event.target.value), hi),
            }),
            h('input', {
              type: 'range', min: 0, max, step: 1, value: hi,
              'aria-label': '最高赛事等级', 'aria-valuetext': options[hi],
              style: { zIndex: 2 },
              onChange: (event) => apply(lo, Number(event.target.value)),
            }),
          ),
          h('div', { className: 'qqd-ticks' },
            options.map((option, index) => h('span', {
              key: option,
              style: { left: `${percent(index)}%`, color: index >= lo && index <= hi ? C.brand : C.secondary, cursor: 'pointer' },
              onClick: () => {
                if (index < lo) apply(index, hi)
                else if (index > hi) apply(lo, index)
                else apply(index, index)
              },
            }, option)),
          ),
        ),
        h('span', { style: styles.rangeValue },
          lo === 0 && hi === max
            ? '全部'
            : lo === hi ? `${options[lo]} 级` : `${options[lo]} – ${options[hi]} 级`),
      )
    }

    function TagInput({ values, draft, placeholder, onValues, onDraft }) {
      const commit = (raw) => {
        const parts = splitTeam(raw)
        if (parts.length > 0) {
          const next = [...values]
          for (const part of parts) {
            if (!next.some((value) => value.toLowerCase() === part.toLowerCase())) next.push(part)
          }
          onValues(next)
        }
        onDraft('')
      }
      const onKeyDown = (event) => {
        if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
          event.preventDefault()
          commit(draft)
          return
        }
        if (event.key === 'Backspace' && draft === '' && values.length > 0) {
          event.preventDefault()
          onValues(values.slice(0, -1))
        }
      }
      return h('div', {
        style: styles.tagBox,
        onClick: (event) => {
          if (event.target === event.currentTarget) event.currentTarget.querySelector('input')?.focus()
        },
      },
        values.map((value) => h('span', { key: value, style: styles.tag },
          value,
          h('button', {
            type: 'button',
            style: styles.tagRemove,
            'aria-label': `移除 ${value}`,
            onClick: () => onValues(values.filter((item) => item !== value)),
          }, '×'),
        )),
        h('input', {
          style: styles.tagInput,
          value: draft,
          placeholder: values.length === 0 ? placeholder : '',
          onChange: (event) => {
            const text = event.target.value
            const cut = Math.min(...[',', '，', ';', '；'].map((sep) => text.indexOf(sep)).filter((index) => index >= 0), Infinity)
            if (Number.isFinite(cut)) {
              commit(text.slice(0, cut))
              return
            }
            onDraft(text)
          },
          onKeyDown,
          onBlur: () => commit(draft),
        }),
      )
    }

    function featureStatus(feature) {
      const result = feature.lastResult
      if (feature.lastRunAt === 0) return { text: '尚未检查', error: false }
      if (result !== null && result !== undefined && result.error) {
        return { text: `${formatRelative(feature.lastRunAt)} · 检查失败：${result.error}`, error: true }
      }
      const channel = result?.channel === 'qq' ? ' · 已直发 QQ' : result?.channel === 'session' ? ' · 写入会话' : ''
      const warning = typeof result?.warning === 'string' && result.warning !== '' ? ` · ${result.warning}` : ''
      return {
        text: `${formatRelative(feature.lastRunAt)} · 匹配 ${result?.matched ?? 0} · 发送 ${result?.sent ?? 0}${channel}${warning}`,
        error: false,
      }
    }

    function FeatureCard({ feature, sessions, open, onToggle, onSaved, onRun, onNotice }) {
      const values = feature.values ?? {}
      const [enabled, setEnabled] = useState(feature.enabled === true)
      const [teams, setTeams] = useState(Array.isArray(values.teams) ? values.teams : [])
      const [teamDraft, setTeamDraft] = useState('')
      const [tiers, setTiers] = useState(Array.isArray(values.tiers) ? values.tiers : [])
      const [sessionId, setSessionId] = useState(feature.target?.sessionId ?? '')
      const [sourceId, setSourceId] = useState(feature.source?.id ?? 'custom')
      const [baseUrl, setBaseUrl] = useState(feature.source?.baseUrl ?? '')
      const [apiKey, setApiKey] = useState('')
      const [clearKey, setClearKey] = useState(false)
      const [intervalText, setIntervalText] = useState(String(feature.intervalMinutes ?? 60))
      const [focusCard, setFocusCard] = useState(feature.focusCard !== false)
      const [scheduleMode, setScheduleMode] = useState(feature.scheduleMode === 'cron' ? 'cron' : 'interval')
      const [cron, setCron] = useState(feature.cron ?? '')
      const [busy, setBusy] = useState(false)

      /** Fold whatever is still in the tag box into the saved list. */
      const commitTeams = () => {
        const parts = splitTeam(teamDraft)
        if (parts.length === 0) return teams
        const next = [...teams]
        for (const part of parts) {
          if (!next.some((value) => value.toLowerCase() === part.toLowerCase())) next.push(part)
        }
        setTeams(next)
        setTeamDraft('')
        return next
      }

      const payload = (nextEnabled, overrides) => ({
        id: feature.id,
        enabled: nextEnabled === undefined ? enabled : nextEnabled,
        target: { sessionId },
        focusCard,
        scheduleMode,
        cron,
        source: { id: sourceId, baseUrl: baseUrl.trim() },
        ...(apiKey.trim() === '' ? {} : { credential: apiKey.trim() }),
        ...(clearKey ? { clearCredential: true } : {}),
        intervalMinutes: Number(intervalText) || 60,
        values: {
          teams: commitTeams(),
          tiers,
        },
        ...(overrides ?? {}),
      })

      const save = async (nextEnabled, overrides) => {
        setBusy(true)
        try {
          const next = await postJson(FEATURES_PATH, payload(nextEnabled, overrides))
          setApiKey('')
          setClearKey(false)
          const saved = next.features.find((item) => item.id === feature.id)
          setEnabled(saved?.enabled === true)
          setFocusCard(saved?.focusCard !== false)
          onSaved(next)
          const action = nextEnabled === undefined ? '已保存' : nextEnabled ? '已开启' : '已关闭'
          onNotice({ kind: 'ok', text: `${feature.label} ${action}` })
        } catch (failure) {
          onNotice({ kind: 'error', text: `${feature.label} 保存失败：${String(failure?.message ?? failure)}` })
        } finally {
          setBusy(false)
        }
      }

      const run = async () => {
        setBusy(true)
        try {
          const { result } = await postJson(FEATURES_RUN_PATH, { id: feature.id })
          if (result?.error) onNotice({ kind: 'error', text: `${feature.label} 检查失败：${result.error}` })
          else if (result?.skipped) onNotice({ kind: 'ok', text: `${feature.label} 未开启，未执行` })
          else onNotice({ kind: 'ok', text: `${feature.label} 检查完成：匹配 ${result?.matched ?? 0}，发送 ${result?.sent ?? 0}` })
          onRun()
        } catch (failure) {
          onNotice({ kind: 'error', text: `${feature.label} 检查失败：${String(failure?.message ?? failure)}` })
        } finally {
          setBusy(false)
        }
      }

      const status = featureStatus(feature)
      const tierOptions = feature.fields?.find((field) => field.kind === 'options')?.options ?? []

      const collapse = (event) => {
        event?.stopPropagation?.()
        onToggle()
      }

      return h('div', { style: enabled ? { ...styles.card, ...styles.cardOn } : styles.card },
        h('div', {
          style: { ...styles.cardHead, cursor: 'pointer' },
          onClick: onToggle,
          role: 'button',
          'aria-expanded': open,
          tabIndex: 0,
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onToggle()
            }
          },
        },
          h('span', { className: 'qqd-chev', style: { transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' } }, '▸'),
          h('span', { style: styles.cardTitle }, feature.label),
          feature.provider === null
            ? h('span', { style: styles.chipWarn }, feature.providerLabel)
            : h('span', { style: styles.chip }, feature.providerLabel),
          h('span', { style: styles.chip },
            feature.scheduleMode === 'cron' ? `Cron ${feature.cron || '未设置'}` : `每 ${feature.intervalMinutes ?? 60} 分钟`),
          h('div', {
            style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 },
            onClick: (event) => event.stopPropagation(),
          },
            h('span', {
              style: enabled
                ? { color: C.ok, fontSize: 12, fontWeight: 500 }
                : { color: C.secondary, fontSize: 12 },
            }, enabled ? '已开启' : '已关闭'),
            h(Switch, { checked: enabled, disabled: busy, label: `${feature.label} 开关`, onChange: (next) => { void save(next) } }),
          ),
        ),
        open ? null : h('p', { style: styles.collapsedLine }, status.text),
        open ? h('div', null,
        h('p', { style: styles.desc }, feature.description),

        h('div', { style: styles.sourceBlock },
          h('div', { style: styles.sourceHead },
            h('span', { style: styles.sourceTitle }, '数据源'),
            h('span', { style: feature.credential?.configured ? styles.chipOk : styles.chipWarn },
              feature.credential?.configured ? 'API Key 已配置' : 'API Key 未配置'),
            h('span', { style: styles.monoHint }, feature.credential?.ref ?? ''),
          ),
          h('div', { style: styles.grid },
            h('div', { style: styles.field },
              h('span', { style: styles.label }, '数据源类型'),
              h('select', {
                style: styles.select,
                value: sourceId,
                onChange: (event) => setSourceId(event.target.value),
              }, (feature.sources ?? []).map((item) => h('option', { key: item.id, value: item.id }, item.label))),
            ),
            h('div', { style: styles.field },
              h('span', { style: styles.label }, 'API Key（只写，不回显）'),
              h('div', { style: styles.keyRow },
                h('input', {
                  style: styles.input,
                  type: 'password',
                  value: apiKey,
                  placeholder: feature.credential?.configured ? '已配置，留空则不修改' : '粘贴 API Key',
                  autoComplete: 'off',
                  onChange: (event) => setApiKey(event.target.value),
                }),
                feature.credential?.configured === true
                  ? h('button', {
                    type: 'button',
                    style: styles.ghostButton,
                    onClick: () => setClearKey((current) => !current),
                  }, clearKey ? '取消' : '清除')
                  : null,
              ),
              clearKey ? h('span', { style: { color: C.warn, fontSize: 11 } }, '保存后会删除已存凭证') : null,
            ),
          ),
          h('details', { style: styles.details },
            h('summary', { style: styles.summary },
              h('span', { className: 'qqd-chev' }, '▸'),
              h('span', null, '接口地址（可选）'),
              baseUrl.trim() === '' ? null : h('span', { style: styles.summaryValue }, baseUrl.trim()),
            ),
            h('div', { style: styles.detailsBody },
              h('input', {
                style: styles.input,
                value: baseUrl,
                placeholder: 'https://…',
                disabled: sourceId === 'none',
                onChange: (event) => setBaseUrl(event.target.value),
              }),
            ),
          ),
        ),
        h('div', { style: styles.divider }),

        h('div', { style: styles.grid },
          h('div', { style: styles.field },
            h('span', { style: styles.label }, '关注队伍（回车添加，留空=全部）'),
            h(TagInput, {
              values: teams,
              draft: teamDraft,
              placeholder: '输入队名后回车',
              onValues: setTeams,
              onDraft: setTeamDraft,
            }),
          ),
          h('div', { style: styles.field },
            h('span', { style: styles.label }, '赛事等级'),
            h(TierRange, { options: tierOptions, tiers, onChange: setTiers }),
          ),
          h('div', { style: styles.field },
            h('span', { style: styles.label }, '目标会话'),
            h('select', {
              style: styles.select,
              value: sessionId,
              onChange: (event) => setSessionId(event.target.value),
            },
            h('option', { value: '' }, '选择会话…'),
            ...sessions.map((session) => h('option', { key: session.sessionId, value: session.sessionId },
              `${session.title ?? '(无标题)'} · ${session.sessionId.slice(0, 8)}`)),
            sessionId !== '' && !sessions.some((session) => session.sessionId === sessionId)
              ? h('option', { value: sessionId }, `(不在列表中) ${sessionId.slice(0, 8)}`)
              : null),
          ),
          h('div', { style: styles.field },
            h('span', { style: styles.label }, '检查频率'),
            h('div', { style: styles.segmented },
              h('button', {
                type: 'button',
                style: scheduleMode === 'interval' ? styles.segOn : styles.seg,
                onClick: () => setScheduleMode('interval'),
              }, '按间隔'),
              h('button', {
                type: 'button',
                style: scheduleMode === 'cron' ? styles.segOn : styles.seg,
                onClick: () => setScheduleMode('cron'),
              }, 'Cron'),
            ),
            scheduleMode === 'interval'
              ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h('input', {
                  style: { ...styles.input, flex: '0 1 110px' },
                  value: intervalText,
                  inputMode: 'numeric',
                  onChange: (event) => setIntervalText(event.target.value),
                }),
                h('span', { style: { color: C.secondary, fontSize: 11 } }, '分钟（15–1440）'),
              )
              : h('div', null,
                h('input', {
                  style: styles.input,
                  value: cron,
                  placeholder: '0 18-23 * * 1-5; 0 10-23 * * 0,6',
                  onChange: (event) => setCron(event.target.value),
                }),
                h('span', { style: { color: feature.cronValid === false ? C.error : C.secondary, fontSize: 11 } },
                  feature.cronValid === false
                    ? '表达式无效（分 时 日 月 周，多条用 ; 分隔）'
                    : `分 时 日 月 周 · 多条用 ; 分隔 · ${feature.timeZone ?? 'Asia/Shanghai'}`),
              ),
            feature.nextRunAt === 0 || feature.nextRunAt === undefined
              ? null
              : h('span', { style: { color: C.secondary, fontSize: 11 } },
                `下次检查：${formatAbsolute(feature.nextRunAt)}`),
          ),
        ),

        h('details', { style: styles.details },
          h('summary', { style: styles.summary },
            h('span', { className: 'qqd-chev' }, '▸'),
            h('span', null, '高级'),
          ),
          h('div', { style: styles.detailsBody },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h(Switch, {
                checked: focusCard,
                disabled: busy,
                label: '焦点战卡片',
                onChange: (next) => {
                  setFocusCard(next)
                  void save(undefined, { focusCard: next })
                },
              }),
              h('span', { style: { color: C.secondary, fontSize: 11.5 } }, '为 24 小时内的焦点战单独发一张带图卡片'),
            ),
          ),
        ),

        h('div', { style: styles.cardFoot },
          h('button', {
            type: 'button',
            style: { ...styles.primaryButton, ...(busy ? styles.disabledButton : {}) },
            disabled: busy,
            onClick: () => { void save() },
          }, busy ? '处理中…' : '保存'),
          h('button', {
            type: 'button',
            style: { ...styles.ghostButton, ...(busy ? styles.disabledButton : {}) },
            disabled: busy,
            onClick: () => { void run() },
          }, '立即检查'),
          h('span', { style: status.error ? styles.statusError : styles.statusLine }, status.text),
        ),
        ) : null,
      )
    }

    function DispatchSessionsPage() {
      const [snapshot, setSnapshot] = useState(null)
      const [features, setFeatures] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState(null)
      const [tab, setTab] = useState('sessions')
      const [openFeatureId, setOpenFeatureId] = useState(null)
      const [refreshing, setRefreshing] = useState(false)
      const [rowBusy, setRowBusy] = useState('')
      const [binding, setBinding] = useState(null)
      const autoOpened = useRef(false)

      const load = useCallback(async () => {
        setLoading(true)
        setError('')
        try {
          const [sessions, featureData] = await Promise.all([
            readJson(SESSIONS_PATH),
            readJson(FEATURES_PATH).catch(() => null),
          ])
          setSnapshot(sessions)
          if (featureData !== null) setFeatures(featureData)
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setLoading(false)
        }
      }, [])

      const refreshFeatures = useCallback(async () => {
        try {
          setFeatures(await readJson(FEATURES_PATH))
        } catch {
          /* keep the last snapshot */
        }
      }, [])

      /**
       * 刷新：先让宿主去 QQ 平台取每个群的群名并改会话标题，再重读列表。
       * 标题没变的群不会重复写，失败只影响那一个群。
       */
      const refreshTitles = useCallback(async () => {
        setRefreshing(true)
        try {
          const body = await postJson(TITLES_PATH, {})
          await load()
          const updated = body?.updated ?? 0
          const skipped = body?.skipped ?? 0
          const failed = body?.failed ?? 0
          setNotice({
            kind: failed > 0 ? 'error' : 'ok',
            text: failed > 0
              ? `群名刷新完成：更新 ${updated} 个，未变 ${skipped} 个，失败 ${failed} 个`
              : `群名已同步：更新 ${updated} 个，未变 ${skipped} 个`,
          })
        } catch (failure) {
          setNotice({ kind: 'error', text: `刷新群名失败：${String(failure?.message ?? failure)}` })
        } finally {
          setRefreshing(false)
        }
      }, [load])

      /**
       * 单行「刷新群名」：走的就是让某一行显示成「群名 · 11 人」的那条路——
       * GET /group-info?openid=…&fresh=1&sessionId=…，宿主顺手把群名写进会话标题。
       */
      const refreshRow = useCallback(async (row) => {
        if (row?.groupOpenid === undefined) return
        setRowBusy(row.sessionId)
        try {
          const body = await readJson(`${GROUP_INFO_PATH}?openid=${encodeURIComponent(row.groupOpenid)}&fresh=1&sessionId=${encodeURIComponent(row.sessionId)}`)
          await load()
          const name = body?.info?.group_name ?? row.groupName ?? ''
          const num = body?.info?.group_member_num
          setNotice({ kind: 'ok', text: `已同步：${name}${typeof num === 'number' && num > 0 ? ` · ${num} 人` : ''}` })
        } catch (failure) {
          setNotice({ kind: 'error', text: `同步群信息失败：${String(failure?.message ?? failure)}` })
        } finally {
          setRowBusy('')
        }
      }, [load])

      /** 绑定群：给还没有 openid 的会话补一次，成功后这一行就跟别的一样有群名和人数。 */
      const submitBinding = useCallback(async () => {
        const sessionId = binding?.sessionId
        const openid = (binding?.value ?? '').trim()
        if (typeof sessionId !== 'string') return
        if (!/^[0-9A-Za-z_-]{8,64}$/.test(openid)) {
          setNotice({ kind: 'error', text: 'group_openid 看起来不对：应为 8~64 位字母/数字' })
          return
        }
        setRowBusy(sessionId)
        try {
          const body = await readJson(`${GROUP_INFO_PATH}?openid=${encodeURIComponent(openid)}&fresh=1&sessionId=${encodeURIComponent(sessionId)}`)
          setBinding(null)
          await load()
          const name = body?.info?.group_name ?? ''
          setNotice({ kind: 'ok', text: `已绑定并同步：${name}` })
        } catch (failure) {
          setNotice({ kind: 'error', text: `绑定失败：${String(failure?.message ?? failure)}` })
        } finally {
          setRowBusy('')
        }
      }, [binding, load])

      useEffect(() => {
        load()
      }, [load])

      // Open the first feature exactly once; a later collapse must stay collapsed.
      useEffect(() => {
        if (autoOpened.current) return
        const first = features?.features?.[0]
        if (first === undefined) return
        autoOpened.current = true
        setOpenFeatureId((current) => current ?? first.id)
      }, [features])

      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => setNotice(null), 4000)
        return () => clearTimeout(timer)
      }, [notice])

      const sessions = snapshot?.sessions ?? []
      const entries = snapshot?.entries ?? []

      return h('div', { style: styles.page },
        h('style', null, [
          '.qqd-row:hover { background: var(--dsw-alias-bg-layer-2); }',
          '.qqd-row > td { transition: background .12s ease; }',
          '.qqd-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }',
          '.qqd-tab:hover { color: var(--dsw-alias-label-primary); }',
          '.qqd-tab-active:hover { color: var(--dsw-alias-brand-primary); }',
          '.qqd-slider { position: relative; flex: 1 1 auto; min-width: 120px; }',
          '.qqd-range { position: relative; height: 26px; }',
          '.qqd-range::before { content: ""; position: absolute; left: 0; right: 0; top: 12px; height: 2px; border-radius: 2px; background: var(--dsw-alias-border-l2); }',
          '.qqd-range-fill { position: absolute; top: 12px; height: 2px; border-radius: 2px; background: var(--dsw-alias-brand-primary); }',
          '.qqd-range input[type="range"] { position: absolute; left: -8px; width: calc(100% + 16px); height: 26px; margin: 0; background: transparent; -webkit-appearance: none; appearance: none; pointer-events: none; }',
          '.qqd-range input[type="range"]:focus { outline: none; }',
          '.qqd-range input[type="range"]:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 35%, transparent); }',
          '.qqd-range input[type="range"]::-webkit-slider-runnable-track { height: 26px; background: transparent; }',
          '.qqd-range input[type="range"]::-webkit-slider-thumb { pointer-events: auto; -webkit-appearance: none; width: 16px; height: 16px; margin-top: 5px; border-radius: 50%; background: var(--dsw-alias-brand-primary); border: 2px solid var(--dsw-alias-bg-base); box-shadow: 0 1px 3px rgba(0,0,0,0.35); cursor: grab; }',
          '.qqd-range input[type="range"]::-moz-range-track { height: 26px; background: transparent; }',
          '.qqd-range input[type="range"]::-moz-range-thumb { pointer-events: auto; width: 12px; height: 12px; border-radius: 50%; background: var(--dsw-alias-brand-primary); border: 2px solid var(--dsw-alias-bg-base); box-shadow: 0 1px 3px rgba(0,0,0,0.35); cursor: grab; }',
          '.qqd-ticks { position: relative; height: 14px; margin-top: 2px; font-size: 11px; }',
          '.qqd-ticks span { position: absolute; transform: translateX(-50%); }',
          '@keyframes qqd-toast-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }',
          'summary::-webkit-details-marker { display: none; }',
          '.qqd-chev { display: inline-block; transition: transform .15s ease; font-size: 10px; }',
          'details[open] .qqd-chev { transform: rotate(90deg); }',
        ].join('\n')),
        h('div', { style: styles.inner },
          h('div', { style: styles.header },
            h('div', { style: styles.headerText },
              h('h1', { style: styles.title }, 'QQ 会话'),
              h('p', { style: styles.subtitle }, 'dsh-qqbot 建过的群聊/私聊会话，以及下发功能的开关。'),
            ),
            h('button', {
              type: 'button',
              style: { ...styles.ghostButton, ...(loading || refreshing ? styles.disabledButton : {}) },
              disabled: loading || refreshing,
              title: '向 QQ 平台取每个群的群名，并把它写成会话标题',
              onClick: () => {
                void refreshTitles()
              },
            }, refreshing ? '刷新中…' : loading ? '读取中…' : '刷新'),
          ),

          notice === null ? null : h('div', {
            style: { ...styles.toast, ...(notice.kind === 'error' ? styles.toastError : styles.toastOk) },
            role: 'status',
            'aria-live': 'polite',
          },
          h('span', { style: { flex: '1 1 auto' } }, notice.text),
          h('button', { type: 'button', style: styles.toastClose, 'aria-label': '关闭提示', onClick: () => setNotice(null) }, '×'),
          ),
          error === '' ? null : h('p', { style: styles.errorText }, `加载失败：${error}`),
          snapshot?.warning === undefined ? null : h('p', { style: styles.warnText }, `读取会话失败：${snapshot.warning}`),

          h('div', { style: styles.tabs },
            h('button', {
              type: 'button',
              className: tab === 'sessions' ? 'qqd-tab qqd-tab-active' : 'qqd-tab',
              style: tab === 'sessions' ? styles.tabActive : styles.tab,
              onClick: () => setTab('sessions'),
            }, `会话 ${sessions.length}`),
            h('button', {
              type: 'button',
              className: tab === 'features' ? 'qqd-tab qqd-tab-active' : 'qqd-tab',
              style: tab === 'features' ? styles.tabActive : styles.tab,
              onClick: () => setTab('features'),
            }, `功能 ${features?.features.length ?? 0}`),
          ),

          tab !== 'sessions' ? null : h('div', null,
            h(Section, { title: '已有 QQ 会话', meta: `${sessions.length} 个` },
              sessions.length === 0
                ? h('div', { style: styles.empty },
                  loading ? '读取中…' : '还没有 qqbot 创建过的会话，群里或私聊来一条消息后这里会出现。')
                : h('div', { style: styles.panel }, h(SessionTable, {
                  rows: sessions,
                  binding,
                  rowBusy,
                  onRefresh: refreshRow,
                  onBindStart: (sessionId) => setBinding({ sessionId, value: '' }),
                  onBindChange: (value) => setBinding((current) => (current === null ? null : { ...current, value })),
                  onBindSubmit: submitBinding,
                  onBindCancel: () => setBinding(null),
                })),
            ),
            entries.length === 0 ? null : h(Section, { title: '已记录的 peer 映射', meta: `${entries.length} 条` },
              h('div', { style: styles.panel }, h(PeerTable, { rows: entries })),
            ),
          ),

          tab !== 'features' ? null : h('div', null,
            h(Section, { title: '功能', meta: features === null ? '' : `${features.features.length} 项` },
              h('p', { style: { ...styles.desc, marginTop: 0, marginBottom: 10 } },
                '开关与配置保存在状态文件中。数据源尚未接入时，「立即检查」只会报告未接入，不会外发。'),
              features === null
                ? h('div', { style: styles.empty }, loading ? '读取中…' : '功能接口不可用（宿主未提供）')
                : features.features.map((feature) => h(FeatureCard, {
                  key: feature.id,
                  feature,
                  sessions,
                  open: openFeatureId === feature.id,
                  onToggle: () => setOpenFeatureId(openFeatureId === feature.id ? null : feature.id),
                  onSaved: (next) => setFeatures(next),
                  onRun: () => { void refreshFeatures() },
                  onNotice: setNotice,
                })),
            ),
          ),

          h('div', { style: styles.footer },
            h('div', null, '活跃 = 进程内有 Agent，回复能推回 QQ；休眠 = 进程内没有 Agent，可下发但不会回 QQ（收到 QQ 消息后会自动恢复）。'),
            h('div', null, 'qqbot 不落盘群/私聊 openid，所以会话只按标题和 sessionId 展示；「刷新」会对已知 openid 的群拉一次群信息，并把群名写成会话标题。'),
            snapshot === null ? null : h('div', { style: styles.footerRow },
              h('span', null, `appId ${snapshot.appId}`),
              h('span', null, `mode ${snapshot.defaultMode}`),
              h('span', { style: styles.mono }, snapshot.prefsPath),
            ),
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'qqbot-dispatch',
          order: 20,
          label: 'QQ 会话',
        }, PanelIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'qqbot-dispatch',
        }, DispatchSessionsPage))
      },
    }
  },
})
