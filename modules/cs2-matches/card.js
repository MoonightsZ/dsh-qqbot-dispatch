import { cronRules as splitCronRules, describeCron, formatZonedTime } from '../../cron.js'

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
  const channel = result?.channel?.startsWith('qq') ? ' · 已直发 QQ' : result?.channel === 'service-turn' ? ' · 已提交服务回合' : ''
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
  const [cronEntries, setCronEntries] = useState(splitCronRules(feature.cron).length > 0 ? splitCronRules(feature.cron) : [''])
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
    cron: cronEntries.map((entry) => entry.trim()).filter(Boolean),
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
      if (scheduleMode === 'cron' && describeCron(cronEntries) === null) throw new Error('Cron 规则无效')
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
  const cronDescription = describeCron(cronEntries)
  const savedCron = JSON.stringify(splitCronRules(feature.cron)) === JSON.stringify(cronEntries.map((entry) => entry.trim()).filter(Boolean))
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
        feature.scheduleMode === 'cron' ? `Cron · ${splitCronRules(feature.cron).length} 条` : `每 ${feature.intervalMinutes ?? 60} 分钟`),
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
            ...cronEntries.map((rule, index) => h('div', { key: index, style: { marginBottom: 8 } },
              h('div', { style: { display: 'flex', gap: 8 } },
                h('input', {
                  style: styles.input, value: rule, placeholder: '分 时 日 月 周，例如 0 19 * * 1-5',
                  onChange: (event) => setCronEntries((current) => current.map((item, position) => position === index ? event.target.value : item)),
                }),
                h('button', { type: 'button', style: styles.ghostButton, disabled: cronEntries.length <= 1,
                  onClick: () => setCronEntries((current) => current.filter((_, position) => position !== index)) }, '删除'),
              ),
              h('span', { style: { color: describeCron(rule) === null ? C.error : C.secondary, fontSize: 11 } },
                describeCron(rule) ?? '请输入有效的五段 Cron 规则'),
            )),
            h('button', { type: 'button', style: styles.ghostButton, disabled: cronEntries.length >= 10,
              onClick: () => setCronEntries((current) => [...current, '']) }, '添加规则'),
            h('div', { style: { color: cronDescription === null ? C.error : C.secondary, fontSize: 11, marginTop: 6 } },
              cronDescription === null ? '规则无效；格式为「分 时 日 月 周」' : `执行时间：${cronDescription}`),
            h('div', { style: { color: C.secondary, fontSize: 11 } }, `时区：${feature.timeZone ?? 'Asia/Shanghai'}；日期与星期条件需同时满足`),
          ),
        h('span', { style: { color: C.secondary, fontSize: 11 } },
          scheduleMode === 'cron' && !savedCron ? '保存后更新下次执行时间'
            : feature.nextRunAt > 0
              ? `${enabled ? '下次执行' : '启用后下次计划执行'}：${scheduleMode === 'cron' ? formatZonedTime(feature.nextRunAt, feature.timeZone ?? 'Asia/Shanghai') : formatAbsolute(feature.nextRunAt)}`
              : '暂无下一次执行时间（请检查规则与时区）'),
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


return FeatureCard
}
