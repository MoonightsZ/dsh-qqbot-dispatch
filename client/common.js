export function createCommon({ h, C, styles }) {
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
      : '进程内没有 Agent（休眠）；赛事通知的服务回合会尝试恢复 Agent 并主动推送到 QQ',
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


return { readJson, postJson, formatRelative, formatAbsolute, PanelIcon, Switch, StatusPill, Section }
}
