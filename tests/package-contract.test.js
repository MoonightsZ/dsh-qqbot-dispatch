import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

test('套件與 bundle 使用 dsh-qqbot-dispatch 名稱', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.equal(pkg.name, 'dsh-qqbot-dispatch')
  assert.match(patch, /id: qqbot-dispatch\s+name: 'dsh-qqbot-dispatch'/)
})

test('前端載入器使用新的套件名稱', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  let registered
  runInNewContext(source, { window: { __ModuleLoader__: { load: (module) => { registered = module } } } })
  assert.equal(registered.id, 'dsh-qqbot-dispatch')
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useCallback: (callback) => callback,
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    useState: (value) => [value, () => {}],
  }
  const plugin = registered.factory((name) => {
    assert.equal(name, 'react')
    return React
  })
  const slots = []
  plugin.apply({ slots: {
    inject: (_slot, register) => register(),
    register: (meta, component) => { slots.push({ meta, component }); return () => {} },
  } })
  assert.deepEqual(slots.map(({ meta }) => meta.name), ['sidebar.panellist', 'main'])
  assert.equal(slots[0].meta.label, 'QQ 机器人 · 通知助手')
  assert.equal(slots[1].component().type, 'div')
})

test('中文插件標題使用確認的展示名稱', () => {
  const locale = JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8'))
  assert.equal(locale.meta.title, 'QQ 机器人 · 通知助手')
})
