import { cronRules, formatZonedTime } from '../../cron.js'
import { featureTargetOptions } from '../../client/session-options.js'
import { createTargetPicker } from '../../client/target-picker.js'
import { summarizeTargetResults } from '../../client/target-results.js'
import { DEFAULT_TOPICS, MAX_TOPICS, normalizeTopics } from './topics.js'

export function createChatCard({ React, h, C, styles, formatRelative, readJson, postJson, FEATURES_PATH, FEATURES_RUN_PATH, TOPIC_MODELS_PATH, TOPIC_RECOMMEND_PATH, Switch }) {
  const { useState } = React
  const TargetPicker = createTargetPicker({ React, h, styles })

  function ChatCard({ feature, settings, sessions, open, navigationMode = false, onToggle, onSaved, onRun, onNotice, onRefreshSessions }) {
    const values = feature.values ?? {}
    const [enabled, setEnabled] = useState(feature.enabled === true)
    const [sessionIds, setSessionIds] = useState(feature.target?.sessionIds ?? [])
    const [checkTime, setCheckTime] = useState((() => {
      const [minute, hour] = (cronRules(feature.cron)[0] ?? '0 19 * * *').split(' ')
      return `${String(hour ?? '19').padStart(2, '0')}:${String(minute ?? '0').padStart(2, '0')}`
    })())
    const [chancePercent, setChancePercent] = useState(String(values.chancePercent ?? '30'))
    const [cooldownHours, setCooldownHours] = useState(String(values.cooldownHours ?? '72'))
    const [quietStart, setQuietStart] = useState(String(values.quietStart ?? '22'))
    const [quietEnd, setQuietEnd] = useState(String(values.quietEnd ?? '9'))
    const [topics, setTopics] = useState(normalizeTopics(values.topics))
    const [keyword, setKeyword] = useState('')
    const [suggestionKeyword, setSuggestionKeyword] = useState('')
    const [suggestions, setSuggestions] = useState([])
    const [selectedSuggestions, setSelectedSuggestions] = useState([])
    const [suggesting, setSuggesting] = useState(false)
    const [suggestError, setSuggestError] = useState('')
    const [modelLabel, setModelLabel] = useState('')
    const [tagFilter, setTagFilter] = useState('')
    const [busy, setBusy] = useState(false)
    const targetOptions = featureTargetOptions(sessions, sessionIds, settings?.defaultTargetSessionIds ?? [])

    const payload = (nextEnabled) => {
      const [hour, minute] = checkTime.split(':').map(Number)
      return {
        id: feature.id,
        enabled: nextEnabled ?? enabled,
        target: { sessionIds },
        source: { id: 'none', baseUrl: '' },
        scheduleMode: 'cron',
        cron: [`${minute} ${hour} * * *`],
        timeZone: feature.timeZone ?? 'Asia/Shanghai',
        values: { chancePercent, cooldownHours, quietStart, quietEnd, topics },
      }
    }

    const persist = async (nextEnabled) => {
      if (nextEnabled !== false && targetOptions.effectiveSessionIds.length === 0) throw new Error('请先设置全局默认目标或选择模组目标会话')
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
        const targets = summarizeTargetResults(result, sessions)
        const targetCount = targets.total > 1 ? `（${targets.succeeded}/${targets.total} 个目标已处理）` : ''
        onNotice(result?.error
          ? { kind: 'error', text: `${feature.label} ${result.sent > 0 ? '部分完成' : '发起失败'}${targetCount}：${targets.failureText || result.error}` }
          : result?.warning
            ? { kind: 'error', text: `${feature.label} ${result.warning}` }
          : result?.channel === 'qq-sdk'
            ? { kind: 'ok', text: `${feature.label} 已调用上游 QQ Bot 发送 ${result?.sent ?? 0} 条话题${targetCount}` }
            : { kind: 'ok', text: `${feature.label} 已提交 ${result?.sent ?? 0} 个服务回合${targetCount}，QQ 送达待确认` })
        onRun()
      } catch (error) {
        onNotice({ kind: 'error', text: `${feature.label} 发起失败：${String(error?.message ?? error)}` })
      } finally {
        setBusy(false)
      }
    }

    const field = (label, input, style) => h('label', { style: { ...styles.field, ...style } },
      h('span', { style: styles.label }, label), input)
    const numberInput = (value, setter, min, max) => h('input', {
      style: styles.input, type: 'number', min, max, value,
      onChange: (event) => setter(event.target.value),
    })

    const updateTopic = (id, patch) => setTopics((current) => current.map((topic) => topic.id === id ? { ...topic, ...patch } : topic))
    const addTopic = () => setTopics((current) => current.length >= MAX_TOPICS ? current : [...current, { id: `topic-${Date.now()}-${Math.random().toString(36).slice(2)}`, text: '', tags: [], sourceKeyword: '', enabled: true }])
    const recommend = async () => {
      setSuggesting(true)
      setSuggestError('')
      try {
        const theme = keyword.trim()
        if (!theme || theme.length > 80) throw new Error('请输入不超过 80 字的主题词')
        const { models } = await readJson(TOPIC_MODELS_PATH)
        if (!models?.length) throw new Error('没有可用模型，请先在 DSH 配置模型')
        const chosen = models[0]
        const result = await postJson(TOPIC_RECOMMEND_PATH, { keyword: theme, provider: chosen.provider, model: chosen.model })
        setModelLabel(chosen.label)
        setSuggestionKeyword(theme)
        setSuggestions(result.topics ?? [])
        setSelectedSuggestions([])
      } catch (error) {
        setSuggestError(String(error?.message ?? error))
      } finally {
        setSuggesting(false)
      }
    }
    const addSuggestions = () => {
      const theme = suggestionKeyword
      const chosen = suggestions.filter((_, index) => selectedSuggestions.includes(index))
      if (!chosen.length) return setSuggestError('请先勾选要加入的话题')
      setTopics((current) => {
        const existing = new Set(current.map((topic) => topic.text.trim()))
        const next = [...current]
        for (const text of chosen) {
          if (next.length >= MAX_TOPICS || !text.trim() || existing.has(text.trim())) continue
          next.push({ id: `topic-${Date.now()}-${Math.random().toString(36).slice(2)}`, text: text.trim(), tags: theme.length <= 30 ? [theme] : [], sourceKeyword: theme, enabled: true })
          existing.add(text.trim())
        }
        return next
      })
      setSuggestions([])
      setSelectedSuggestions([])
      setSuggestError('')
    }
    const allTags = [...new Set(topics.flatMap((topic) => topic.tags.length ? topic.tags : ['未分类']))]
    const visibleTopics = tagFilter ? topics.filter((topic) => (topic.tags.length ? topic.tags : ['未分类']).includes(tagFilter)) : topics

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
          field('目标会话', h(TargetPicker, { sessions, selectedIds: sessionIds, onChange: setSessionIds, onRefreshSessions,
            label: '目标会话', inheritLabel: targetOptions.defaultLabel })),
          field('每日检查时间', h('input', { style: styles.input, type: 'time', value: checkTime, onChange: (event) => setCheckTime(event.target.value) })),
          field('触发概率（%）', numberInput(chancePercent, setChancePercent, 0, 100)),
          field('发送冷却（小时）', numberInput(cooldownHours, setCooldownHours, 1, 720)),
          field('安静时段开始（小时）', numberInput(quietStart, setQuietStart, 0, 23)),
          field('安静时段结束（小时）', numberInput(quietEnd, setQuietEnd, 0, 23)),
        ),
        h('section', { style: { marginTop: 18, borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 16 } },
          h('h3', { style: { margin: '0 0 6px', fontSize: 14 } }, '话题池'),
          h('p', { style: styles.desc }, '话题提示按标签先随机、再选话题；直接发送 Markdown 时会原文发送。修改后请保存。'),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', margin: '12px 0' } },
            field('按主题词 AI 推荐', h('input', { style: styles.input, value: keyword, maxLength: 80, placeholder: '例如：CS2 赛事', onChange: (event) => setKeyword(event.target.value) }), { flex: '1 1 220px' }),
            h('button', { type: 'button', style: styles.ghostButton, disabled: suggesting, onClick: () => { void recommend() } }, suggesting ? '生成中…' : 'AI 推荐')),
          modelLabel ? h('p', { style: styles.desc }, `推荐模型：${modelLabel}`) : null,
          suggestError ? h('p', { role: 'alert', style: styles.warnText }, suggestError) : null,
          suggestions.length ? h('div', { style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 12, marginBottom: 12 } },
            h('p', { style: styles.desc }, '勾选并可编辑候选；加入话题池后仍需点击保存。'),
            ...suggestions.map((text, index) => h('div', { key: index, style: { display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' } },
              h('input', { type: 'checkbox', 'aria-label': `选择候选话题 ${index + 1}`, checked: selectedSuggestions.includes(index), onChange: (event) => setSelectedSuggestions((current) => event.target.checked ? [...current, index] : current.filter((value) => value !== index)) }),
              h('input', { style: { ...styles.input, flex: 1 }, 'aria-label': `候选话题 ${index + 1}`, value: text, maxLength: 120, onChange: (event) => setSuggestions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item)) }))),
            h('button', { type: 'button', style: styles.primaryButton, onClick: addSuggestions }, '加入话题池')) : null,
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0' } },
            h('strong', { style: { fontSize: 13 } }, `已添加 ${topics.length}/${MAX_TOPICS} 条`),
            h('select', { style: { ...styles.select, width: 'auto', maxWidth: '100%' }, 'aria-label': '按标签筛选话题', value: tagFilter, onChange: (event) => setTagFilter(event.target.value) },
              h('option', { value: '' }, '全部标签'),
              ...allTags.map((tag) => h('option', { key: tag, value: tag }, tag))),
            h('button', { type: 'button', style: styles.ghostButton, disabled: topics.length >= MAX_TOPICS, onClick: addTopic }, '手动添加')),
          topics.length === 0 ? h('p', { style: styles.desc }, `话题池为空时使用内置话题：${DEFAULT_TOPICS.join('、')}`) : null,
          ...visibleTopics.map((topic) => h('div', { key: topic.id, style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: 10, marginBottom: 8 } },
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              h('input', { style: { ...styles.input, flex: '1 1 240px' }, 'aria-label': '话题内容', value: topic.text, maxLength: 120, placeholder: '输入可直接发送的开场白', onChange: (event) => updateTopic(topic.id, { text: event.target.value }) }),
              h('label', null, h('input', { type: 'checkbox', checked: topic.enabled, onChange: (event) => updateTopic(topic.id, { enabled: event.target.checked }) }), '启用'),
              h('button', { type: 'button', style: styles.ghostButton, onClick: () => setTopics((current) => current.filter((item) => item.id !== topic.id)) }, '删除')),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 } },
              field('标签（逗号分隔，最多 5 个）', h('input', { style: styles.input, value: topic.tags.join('，'), placeholder: '例如：CS2，赛事', onChange: (event) => updateTopic(topic.id, { tags: [...new Set(event.target.value.split(/[,，;；]+/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 5) }) }), { flex: '1 1 220px' }),
              topic.sourceKeyword ? h('span', { style: styles.desc }, `来源主题词：${topic.sourceKeyword}`) : null))),
        ),
        targetOptions.invalidSelected ? h('p', { style: styles.warnText }, targetOptions.unavailableSelected ? '目标群不可用，请同步群名确认后再使用。' : '目标会话已失效，请重新选择并保存。') : null,
        h('p', { style: styles.desc }, '会话设置在「配置」页；此处不选择将继承整组全局默认目标。'),
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
