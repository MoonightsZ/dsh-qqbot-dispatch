import React from 'react'
import { C, styles } from './theme.js'
import { createCommon } from './common.js'
import { createSessionTables } from './tables.js'
import { createFeatureNavigation } from './feature-navigation.js'
import { createFeatureCard } from '../modules/cs2-matches/card.js'
import { createChatCard } from '../modules/casual-chat/card.js'
import { createExtensionCard } from './extension-card.js'
import { createGlobalTargetSettings } from './global-target-settings.js'

const h = React.createElement
const { useCallback, useEffect, useRef, useState } = React
const SESSIONS_PATH = '/qqbot-tool-dispatch/sessions'
const GROUP_INFO_PATH = '/qqbot-tool-dispatch/group-info'
const FEATURES_PATH = '/qqbot-tool-dispatch/features'
const SETTINGS_PATH = '/qqbot-tool-dispatch/settings'
const FEATURES_RUN_PATH = '/qqbot-tool-dispatch/features/run'
const TOPIC_MODELS_PATH = '/qqbot-tool-dispatch/chat/models'
const TOPIC_RECOMMEND_PATH = '/qqbot-tool-dispatch/chat/recommend'
const { readJson, postJson, formatRelative, formatAbsolute, PanelIcon, Switch, StatusPill, Section } = createCommon({ h, C, styles })
const { SessionTable } = createSessionTables({ h, C, styles, formatRelative, formatAbsolute, StatusPill })
const FeatureNavigation = createFeatureNavigation({ h, styles })
const FeatureCard = createFeatureCard({ React, h, C, styles, formatRelative, formatAbsolute, readJson, postJson, FEATURES_PATH, FEATURES_RUN_PATH, Switch, Section })
const ChatCard = createChatCard({ React, h, C, styles, formatRelative, readJson, postJson, FEATURES_PATH, FEATURES_RUN_PATH, TOPIC_MODELS_PATH, TOPIC_RECOMMEND_PATH, Switch })
const ExtensionCard = createExtensionCard({ React, h, styles, postJson, FEATURES_PATH, FEATURES_RUN_PATH, Switch })
const GlobalTargetSettings = createGlobalTargetSettings({ React, h, styles, postJson, SETTINGS_PATH })

function DispatchSessionsPage() {
  const [snapshot, setSnapshot] = useState(null)
  const [features, setFeatures] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const [tab, setTab] = useState('sessions')
  const [selectedFeatureId, setSelectedFeatureId] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [rowBusy, setRowBusy] = useState('')
  const [settingsBusy, setSettingsBusy] = useState(false)
  const sessionRequestId = useRef(0)

  const refreshSessions = useCallback(async (showLoading = false) => {
    const requestId = ++sessionRequestId.current
    if (showLoading) setSessionLoading(true)
    try {
      const next = await readJson(SESSIONS_PATH)
      if (requestId === sessionRequestId.current) {
        setSnapshot((previous) => next.warning && previous ? { ...next, sessions: previous.sessions } : next)
        setError('')
      }
    } catch (failure) {
      if (requestId === sessionRequestId.current) setError(String(failure?.message ?? failure))
    } finally {
      if (showLoading) setSessionLoading(false)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    await Promise.all([refreshSessions(), readJson(FEATURES_PATH).then(setFeatures).catch(() => {})])
    setLoading(false)
  }, [refreshSessions])

  const refreshFeatures = useCallback(async () => {
    try {
      setFeatures(await readJson(FEATURES_PATH))
    } catch {
      /* keep the last snapshot */
    }
  }, [])

  const saveDeliveryMethod = async (deliveryMethod) => {
    setSettingsBusy(true)
    try {
      const result = await postJson(SETTINGS_PATH, { deliveryMethod })
      setFeatures((previous) => previous === null ? previous : { ...previous, settings: result.settings })
      setNotice({ kind: 'ok', text: '全局投递方式已保存' })
    } catch (failure) {
      setNotice({ kind: 'error', text: `保存投递方式失败：${String(failure?.message ?? failure)}` })
    } finally {
      setSettingsBusy(false)
    }
  }

  /**
   * 单行「刷新群名」：走的就是让某一行显示成「群名 · 11 人」的那条路——
   * GET /group-info?openid=…&fresh=1&sessionId=…，宿主顺手把群名写进会话标题。
   */
  const refreshRow = useCallback(async (row) => {
    if (row?.groupOpenid === undefined) return
    setRowBusy(row.sessionId)
    try {
      const body = await readJson(`${GROUP_INFO_PATH}?openid=${encodeURIComponent(row.groupOpenid)}&fresh=1&sessionId=${encodeURIComponent(row.sessionId)}`)
      await refreshSessions()
      const name = body?.info?.group_name ?? row.groupName ?? ''
      const num = body?.info?.group_member_num
      setNotice({ kind: 'ok', text: `已同步：${name}${typeof num === 'number' && num > 0 ? ` · ${num} 人` : ''}` })
    } catch (failure) {
      await refreshSessions()
      setNotice({ kind: 'error', text: `同步群信息失败：${String(failure?.message ?? failure)}` })
    } finally {
      setRowBusy('')
    }
  }, [refreshSessions])

  const copyOpenid = useCallback(async (openid) => {
    try {
      if (!openid || !globalThis.navigator?.clipboard?.writeText) throw new Error('当前页面不支持剪贴板写入')
      await globalThis.navigator.clipboard.writeText(openid)
      setNotice({ kind: 'ok', text: 'OpenID 已复制' })
    } catch (failure) {
      setNotice({ kind: 'error', text: `复制 OpenID 失败：${String(failure?.message ?? failure)}` })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshSessions()
    }
    const interval = setInterval(refreshWhenVisible, 20_000)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
      sessionRequestId.current += 1
    }
  }, [refreshSessions])

  useEffect(() => {
    if (notice === null) return undefined
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  const sessions = snapshot?.sessions ?? []
  const activeFeatureId = features?.features.some((feature) => feature.id === selectedFeatureId)
    ? selectedFeatureId
    : features?.features[0]?.id

  return h('div', { className: 'qqd-page', style: styles.page },
    h('style', null, [
      '.qqd-page * { box-sizing: border-box; }',
      '.qqd-page :is(button, input, select, textarea, summary):focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }',
      '.qqd-page :is(button, input, select, textarea) { font-family: inherit; }',
      '.qqd-page :is(button, input, select, textarea):disabled { opacity: .55; cursor: not-allowed; }',
      '.qqd-page :is(input, select, textarea):focus-visible { border-color: var(--dsw-alias-brand-primary); }',
      '.qqd-page option { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }',
      'body[data-ds-dark-theme] .qqd-page { color-scheme: dark; }',
      '.qqd-page .qqd-tab:hover:not(.qqd-tab-active), .qqd-page .qqd-feature-nav-item:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      '.qqd-page .qqd-btn:hover:not(:disabled), .qqd-page .qqd-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }',
      '.qqd-page button:active:not(:disabled) { transform: translateY(1px); }',
      '.qqd-row:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.qqd-row > td { transition: background .12s ease; }',
      '.qqd-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }',
      '.qqd-feature-layout { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 16px; align-items: start; }',
      '.qqd-feature-nav { display: flex; flex-direction: column; gap: 4px; position: sticky; top: 12px; min-width: 0; }',
      '.qqd-feature-nav-item:hover { background: var(--dsw-alias-bg-layer-2) !important; }',
      '.qqd-feature-nav-item:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }',
      '@container (max-width: 700px) { .qqd-feature-layout { grid-template-columns: minmax(0, 1fr); } .qqd-feature-nav { position: static; flex-direction: row; overflow-x: auto; padding-bottom: 4px; } .qqd-feature-nav-item { min-width: 140px; width: auto !important; flex: 0 0 auto; } }',
      '.qqd-session-shell { container-type: inline-size; }',
      '@container (max-width: 640px) { .qqd-session-table, .qqd-session-table tbody, .qqd-session-table tr { display: block; width: 100%; } .qqd-session-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); } .qqd-session-table tr { padding: 11px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); } .qqd-session-table tr:last-child { border-bottom: 0; } .qqd-session-table td { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 5px 0 !important; border: 0 !important; text-align: right !important; white-space: normal !important; } .qqd-session-table td:first-child { display: block; padding-bottom: 9px !important; text-align: left !important; } .qqd-session-table td:not(:first-child)::before { content: attr(data-label); color: var(--dsw-alias-label-secondary); font-size: 11px; flex: none; } }',
      '@container (max-width: 720px) { .qqd-page-head { flex-wrap: wrap; } .qqd-head-actions { width: 100%; flex-wrap: wrap; } .qqd-head-actions > button { flex: 1 1 auto; } .qqd-tabs { overflow-x: auto; } .qqd-settings-head { align-items: flex-start; } }',
      '@media (prefers-reduced-motion: reduce) { .qqd-page *, .qqd-page *::before, .qqd-page *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }',
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
      h('div', { className: 'qqd-page-head', style: styles.header },
        h('div', { style: styles.headerText },
          h('span', { style: styles.eyebrow }, 'QQ BOT · 通知与会话'),
          h('h1', { style: styles.title }, 'QQ 机器人 · 通知助手'),
          h('p', { style: styles.subtitle }, '向 QQ 会话下发任务，管理可自定义的功能模组。'),
        ),
        h('div', { className: 'qqd-head-actions', style: { display: 'flex', gap: 8 } }, h('button', {
          type: 'button',
          className: 'qqd-ghost',
          style: { ...styles.ghostButton, ...(sessionLoading ? styles.disabledButton : {}) },
          disabled: sessionLoading,
          title: '重新读取本地 QQ 会话列表',
          onClick: () => { void refreshSessions(true) },
        }, sessionLoading ? '读取中…' : '刷新会话')),
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

      h('nav', { className: 'qqd-tabs', style: styles.tabs, 'aria-label': '通知助手页面' },
        h('button', {
          type: 'button',
          'aria-current': tab === 'sessions' ? 'page' : undefined,
          className: tab === 'sessions' ? 'qqd-tab qqd-tab-active' : 'qqd-tab',
          style: tab === 'sessions' ? styles.tabActive : styles.tab,
          onClick: () => setTab('sessions'),
        }, `会话 ${sessions.length}`),
        h('button', {
          type: 'button',
          'aria-current': tab === 'features' ? 'page' : undefined,
          className: tab === 'features' ? 'qqd-tab qqd-tab-active' : 'qqd-tab',
          style: tab === 'features' ? styles.tabActive : styles.tab,
          onClick: () => { setTab('features'); void refreshSessions() },
        }, `功能 ${features?.features.length ?? 0}`),
        h('button', {
          type: 'button',
          'aria-current': tab === 'settings' ? 'page' : undefined,
          className: tab === 'settings' ? 'qqd-tab qqd-tab-active' : 'qqd-tab',
          style: tab === 'settings' ? styles.tabActive : styles.tab,
          onClick: () => setTab('settings'),
        }, '配置'),
      ),

      tab !== 'sessions' ? null : h('div', null,
        h(Section, { title: '已有 QQ 会话', meta: `${sessions.length} 个` },
          sessions.length === 0
            ? h('div', { style: styles.empty },
              loading ? '读取中…' : '还没有 qqbot 创建过的会话，群里或私聊来一条消息后这里会出现。')
            : h('div', { className: 'qqd-session-shell', style: styles.panel }, h(SessionTable, {
              rows: sessions,
              rowBusy,
              onRefresh: refreshRow,
              onCopy: copyOpenid,
            })),
        ),
      ),

      tab !== 'features' ? null : h('div', null,
        h(Section, { title: '功能模组', meta: features === null ? '' : `${features.features.filter((feature) => feature.enabled).length} / ${features.features.length} 已启用` },
          h('p', { style: { ...styles.desc, marginTop: 0, marginBottom: 10 } },
            '各模组独立保存开关与配置；通知投递方式由「配置」页统一控制。'),
          features === null
            ? h('div', { style: styles.empty }, loading ? '读取中…' : '功能接口不可用（宿主未提供）')
            : h('div', { style: { containerType: 'inline-size' } }, h('div', { className: 'qqd-feature-layout' },
              h(FeatureNavigation, { features: features.features, selectedId: activeFeatureId, onSelect: setSelectedFeatureId }),
              h('div', { style: { minWidth: 0 } },
                ...features.features.map((feature) => h('div', { key: feature.id, hidden: activeFeatureId !== feature.id },
                  h(feature.extension ? ExtensionCard : feature.id === 'casual-chat' ? ChatCard : FeatureCard, {
                    feature,
                    settings: features.settings,
                    sessions,
                    onRefreshSessions: refreshSessions,
                    open: true,
                    navigationMode: true,
                    onToggle: () => {},
                    onSaved: (next) => setFeatures(next),
                    onRun: () => { void refreshFeatures() },
                    onNotice: setNotice,
                  }))),
              ),
            )),
        ),
      ),

      tab !== 'settings' ? null : h('div', null,
        h(Section, { title: '全局默认目标会话', meta: '未单独指定目标的模组会继承' },
          features === null
            ? h('div', { style: styles.empty }, loading ? '读取中…' : '配置接口不可用')
            : h(GlobalTargetSettings, {
              key: JSON.stringify(features.settings?.defaultTargetSessionIds ?? []),
              settings: features.settings,
              features: features.features,
              sessions,
              onRefreshSessions: refreshSessions,
              onSaved: (settings) => setFeatures((previous) => previous === null ? previous : { ...previous, settings }),
              onNotice: setNotice,
            }),
        ),
        h(Section, { title: '全局通知投递', meta: '适用于所有模组' },
          features === null
            ? h('div', { style: styles.empty }, loading ? '读取中…' : '配置接口不可用')
            : h('div', { style: { ...styles.panel, padding: '18px 20px' } },
              h('div', { className: 'qqd-settings-head', style: { display: 'flex', alignItems: 'center', gap: 16 } },
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('strong', { style: styles.settingsTitle }, features.settings?.deliveryMethod === 'upstream-sdk' ? '直接发送 Markdown' : '服务回合投递'),
                  h('p', { style: styles.desc }, features.settings?.deliveryMethod === 'upstream-sdk'
                    ? '由 QQ Bot 直接发送模组提供的文字；不经过 Agent 润色。'
                    : '由目标会话的 Agent 处理通知，适合需要结合上下文生成内容的模组。'),
                ),
                h(Switch, {
                  checked: features.settings?.deliveryMethod === 'upstream-sdk',
                  disabled: settingsBusy,
                  label: '切换直接发送 Markdown',
                  onChange: (enabled) => { void saveDeliveryMethod(enabled ? 'upstream-sdk' : 'service-turn') },
                }),
              ),
              h('div', { style: features.settings?.deliveryMethod === 'upstream-sdk' ? styles.warningCallout : styles.note },
                features.settings?.deliveryMethod === 'upstream-sdk'
                  ? '启动或重启后，先让 QQ Bot 收到一条消息再直接发送。CS2 焦点分析在此模式下不生效。'
                  : 'CS2 可选择固定赛事内容或 AI 焦点分析；偶尔闲聊会结合会话上下文生成开场白。'),
            ),
        ),
      ),

      h('div', { style: styles.footer },
        '“活跃”表示 Agent 当前在运行；“休眠”表示可在需要时恢复。实际送达仍受 QQ 平台限制。',
      ),
    ),
  )
}


export const inject = ['slots']
export function apply(ctx) {
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: 'qqbot-dispatch',
    order: 20,
    label: 'QQ 机器人 · 通知助手',
  }, PanelIcon))
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: 'qqbot-dispatch',
  }, DispatchSessionsPage))
}
