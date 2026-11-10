import React from 'react'
import { C, styles } from './theme.js'
import { createCommon } from './common.js'
import { createSessionTables } from './tables.js'
import { createFeatureNavigation } from './feature-navigation.js'
import { createFeatureCard } from '../modules/cs2-matches/card.js'
import { createChatCard } from '../modules/casual-chat/card.js'
import { createExtensionCard } from './extension-card.js'

const h = React.createElement
const { useCallback, useEffect, useRef, useState } = React
const SESSIONS_PATH = '/qqbot-tool-dispatch/sessions'
const TITLES_PATH = '/qqbot-tool-dispatch/titles/refresh'
const GROUP_INFO_PATH = '/qqbot-tool-dispatch/group-info'
const FEATURES_PATH = '/qqbot-tool-dispatch/features'
const SETTINGS_PATH = '/qqbot-tool-dispatch/settings'
const FEATURES_RUN_PATH = '/qqbot-tool-dispatch/features/run'
const { readJson, postJson, formatRelative, formatAbsolute, PanelIcon, Switch, StatusPill, Section } = createCommon({ h, C, styles })
const { SessionTable } = createSessionTables({ h, C, styles, formatRelative, formatAbsolute, StatusPill })
const FeatureNavigation = createFeatureNavigation({ h, styles })
const FeatureCard = createFeatureCard({ React, h, C, styles, formatRelative, formatAbsolute, readJson, postJson, FEATURES_PATH, FEATURES_RUN_PATH, Switch, Section })
const ChatCard = createChatCard({ React, h, C, styles, formatRelative, postJson, FEATURES_PATH, FEATURES_RUN_PATH, Switch })
const ExtensionCard = createExtensionCard({ React, h, styles, postJson, FEATURES_PATH, FEATURES_RUN_PATH, Switch })

function DispatchSessionsPage() {
  const [snapshot, setSnapshot] = useState(null)
  const [features, setFeatures] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null)
  const [tab, setTab] = useState('sessions')
  const [selectedFeatureId, setSelectedFeatureId] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
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
   * 刷新：先让宿主去 QQ 平台取每个群的群名并改会话标题，再重读列表。
   * 标题没变的群不会重复写，失败只影响那一个群。
   */
  const refreshTitles = useCallback(async () => {
    setRefreshing(true)
    try {
      const body = await postJson(TITLES_PATH, {})
      await refreshSessions()
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
  }, [refreshSessions])

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

  return h('div', { style: styles.page },
    h('style', null, [
      '.qqd-row:hover { background: var(--dsw-alias-bg-layer-2); }',
      '.qqd-row > td { transition: background .12s ease; }',
      '.qqd-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }',
      '.qqd-tab:hover { color: var(--dsw-alias-label-primary); }',
      '.qqd-tab-active:hover { color: var(--dsw-alias-brand-primary); }',
      '.qqd-feature-layout { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 16px; align-items: start; }',
      '.qqd-feature-nav { display: flex; flex-direction: column; gap: 4px; position: sticky; top: 12px; min-width: 0; }',
      '.qqd-feature-nav-item:hover { background: var(--dsw-alias-bg-layer-2) !important; }',
      '.qqd-feature-nav-item:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }',
      '@container (max-width: 700px) { .qqd-feature-layout { grid-template-columns: minmax(0, 1fr); } .qqd-feature-nav { position: static; flex-direction: row; overflow-x: auto; padding-bottom: 4px; } .qqd-feature-nav-item { min-width: 140px; width: auto !important; flex: 0 0 auto; } }',
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
          h('h1', { style: styles.title }, 'QQ 机器人 · 通知助手'),
          h('p', { style: styles.subtitle }, '基于 QQ 机器人管理群聊、私聊会话与赛事通知。'),
        ),
        h('div', { style: { display: 'flex', gap: 8 } }, h('button', {
          type: 'button',
          style: { ...styles.ghostButton, ...(sessionLoading ? styles.disabledButton : {}) },
          disabled: sessionLoading,
          title: '重新读取本地 QQ 会话列表',
          onClick: () => { void refreshSessions(true) },
        }, sessionLoading ? '读取中…' : '刷新会话'), h('button', {
          type: 'button',
          style: { ...styles.ghostButton, ...(refreshing ? styles.disabledButton : {}) },
          disabled: refreshing,
          title: '向 QQ 平台取每个群的群名，并把它写成会话标题',
          onClick: () => {
            void refreshTitles()
          },
        }, refreshing ? '同步中…' : '同步群名')),
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
          onClick: () => { setTab('features'); void refreshSessions() },
        }, `功能 ${features?.features.length ?? 0}`),
        h('button', {
          type: 'button',
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
            : h('div', { style: styles.panel }, h(SessionTable, {
              rows: sessions,
              rowBusy,
              onRefresh: refreshRow,
            })),
        ),
      ),

      tab !== 'features' ? null : h('div', null,
        h(Section, { title: '功能', meta: features === null ? '' : `${features.features.length} 项` },
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

      tab !== 'settings' ? null : h(Section, { title: '全局通知投递' },
        features === null
          ? h('div', { style: styles.empty }, loading ? '读取中…' : '配置接口不可用')
          : h('div', { style: styles.panel, padding: '16px 18px' },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
              h(Switch, {
                checked: features.settings?.deliveryMethod === 'upstream-sdk',
                disabled: settingsBusy,
                label: '直接调用上游 QQ Bot 发送 Markdown',
                onChange: (enabled) => { void saveDeliveryMethod(enabled ? 'upstream-sdk' : 'service-turn') },
              }),
              h('strong', null, features.settings?.deliveryMethod === 'upstream-sdk' ? '参考方式：直接发送 Markdown' : '现有方式：服务回合投递'),
            ),
            h('p', { style: styles.desc }, '关闭：所有模组通过服务回合让 Agent 生成 QQ 回复。开启：捕获上游 QQ Bot 实例并调用 sendMarkdown；CS2 发送固定赛事正文，偶尔闲聊直接发送选中的话题。'),
            h('p', { style: styles.warnText }, '直接发送模式需先在 QQ 会话收到消息以取得 Bot 实例；无法取得时会报错且不会记录为已发送。该模式不生成 CS2 焦点分析，QQ 送达仍受平台限制。'),
          ),
      ),

      h('div', { style: styles.footer },
        h('div', null, '活跃 = 进程内有 Agent；休眠 = 进程内没有 Agent。通知按「配置」页选择的全局方式投递，实际送达受 QQ 平台限制。'),
        h('div', null, '会话来自 QQ Bot 当前的 peer 映射；刷新会话只读取本地数据，同步群名会请求 QQ 平台并更新会话标题。'),
        snapshot === null ? null : h('div', { style: styles.footerRow },
          h('span', null, `appId ${snapshot.appId}`),
          h('span', null, `mode ${snapshot.defaultMode}`),
          h('span', { style: styles.mono }, snapshot.prefsPath),
        ),
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
