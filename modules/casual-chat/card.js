import { cronRules, formatZonedTime } from '../../cron.js'
import { sessionTargetOptions } from '../../client/session-options.js'

export function createChatCard({ React, h, C, styles, formatRelative, postJson, FEATURES_PATH, FEATURES_RUN_PATH, Switch }) {
  const { useState } = React

  function ChatCard({ feature, settings, sessions, open, navigationMode = false, onToggle, onSaved, onRun, onNotice, onRefreshSessions }) {
    const values = feature.values ?? {}
    const [enabled, setEnabled] = useState(feature.enabled === true)
    const [sessionId, setSessionId] = useState(feature.target?.sessionId ?? '')
    const [checkTime, setCheckTime] = useState((() => {
      const [minute, hour] = (cronRules(feature.cron)[0] ?? '0 19 * * *').split(' ')
      return `${String(hour ?? '19').padStart(2, '0')}:${String(minute ?? '0').padStart(2, '0')}`
    })())
    const [chancePercent, setChancePercent] = useState(String(values.chancePercent ?? '30'))
    const [cooldownHours, setCooldownHours] = useState(String(values.cooldownHours ?? '72'))
    const [quietStart, setQuietStart] = useState(String(values.quietStart ?? '22'))
    const [quietEnd, setQuietEnd] = useState(String(values.quietEnd ?? '9'))
    const [topics, setTopics] = useState(String(values.topics ?? ''))
    const [busy, setBusy] = useState(false)
    const targetOptions = sessionTargetOptions(sessions, sessionId)

    const payload = (nextEnabled) => {
      const [hour, minute] = checkTime.split(':').map(Number)
      return {
        id: feature.id,
        enabled: nextEnabled ?? enabled,
        target: { sessionId },
        source: { id: 'none', baseUrl: '' },
        scheduleMode: 'cron',
        cron: [`${minute} ${hour} * * *`],
        timeZone: feature.timeZone ?? 'Asia/Shanghai',
        values: { chancePercent, cooldownHours, quietStart, quietEnd, topics },
      }
    }

    const persist = async (nextEnabled) => {
      if (nextEnabled !== false && targetOptions.invalidSelected) throw new Error(targetOptions.unavailableSelected ? '目标群不可用，请先同步群名确认' : '目标会话已失效，请重新选择')
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(checkTime)) throw new Error('每日检查时间无效')
      const next = await postJson(FEATURES_PATH, payload(nextEnabled))
      setEnabled(next.features.find((entry) => entry.id === feature.id)?.enabled === true)
      onSaved(next)
      return next
    }

    const save = async (nextEnabled) => {
      setBusy(true)
      try {
        await persist(nextEnabled)
        onNotice({ kind: 'ok', text: `${feature.label} ${nextEnabled === undefined ? '已保存' : nextEnabled ? '已开启' : '已关闭'}` })
      } catch (error) {
        onNotice({ kind: 'error', text: `${feature.label} 保存失败：${String(error?.message ?? error)}` })
      } finally {
        setBusy(false)
      }
    }

    const run = async () => {
      setBusy(true)
      try {
        await persist()
        const { result } = await postJson(FEATURES_RUN_PATH, { id: feature.id })
        onNotice(result?.error
          ? { kind: 'error', text: `${feature.label} 发起失败：${result.error}` }
          : result?.channel === 'qq-sdk'
            ? { kind: 'ok', text: `${feature.label} 已调用上游 QQ Bot 发送话题` }
            : { kind: 'ok', text: `${feature.label} 已提交服务回合，QQ 送达待确认` })
        onRun()
      } catch (error) {
        onNotice({ kind: 'error', text: `${feature.label} 发起失败：${String(error?.message ?? error)}` })
      } finally {
        setBusy(false)
      }
    }

    const field = (label, input) => h('label', { style: styles.field },
      h('span', { style: styles.label }, label), input)
    const numberInput = (value, setter, min, max) => h('input', {
      style: styles.input, type: 'number', min, max, value,
      onChange: (event) => setter(event.target.value),
    })

    return h('div', { style: enabled ? { ...styles.card, ...styles.cardOn } : styles.card },
      h('div', {
        style: { ...styles.cardHead, ...(navigationMode ? {} : { cursor: 'pointer' }) },
        ...(navigationMode ? {} : { onClick: onToggle, role: 'button', 'aria-expanded': open, tabIndex: 0, onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle() }
        } }),
      },
        navigationMode ? null : h('span', { className: 'qqd-chev', style: { transform: open ? 'rotate(90deg)' : 'none' } }, '▸'),
        h('span', { style: styles.cardTitle }, feature.label),
        h('span', { style: styles.chip }, '内置'),
        h('span', { style: styles.chip }, `每日 ${checkTime} 检查`),
        h('div', { style: { marginLeft: 'auto' }, onClick: (event) => event.stopPropagation() },
          h(Switch, { checked: enabled, disabled: busy, label: `${feature.label} 开关`, onChange: (next) => { void save(next) } })),
      ),
      open ? h('div', null,
        h('p', { style: styles.desc }, settings?.deliveryMethod === 'upstream-sdk'
          ? '当前全局使用上游 QQ Bot 直接发送：选中的话题会作为开场白原文发出，不结合会话上下文生成。'
          : feature.description),
        h('div', { style: styles.grid },
          field('目标会话', h('div', { style: { display: 'flex', gap: 6 } },
            h('select', { style: { ...styles.select, flex: 1, minWidth: 0 }, value: sessionId, onChange: (event) => setSessionId(event.target.value), onFocus: () => { void onRefreshSessions?.() } },
              h('option', { value: '' }, '选择会话…'),
              ...targetOptions.options.map((option) => h('option', { key: option.value, value: option.value, disabled: option.disabled }, option.label))),
            h('button', { type: 'button', style: { ...styles.ghostButton, padding: '6px 9px', whiteSpace: 'nowrap' }, onClick: () => { void onRefreshSessions?.() } }, '刷新选项'))),
          field('每日检查时间', h('input', { style: styles.input, type: 'time', value: checkTime, onChange: (event) => setCheckTime(event.target.value) })),
          field('触发概率（%）', numberInput(chancePercent, setChancePercent, 0, 100)),
          field('发送冷却（小时）', numberInput(cooldownHours, setCooldownHours, 1, 720)),
          field('安静时段开始（小时）', numberInput(quietStart, setQuietStart, 0, 23)),
          field('安静时段结束（小时）', numberInput(quietEnd, setQuietEnd, 0, 23)),
          field('话题提示（多个话题用 | 分隔）', h('input', { style: styles.input, value: topics, maxLength: 120, placeholder: '留空使用内置话题', onChange: (event) => setTopics(event.target.value) })),
        ),
        targetOptions.invalidSelected ? h('p', { style: styles.warnText }, targetOptions.unavailableSelected ? '目标群不可用，请同步群名确认后再使用。' : '目标会话已失效，请重新选择并保存。') : null,
        h('p', { style: styles.desc }, `执行时间：每天 ${checkTime}（${feature.timeZone ?? 'Asia/Shanghai'}）。自动闲聊会按概率、冷却和安静时段判断；“立即发起”会跳过这些条件。`),
        h('p', { style: styles.desc },
          (cronRules(feature.cron)[0] ?? '') !== (() => { const [hour, minute] = checkTime.split(':').map(Number); return `${minute} ${hour} * * *` })()
            ? '保存后更新下次检查时间'
            : feature.nextRunAt > 0 ? `${enabled ? '下次执行' : '启用后下次计划执行'}：${formatZonedTime(feature.nextRunAt, feature.timeZone ?? 'Asia/Shanghai')}` : '暂无下一次检查时间'),
        h('div', { style: styles.cardFoot },
          h('button', { type: 'button', style: styles.primaryButton, disabled: busy, onClick: () => { void save() } }, '保存'),
          h('button', { type: 'button', style: styles.ghostButton, disabled: busy, onClick: () => { void run() } }, '立即发起'),
          h('span', { style: feature.lastResult?.error ? styles.statusError : styles.statusLine },
            feature.lastResult?.error ? `上次失败：${feature.lastResult.error}` : `上次检查：${formatRelative(feature.lastRunAt)}`),
        ),
      ) : h('p', { style: styles.collapsedLine }, `上次检查：${formatRelative(feature.lastRunAt)}`),
    )
  }

  return ChatCard
}
