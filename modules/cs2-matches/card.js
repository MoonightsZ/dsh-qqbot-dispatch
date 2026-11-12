import { cronRules as splitCronRules, describeCron, formatZonedTime } from '../../cron.js'
import { featureTargetOptions } from '../../client/session-options.js'
import { DEFAULT_CS2_SERVICE_TEMPLATE, DEFAULT_CS2_DIGEST_TEMPLATE, DEFAULT_CS2_PRE_MATCH_TEMPLATE, DEFAULT_CS2_RESULT_TEMPLATE } from './template.js'
import { migrateCs2NoticeRules } from './rules.js'
import { previewCs2FixedNotice } from './provider.js'

export function createFeatureCard({ React, h, C, styles, formatRelative, formatAbsolute, readJson, postJson, FEATURES_PATH, FEATURES_RUN_PATH, Switch, Section }) {
  const { useState } = React
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
  const channel = result?.channel === 'qq-sdk' ? ' · 已调用上游发送' : result?.channel === 'service-turn' ? ' · 已提交服务回合' : ''
  const warning = typeof result?.warning === 'string' && result.warning !== '' ? ` · ${result.warning}` : ''
  const countLabel = result?.channel === 'service-turn' ? '提交' : '发送'
  return {
    text: `${formatRelative(feature.lastRunAt)} · 匹配 ${result?.matched ?? 0} · ${countLabel} ${result?.sent ?? 0}${channel}${warning}`,
    error: false,
  }
}

function FeatureCard({ feature, settings, sessions, open, navigationMode = false, onToggle, onSaved, onRun, onNotice, onRefreshSessions }) {
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
  const [noticeRules, setNoticeRules] = useState(migrateCs2NoticeRules(feature, 'daily-digest'))
  const [noticeMode, setNoticeMode] = useState(['daily-digest', 'pre-match', 'result'].includes(feature.noticeMode) ? feature.noticeMode : 'daily-digest')
  const [digestDay, setDigestDay] = useState(feature.digestDay === 'today' ? 'today' : 'tomorrow')
  const [leadMinutesText, setLeadMinutesText] = useState(String(feature.leadMinutes ?? 60))
  const [deliveryMode, setDeliveryMode] = useState(feature.deliveryMode === 'service-turn' ? 'service-turn' : 'direct')
  const [serviceTemplate, setServiceTemplate] = useState(feature.serviceTemplate ?? DEFAULT_CS2_SERVICE_TEMPLATE)
  const [digestTemplate, setDigestTemplate] = useState(feature.digestTemplate ?? DEFAULT_CS2_DIGEST_TEMPLATE)
  const [preMatchTemplate, setPreMatchTemplate] = useState(feature.preMatchTemplate ?? DEFAULT_CS2_PRE_MATCH_TEMPLATE)
  const [resultTemplate, setResultTemplate] = useState(feature.resultTemplate ?? DEFAULT_CS2_RESULT_TEMPLATE)
  const [busy, setBusy] = useState(false)

  const updateRule = (mode, patch) => setNoticeRules((current) => ({ ...current, [mode]: { ...current[mode], ...patch } }))

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
    deliveryMode,
    serviceTemplate,
    digestTemplate,
    preMatchTemplate,
    resultTemplate,
    noticeMode: feature.noticeMode ?? 'daily-digest',
    noticeRules,
    digestDay,
    leadMinutes: Number(leadMinutesText) || 60,
    scheduleMode: feature.scheduleMode,
    cron: splitCronRules(feature.cron),
    source: { id: sourceId, baseUrl: baseUrl.trim() },
    ...(apiKey.trim() === '' ? {} : { credential: apiKey.trim() }),
    ...(clearKey ? { clearCredential: true } : {}),
    intervalMinutes: feature.intervalMinutes ?? 60,
    values: {
      teams: commitTeams(),
      tiers,
    },
    ...(overrides ?? {}),
  })

  const persist = async (nextEnabled, overrides) => {
    if (nextEnabled !== false && targetOptions.effectiveSessionId === '') throw new Error('请先设置全局默认目标或选择模组目标会话')
    if (nextEnabled !== false && targetOptions.invalidSelected) throw new Error(targetOptions.unavailableSelected ? '目标群不可用，请先同步群名确认' : '目标会话已失效，请重新选择')
    for (const [mode, rule] of Object.entries(noticeRules)) {
      if (rule.enabled && rule.scheduleMode === 'cron' && describeCron(rule.cron) === null) throw new Error(`${mode === 'daily-digest' ? '每日汇总' : mode === 'pre-match' ? '赛前提醒' : '赛果提醒'}的 Cron 规则无效`)
    }
    const next = await postJson(FEATURES_PATH, payload(nextEnabled, overrides))
    setApiKey('')
    setClearKey(false)
    const saved = next.features.find((item) => item.id === feature.id)
    setEnabled(saved?.enabled === true)
    onSaved(next)
    return next
  }

  const save = async (nextEnabled, overrides) => {
    setBusy(true)
    try {
      await persist(nextEnabled, overrides)
      const action = nextEnabled === undefined ? '已保存' : nextEnabled ? '已开启' : '已关闭'
      onNotice({ kind: 'ok', text: `${feature.label} ${action}` })
    } catch (failure) {
      onNotice({ kind: 'error', text: `${feature.label} 保存失败：${String(failure?.message ?? failure)}` })
    } finally {
      setBusy(false)
    }
  }

  const run = async (mode, forceResend = false) => {
    setBusy(true)
    try {
      if (forceResend) await persist()
      else {
        const savedTarget = featureTargetOptions(sessions, feature.target?.sessionId ?? '', settings?.defaultTargetSessionId ?? '')
        if (savedTarget.effectiveSessionId === '') throw new Error('请先设置全局默认目标或选择模组目标会话')
        if (savedTarget.invalidSelected) throw new Error(savedTarget.unavailableSelected ? '已保存的目标群不可用，请先同步群名确认' : '已保存的目标会话已失效，请重新选择并保存')
      }
      const { result } = await postJson(FEATURES_RUN_PATH, { id: feature.id, noticeMode: mode, ...(forceResend ? { forceResend: true } : {}) })
      const action = forceResend ? '发送' : '检查'
      const name = mode === 'daily-digest' ? '每日汇总' : mode === 'pre-match' ? '赛前提醒' : '赛果提醒'
      if (result?.error) onNotice({ kind: 'error', text: `${name} ${action}失败：${result.error}` })
      else if (result?.skipped) onNotice({ kind: 'ok', text: `${name} 正在运行，请稍后重试` })
      else if (forceResend && result?.matched === 0) onNotice({ kind: 'ok', text: `${name} 未找到匹配赛事` })
      else if (result?.channel === 'service-turn') onNotice({ kind: 'ok', text: `${name} 已提交 ${result?.sent ?? 0} 场赛事的服务回合，QQ 送达待确认` })
      else onNotice({ kind: 'ok', text: `${name} ${action}完成：匹配 ${result?.matched ?? 0}，发送 ${result?.sent ?? 0}` })
      onRun()
    } catch (failure) {
      onNotice({ kind: 'error', text: `${feature.label} ${forceResend ? '发送' : '检查'}失败：${String(failure?.message ?? failure)}` })
    } finally {
      setBusy(false)
    }
  }

  const status = featureStatus(feature)
  const tierOptions = feature.fields?.find((field) => field.kind === 'options')?.options ?? []
  const targetOptions = featureTargetOptions(sessions, sessionId, settings?.defaultTargetSessionId ?? '')

  const collapse = (event) => {
    event?.stopPropagation?.()
    onToggle()
  }

  const configSection = (index, title, help, ...children) => h('section', { style: styles.configSection },
    h('div', { style: styles.configSectionHead },
      h('span', { style: styles.configSectionIndex, 'aria-hidden': true }, index),
      h('div', null,
        h('h3', { style: styles.configSectionTitle }, title),
        h('p', { style: styles.configSectionHelp }, help),
      ),
    ),
    ...children,
  )

  const currentTemplate = noticeMode === 'daily-digest' ? digestTemplate : noticeMode === 'pre-match' ? preMatchTemplate : resultTemplate
  const updateCurrentTemplate = noticeMode === 'daily-digest' ? setDigestTemplate : noticeMode === 'pre-match' ? setPreMatchTemplate : setResultTemplate
  const defaultTemplate = noticeMode === 'daily-digest' ? DEFAULT_CS2_DIGEST_TEMPLATE : noticeMode === 'pre-match' ? DEFAULT_CS2_PRE_MATCH_TEMPLATE : DEFAULT_CS2_RESULT_TEMPLATE
  const templateName = noticeMode === 'daily-digest' ? '每日汇总' : noticeMode === 'pre-match' ? '赛前提醒' : '赛果提醒'
  const templateHelp = noticeMode === 'daily-digest'
    ? '占位符：{{title}}、{{schedule}}、{{focusAnalysis}}、{{sourceUrl}}。保留按赛事分组的赛程、赛事看点与 Liquipedia 来源。'
    : noticeMode === 'result' ? '占位符：{{tournament}}、{{tier}}、{{results}}、{{focusAnalysis}}、{{sourceUrl}}。只依据已确认比分分析，不补造地图或胜负原因。'
    : '占位符：{{tournament}}、{{tier}}、{{matchups}}、{{focusAnalysis}}、{{sourceUrl}}。保留对局、焦点分析与 Liquipedia 来源。'
  const contentLocked = settings?.deliveryMethod === 'upstream-sdk'
  const previewLine = (line, index) => {
    const text = line.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    if (line === '---') return h('hr', { key: index, style: { border: 0, borderTop: `1px solid ${C.border}`, margin: '10px 0' } })
    if (line === '') return h('div', { key: index, style: { height: 8 } })
    if (line.startsWith('# ')) return h('strong', { key: index, style: { display: 'block', fontSize: 16 } }, text.slice(2))
    if (line.startsWith('## ')) return h('strong', { key: index, style: { display: 'block', fontSize: 14 } }, text.slice(3))
    return h('div', { key: index }, text)
  }
  const fixedPreview = (mode) => h('div', { key: mode, style: { ...styles.field, marginTop: 12 } },
    h('span', { style: styles.label }, `${mode === 'daily-digest' ? '每日汇总' : mode === 'pre-match' ? '赛前提醒' : '赛果提醒'} · 发送内容示例`),
    h('div', { style: { padding: 12, border: `1px solid ${C.border}`, borderRadius: 8,
      background: C.layer2, color: C.primary, overflowWrap: 'anywhere', fontSize: 12, lineHeight: 1.6 } },
    ...previewCs2FixedNotice(mode, feature.timeZone ?? 'Asia/Shanghai').split('\n').map(previewLine)),
  )
  const rulePanel = (mode, title, description) => {
    const rule = noticeRules[mode]
    if (!rule) return null
    const entries = Array.isArray(rule.cron) && rule.cron.length > 0 ? rule.cron : ['']
    const persistedRule = feature.noticeRules?.[mode]
    const unchanged = persistedRule && rule.scheduleMode === persistedRule.scheduleMode &&
      (rule.scheduleMode === 'cron'
        ? JSON.stringify(splitCronRules(rule.cron)) === JSON.stringify(splitCronRules(persistedRule.cron))
        : Number(rule.intervalMinutes) === Number(persistedRule.intervalMinutes))
    const result = featureStatus(rule)
    return h('div', { key: mode, style: { border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginTop: 14 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
        h('strong', { style: { fontSize: 14 } }, title),
        h('span', { style: { marginLeft: 'auto', fontSize: 12, color: C.secondary } }, rule.enabled ? '已启用' : '已停用'),
        h(Switch, { checked: rule.enabled, disabled: busy, label: `${title}开关`, onChange: (checked) => updateRule(mode, { enabled: checked }) }),
      ),
      h('p', { style: styles.desc }, description),
      mode === 'daily-digest' ? h('div', { style: styles.field },
        h('span', { style: styles.label }, '汇总日期'),
        h('select', { style: styles.select, value: digestDay, onChange: (event) => setDigestDay(event.target.value) },
          h('option', { value: 'tomorrow' }, '明日赛程（推荐）'), h('option', { value: 'today' }, '今日赛程')),
      ) : mode === 'pre-match' ? h('div', { style: styles.field },
        h('span', { style: styles.label }, '最多提前提醒'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('input', { style: { ...styles.input, flex: '0 1 110px' }, value: leadMinutesText,
            type: 'number', min: 15, max: 360, onChange: (event) => setLeadMinutesText(event.target.value) }),
          h('span', { style: styles.desc }, '分钟（15–360）')),
      ) : h('p', { style: styles.desc }, '仅发送开赛时间在最近 6 小时内、数据源已标记完赛且有有效比分的比赛；进行中比分不会触发。'),
      h('div', { style: styles.field },
        h('span', { style: styles.label }, '检查频率'),
        h('div', { style: styles.segmented },
          h('button', { type: 'button', style: rule.scheduleMode === 'interval' ? styles.segOn : styles.seg,
            onClick: () => updateRule(mode, { scheduleMode: 'interval' }) }, '按间隔'),
          h('button', { type: 'button', style: rule.scheduleMode === 'cron' ? styles.segOn : styles.seg,
            onClick: () => updateRule(mode, { scheduleMode: 'cron' }) }, 'Cron')),
        rule.scheduleMode === 'interval' ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('input', { style: { ...styles.input, flex: '0 1 110px' }, value: String(rule.intervalMinutes),
            type: 'number', min: 15, max: 1440, onChange: (event) => updateRule(mode, { intervalMinutes: event.target.value }) }),
          h('span', { style: styles.desc }, '分钟（15–1440）'))
          : h('div', null,
            ...entries.map((entry, index) => h('div', { key: index, style: { marginBottom: 8 } },
              h('div', { style: { display: 'flex', gap: 8 } },
                h('input', { style: { ...styles.input, flex: '1 1 0', minWidth: 0 }, value: entry, placeholder: '分 时 日 月 周，例如 0 19 * * 1-5',
                  onChange: (event) => updateRule(mode, { cron: entries.map((item, position) => position === index ? event.target.value : item) }) }),
                h('button', { type: 'button', style: styles.ghostButton, disabled: entries.length <= 1,
                  onClick: () => updateRule(mode, { cron: entries.filter((_, position) => position !== index) }) }, '删除')),
              h('span', { style: { color: describeCron(entry) === null ? C.error : C.secondary, fontSize: 11 } },
                describeCron(entry) ?? '请输入有效的五段 Cron 规则'))),
            h('button', { type: 'button', style: styles.ghostButton, disabled: entries.length >= 10,
              onClick: () => updateRule(mode, { cron: [...entries, ''] }) }, '添加规则'),
            h('span', { style: { color: C.secondary, fontSize: 11 } },
              describeCron(entries) === null ? '规则无效' : `执行时间：${describeCron(entries)}`),
            h('span', { style: styles.desc }, `时区：${feature.timeZone ?? 'Asia/Shanghai'}`)),
        h('span', { style: styles.desc }, unchanged && persistedRule?.nextRunAt > 0
          ? `下次计划执行：${rule.scheduleMode === 'cron' ? formatZonedTime(persistedRule.nextRunAt, feature.timeZone ?? 'Asia/Shanghai') : formatAbsolute(persistedRule.nextRunAt)}`
          : '保存后更新下次执行时间'),
        mode === 'daily-digest' && rule.scheduleMode === 'interval'
          ? h('span', { style: styles.warnText }, '每日汇总每个日期最多发送一次，建议使用每天一次的 Cron。') : null,
        mode === 'pre-match' && rule.scheduleMode === 'cron'
          ? h('span', { style: styles.warnText }, '赛前提醒需要频繁检查，规则过少可能错过提醒窗口。') : null,
      ),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12 } },
        h('button', { type: 'button', style: styles.ghostButton, disabled: busy, onClick: () => { void run(mode) } }, '立即检查'),
        h('button', { type: 'button', style: styles.ghostButton, disabled: busy,
          title: `保存当前配置并重发${title}匹配赛事`, onClick: () => { void run(mode, true) } }, '立即发送'),
        h('span', { style: result.error ? styles.statusError : styles.statusLine }, result.text)),
    )
  }
  const contentSection = contentLocked
    ? configSection('05', '通知内容预览', '以下以示例赛事展示实际发送格式，比赛信息会在发送时替换。',
      h('p', { style: { ...styles.warnText, color: C.error } }, '全局已选择“直接发送 Markdown”，此模式只发送固定赛事内容，无法设置 AI 焦点分析或编辑模板。请在“配置”页切换为服务回合投递后再设置。'),
      fixedPreview('daily-digest'),
      fixedPreview('pre-match'),
      fixedPreview('result'),
    )
    : configSection('05', '通知内容', '选择固定赛事正文，或在服务回合中按通知方式生成分析。',
    h('div', { style: styles.field },
      h('span', { style: styles.label }, '内容生成方式'),
      h('div', { style: styles.segmented },
        h('button', { type: 'button', style: deliveryMode === 'direct' ? styles.segOn : styles.seg,
          onClick: () => setDeliveryMode('direct') }, '固定赛事内容'),
        h('button', { type: 'button', style: deliveryMode === 'service-turn' ? styles.segOn : styles.seg,
          onClick: () => setDeliveryMode('service-turn') }, 'AI 焦点分析'),
      ),
      h('span', { style: styles.desc }, deliveryMode === 'service-turn'
          ? `Agent 使用${templateName}模板生成赛程与分析；QQ 送达仍受平台限制。`
          : '已排版的赛事正文通过服务回合提交。'),
    ),
    deliveryMode !== 'service-turn' ? fixedPreview(noticeMode) : h('div', { style: { ...styles.field, marginTop: 14 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('span', { style: styles.label }, `${templateName} Markdown 模板`),
        h('button', { type: 'button', style: { ...styles.ghostButton, marginLeft: 'auto', padding: '3px 9px' },
          onClick: () => updateCurrentTemplate(defaultTemplate) }, '恢复默认模板'),
      ),
      h('textarea', {
        style: { ...styles.input, minHeight: 180, resize: 'vertical', fontFamily: 'ui-monospace, monospace', lineHeight: 1.5 },
        value: currentTemplate,
        maxLength: 6000,
        'aria-label': `CS2 ${templateName} Markdown 模板`,
        onChange: (event) => updateCurrentTemplate(event.target.value),
      }),
      h('span', { style: styles.desc }, `${templateHelp}分析仅依据赛事数据和会话上下文。`),
    ),
  )

  return h('div', { style: enabled ? { ...styles.card, ...styles.cardOn } : styles.card },
    h('div', {
      style: { ...styles.cardHead, ...(navigationMode ? {} : { cursor: 'pointer' }) },
      ...(navigationMode ? {} : { onClick: onToggle, role: 'button', 'aria-expanded': open, tabIndex: 0, onKeyDown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onToggle()
        }
      } }),
    },
      navigationMode ? null : h('span', { className: 'qqd-chev', style: { transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' } }, '▸'),
      h('span', { style: styles.cardTitle }, feature.label),
      feature.provider === null
        ? h('span', { style: styles.chipWarn }, feature.providerLabel)
        : h('span', { style: styles.chip }, feature.providerLabel),
      h('span', { style: styles.chip },
        `${Object.values(noticeRules).filter((rule) => rule.enabled).length} 条通知规则`),
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

    configSection('01', '数据源', '选择赛事来源并管理访问凭证。', h('div', { style: styles.sourceBlock },
      h('div', { style: styles.sourceHead },
        h('span', { style: styles.label }, '凭证状态'),
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
    )),
    configSection('02', '通知目标与赛事', '选择接收通知的会话，并设置赛事筛选条件。', h('div', { style: styles.grid },
      h('div', { style: { ...styles.field, gridColumn: '1 / -1' } },
        h('span', { style: styles.label }, '目标会话'),
        h('div', { style: { display: 'flex', gap: 6 } },
          h('select', {
            style: { ...styles.select, flex: 1, minWidth: 0 },
            value: sessionId,
            onChange: (event) => setSessionId(event.target.value),
            onFocus: () => { void onRefreshSessions?.() },
          },
          h('option', { value: '' }, `使用全局默认（${targetOptions.defaultLabel}）`),
          ...targetOptions.options.map((option) => h('option', { key: option.value, value: option.value, disabled: option.disabled }, option.label))),
          h('button', { type: 'button', style: { ...styles.ghostButton, padding: '6px 9px', whiteSpace: 'nowrap' }, onClick: () => { void onRefreshSessions?.() } }, '刷新选项')),
        targetOptions.invalidSelected ? h('span', { style: styles.warnText }, targetOptions.unavailableSelected ? '目标群不可用，请同步群名确认后再使用。' : '目标会话已失效，请重新选择并保存。') : null,
        h('span', { style: styles.desc }, '会话设置在「配置」页；此处留空将使用全局默认目标。'),
      ),
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
    )),
    configSection('03', '通知规则', '每日汇总、赛前提醒与赛果提醒可独立启用；同一场比赛可依次收到三种通知。',
      rulePanel('daily-digest', '每日赛程汇总', '按所选日期汇总赛程，每个日期最多自动发送一次。'),
      rulePanel('pre-match', '赛前提醒', '赛事进入提醒窗口后首次检查发送一次；错过开赛不补发。'),
      rulePanel('result', '赛果提醒', '比赛完赛且比分明确后发送一次，默认每 15 分钟检查。'),
    ),
    contentLocked ? null : configSection('04', '模板选择', '仅选择下方要编辑的模板；不会切换或关闭通知规则。',
      h('div', { style: { ...styles.segmented, display: 'flex', flexWrap: 'wrap', maxWidth: '100%' } },
        h('button', { type: 'button', style: noticeMode === 'daily-digest' ? styles.segOn : styles.seg,
          onClick: () => setNoticeMode('daily-digest') }, '每日汇总模板'),
        h('button', { type: 'button', style: noticeMode === 'pre-match' ? styles.segOn : styles.seg,
          onClick: () => setNoticeMode('pre-match') }, '赛前提醒模板'),
        h('button', { type: 'button', style: noticeMode === 'result' ? styles.segOn : styles.seg,
          onClick: () => setNoticeMode('result') }, '赛果提醒模板'),
      ),
    ),
    contentSection,

    h('div', { style: { ...styles.cardFoot, borderTop: `1px solid ${C.border}`, paddingTop: 16, marginTop: 20 } },
      h('button', {
        type: 'button',
        style: { ...styles.primaryButton, ...(busy ? styles.disabledButton : {}) },
        disabled: busy,
        onClick: () => { void save() },
      }, busy ? '处理中…' : '保存'),
      h('span', { style: status.error ? styles.statusError : styles.statusLine }, status.text),
    ),
    ) : null,
  )
}


return FeatureCard
}
