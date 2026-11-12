import { cronRules } from '../cron.js'
import { featureTargetOptions } from './session-options.js'
import { createTargetPicker } from './target-picker.js'
import { summarizeTargetResults } from './target-results.js'

/** Metadata-only UI for extensions; never import a third-party browser card. */
export function createExtensionCard({ React, h, styles, postJson, FEATURES_PATH, FEATURES_RUN_PATH, Switch }) {
  const { useState } = React
  const TargetPicker = createTargetPicker({ React, h, styles })

  return function ExtensionCard({ feature, settings, sessions, onSaved, onRun, onNotice, onRefreshSessions }) {
    const [enabled, setEnabled] = useState(feature.enabled === true)
    const [sessionIds, setSessionIds] = useState(feature.target?.sessionIds ?? [])
    const [values, setValues] = useState(feature.values ?? {})
    const [scheduleMode, setScheduleMode] = useState(feature.scheduleMode === 'cron' ? 'cron' : 'interval')
    const [intervalMinutes, setIntervalMinutes] = useState(String(feature.intervalMinutes ?? 60))
    const [cronText, setCronText] = useState(cronRules(feature.cron).join('\n'))
    const [busy, setBusy] = useState(false)
    const targetOptions = featureTargetOptions(sessions, sessionIds, settings?.defaultTargetSessionIds ?? [])

    const save = async (nextEnabled = enabled) => {
      if (nextEnabled && targetOptions.effectiveSessionIds.length === 0) throw new Error('请先设置全局默认目标或选择模组目标会话')
      if (nextEnabled && targetOptions.invalidSelected) throw new Error('目标会话不可用，请刷新后重新选择')
      const next = await postJson(FEATURES_PATH, {
        id: feature.id,
        enabled: nextEnabled,
        target: { sessionIds },
        source: { id: 'none', baseUrl: '' },
        scheduleMode,
        intervalMinutes: Number(intervalMinutes) || 60,
        cron: cronText.split(/\r?\n/).map((rule) => rule.trim()).filter(Boolean),
        timeZone: feature.timeZone ?? 'Asia/Shanghai',
        values,
      })
      setEnabled(next.features.find((item) => item.id === feature.id)?.enabled === true)
      onSaved(next)
    }

    const act = async (action, nextEnabled) => {
      setBusy(true)
      try {
        await save(nextEnabled)
        if (action === 'run') {
          const { result } = await postJson(FEATURES_RUN_PATH, { id: feature.id })
          const targets = summarizeTargetResults(result, sessions)
          if (result?.error) throw new Error(`${result.sent > 0 ? '部分完成：' : ''}${targets.failureText || result.error}`)
          onRun()
          onNotice({ kind: 'ok', text: `${feature.label} 已运行${targets.total > 1 ? `，${targets.succeeded}/${targets.total} 个目标已处理` : ''}` })
        } else onNotice({ kind: 'ok', text: `${feature.label} 已保存` })
      } catch (error) {
        onNotice({ kind: 'error', text: `${feature.label} ${action === 'run' ? '运行' : '保存'}失败：${String(error?.message ?? error)}` })
      } finally {
        setBusy(false)
      }
    }

    return h('div', { style: styles.card },
      h('div', { style: styles.cardHead },
        h('span', { style: styles.cardTitle }, feature.label),
        h('span', { style: styles.chip }, '扩展模组'),
        h('div', { style: { marginLeft: 'auto' } }, h(Switch, {
          checked: enabled, disabled: busy, label: `${feature.label} 开关`,
          onChange: (next) => { void act('save', next) },
        })),
      ),
      h('p', { style: styles.desc }, feature.description),
      h('div', { style: styles.warningCallout }, '启用后将加载此模组的服务端代码；它与 DSH 在同一进程运行。请先检查来源和代码。'),
      h('div', { style: styles.field }, h('span', { style: styles.label }, '目标会话'),
        h(TargetPicker, { sessions, selectedIds: sessionIds, onChange: setSessionIds, onRefreshSessions,
          label: '目标会话', inheritLabel: targetOptions.defaultLabel })),
      h('p', { style: styles.desc }, '会话设置在「配置」页；此处不选择将继承整组全局默认目标。'),
      ...(feature.fields ?? []).map((field) => h('label', { key: field.key, style: styles.field },
        h('span', { style: styles.label }, field.label),
        h('input', {
          style: styles.input,
          value: Array.isArray(values[field.key]) ? values[field.key].join(', ') : String(values[field.key] ?? ''),
          placeholder: field.kind === 'options' ? `可选：${(field.options ?? []).join('、')}` : undefined,
          onChange: (event) => setValues({ ...values, [field.key]: field.kind === 'text' ? event.target.value : event.target.value.split(/[,，]+/).map((item) => item.trim()).filter(Boolean) }),
        }))),
      h('div', { style: styles.grid },
        h('label', { style: styles.field }, h('span', { style: styles.label }, '检查方式'),
          h('select', { style: styles.select, value: scheduleMode, onChange: (event) => setScheduleMode(event.target.value) },
            h('option', { value: 'interval' }, '间隔'), h('option', { value: 'cron' }, 'Cron'))),
        scheduleMode === 'cron'
          ? h('label', { style: styles.field }, h('span', { style: styles.label }, 'Cron 规则（每行一条）'),
            h('textarea', { style: styles.input, value: cronText, onChange: (event) => setCronText(event.target.value) }))
          : h('label', { style: styles.field }, h('span', { style: styles.label }, '检查间隔（分钟）'),
            h('input', { style: styles.input, type: 'number', min: 15, max: 1440, value: intervalMinutes, onChange: (event) => setIntervalMinutes(event.target.value) })),
      ),
      h('div', { style: styles.cardFoot },
        h('button', { type: 'button', style: styles.primaryButton, disabled: busy, onClick: () => { void act('save') } }, '保存'),
        h('button', { type: 'button', style: styles.ghostButton, disabled: busy || !enabled, onClick: () => { void act('run') } }, '立即运行'),
      ),
    )
  }
}
