/** Settings for the realtime group inbound gate. */
export function createGroupGateCard({ React, h, styles, postJson, FEATURES_PATH, Switch }) {
  const { useState } = React
  const numbers = [
    ['chancePercent', '接话概率（%）', 0, 100],
    ['debounceSeconds', '静默合并（秒）', 0, 300],
    ['backlogMax', '每群积压上限（条）', 0, 100],
    ['minIntervalSeconds', '最短间隔（秒，0 不限）', 0, 86400],
    ['maxPerHour', '每小时上限（0 不限）', 0, 1000],
    ['maxPerDay', '每天上限（0 不限）', 0, 10000],
  ]

  return function GroupGateCard({ feature, onSaved, onNotice }) {
    const [enabled, setEnabled] = useState(feature.enabled === true)
    const [values, setValues] = useState(feature.values ?? {})
    const [busy, setBusy] = useState(false)

    const save = async (nextEnabled = enabled) => {
      setBusy(true)
      try {
        for (const [key, label, min, max] of numbers) {
          const value = Number(values[key])
          if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}必须是 ${min}–${max} 的整数`)
        }
        const next = await postJson(FEATURES_PATH, {
          id: feature.id, enabled: nextEnabled, target: { sessionIds: [] },
          source: { id: 'none' }, values,
        })
        setEnabled(next.features.find((item) => item.id === feature.id)?.enabled === true)
        onSaved(next)
        onNotice({ kind: 'ok', text: `群聊频控已${nextEnabled ? '启用并保存' : '关闭并保存'}；新消息立即按当前设置处理。` })
      } catch (error) {
        onNotice({ kind: 'error', text: `保存群聊频控失败：${String(error?.message ?? error)}` })
      } finally {
        setBusy(false)
      }
    }

    return h('div', { style: styles.card },
      h('div', { style: styles.cardHead },
        h('span', { style: styles.cardTitle }, '群聊频控'),
        h('span', { style: styles.chip }, '实时'),
        h('div', { style: { marginLeft: 'auto' } }, h(Switch, {
          checked: enabled, disabled: busy, label: '群聊频控开关', onChange: (next) => { void save(next) },
        })),
      ),
      h('p', { style: styles.desc }, '处理所有 QQ 群中未 @ 的纯文字群消息；私聊、@ 消息和附件直接放行。此设置不影响通知模组的主动发送。'),
      feature.runtimeError ? h('p', { style: styles.warnText, role: 'alert' }, `频控未安装：${feature.runtimeError}`) : null,
      h('div', { style: styles.warningCallout }, '请先在官方 QQ 插件开启群聊全量消息权限并设 requireMention: false；若 dsh-qqbot-expands 的群聊频控也已开启，本模组会让其优先处理。'),
      h('div', { style: styles.grid }, ...numbers.map(([key, label, min, max]) => h('label', { key, style: styles.field },
        h('span', { style: styles.label }, label),
        h('input', { style: styles.input, type: 'number', min, max, step: 1,
          value: String(values[key] ?? feature.fields?.find((item) => item.key === key)?.default ?? ''),
          onChange: (event) => setValues({ ...values, [key]: event.target.value }),
        })))),
      h('div', { style: styles.field },
        h('span', { style: styles.label }, '过滤无效文字（空白、纯符号、重复字符、语气词）'),
        h(Switch, { checked: values.filterInvalid !== 'false', disabled: busy,
          label: '过滤无效文字', onChange: (next) => setValues({ ...values, filterInvalid: String(next) }) }),
      ),
      h('p', { style: styles.desc }, '未命中概率或达到限速的消息最多保留在每群积压中，下一次命中时一起送入 Agent；积压只保存在运行内存中，重启后清空。'),
      h('div', { style: styles.cardFoot },
        h('button', { type: 'button', style: styles.primaryButton, disabled: busy, onClick: () => { void save() } }, '保存设置'),
      ),
    )
  }
}
