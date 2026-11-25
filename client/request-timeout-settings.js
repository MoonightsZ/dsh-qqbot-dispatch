import { DEFAULT_REQUEST_TIMEOUT_SECONDS, MIN_REQUEST_TIMEOUT_SECONDS, MAX_REQUEST_TIMEOUT_SECONDS } from '../modules/cs2-matches/request-timeout.js'

export function createRequestTimeoutSettings({ React, h, styles, postJson, SETTINGS_PATH }) {
  const { useState } = React

  return function RequestTimeoutSettings({ settings, onSaved, onNotice }) {
    const saved = settings.requestTimeoutSeconds ?? DEFAULT_REQUEST_TIMEOUT_SECONDS
    const [value, setValue] = useState(String(saved))
    const [busy, setBusy] = useState(false)
    const seconds = Number(value)
    const valid = Number.isInteger(seconds) && seconds >= MIN_REQUEST_TIMEOUT_SECONDS && seconds <= MAX_REQUEST_TIMEOUT_SECONDS
    const changed = valid && seconds !== saved

    const save = async () => {
      if (!changed) return
      setBusy(true)
      try {
        const { settings: next } = await postJson(SETTINGS_PATH, { requestTimeoutSeconds: seconds })
        setValue(String(next.requestTimeoutSeconds))
        onSaved(next)
        onNotice({ kind: 'ok', text: '数据源请求超时已保存' })
      } catch (error) {
        onNotice({ kind: 'error', text: `保存请求超时失败：${String(error?.message ?? error)}` })
      } finally {
        setBusy(false)
      }
    }

    return h('div', { style: { ...styles.panel, padding: '18px 20px' } },
      h('p', { style: { ...styles.desc, marginTop: 0 } }, '控制 CS2 的 Liquipedia 与 PandaScore 单次 HTTP 请求等待时间；不包含 Liquipedia 的请求间隔。'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12 } },
        h('label', { style: styles.field },
          h('span', { style: styles.label }, '请求超时（秒）'),
          h('input', { type: 'number', min: MIN_REQUEST_TIMEOUT_SECONDS, max: MAX_REQUEST_TIMEOUT_SECONDS,
            step: 1, value, disabled: busy, style: { ...styles.input, width: 110 },
            onChange: (event) => setValue(event.target.value) }),
        ),
        h('button', { type: 'button', style: styles.primaryButton, disabled: busy || !changed,
          onClick: () => { void save() } }, busy ? '保存中…' : '保存请求超时'),
      ),
      h('p', { style: styles.desc }, `允许 ${MIN_REQUEST_TIMEOUT_SECONDS}–${MAX_REQUEST_TIMEOUT_SECONDS} 秒；默认 ${DEFAULT_REQUEST_TIMEOUT_SECONDS} 秒。`),
      !valid ? h('p', { style: styles.warnText }, `请输入 ${MIN_REQUEST_TIMEOUT_SECONDS}–${MAX_REQUEST_TIMEOUT_SECONDS} 秒的整数。`) : null,
    )
  }
}
