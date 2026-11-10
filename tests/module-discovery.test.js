import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLazyProvider, discoverModules } from '../module-discovery.js'
import { createFeatureRuntime } from '../features.js'

test('扫描新模组并默认关闭，用户开启后才参与自动运行', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qqbot-modules-'))
  const directory = join(root, 'sample-alert')
  mkdirSync(directory)
  writeFileSync(join(root, 'package.json'), '{"type":"module"}', 'utf8')
  writeFileSync(join(directory, 'module.json'), JSON.stringify({ id: 'sample-alert', label: '示例通知', fields: [] }), 'utf8')
  writeFileSync(join(directory, 'provider.js'), 'globalThis.__sampleModuleLoaded = true; export const createProvider = () => async () => ({ matched: 1, sent: 1 })', 'utf8')
  const modules = await discoverModules({ root })
  assert.deepEqual(modules.map((item) => item.definition.id), ['sample-alert'])
  assert.equal(globalThis.__sampleModuleLoaded, undefined)
  const runtime = createFeatureRuntime({ ctx: { get: () => undefined }, statePath: join(root, 'state.json'), modules: modules.map((item) => item.definition) })
  assert.equal((await runtime.snapshot()).features[0].enabled, false)
  runtime.registerProvider('sample-alert', createLazyProvider(modules[0].providerPath, {}))
  assert.equal((await runtime.run('sample-alert')).reason, 'disabled')
  assert.equal((await runtime.run('sample-alert', { manual: true })).reason, 'disabled')
  assert.equal(globalThis.__sampleModuleLoaded, undefined)
  await runtime.save('sample-alert', { enabled: true, target: { sessionId: 'session-1' }, source: { id: 'none' }, values: {} })
  assert.equal((await runtime.run('sample-alert')).sent, 1)
  assert.equal(globalThis.__sampleModuleLoaded, true)
  delete globalThis.__sampleModuleLoaded
})
