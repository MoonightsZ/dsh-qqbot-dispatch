import { readdir, readFile, lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'modules')
const BUILT_IN_IDS = new Set(['cs2-matches', 'casual-chat'])
const MODULE_ID = /^[a-z][a-z0-9-]{0,63}$/
const FIELD_KEY = /^[a-z][a-zA-Z0-9]{0,63}$/

function validateManifest(raw, id) {
  if (raw === null || typeof raw !== 'object' || raw.id !== id || typeof raw.label !== 'string' || raw.label.trim() === '') {
    throw new Error('module.json 的 id 或 label 无效')
  }
  if (!Array.isArray(raw.fields) || raw.fields.length > 20) throw new Error('module.json 的 fields 无效')
  const keys = new Set()
  const fields = raw.fields.map((field) => {
    if (field === null || typeof field !== 'object' || !FIELD_KEY.test(field.key) || ['constructor', 'prototype'].includes(field.key) || keys.has(field.key) || !(['text', 'list', 'options'].includes(field.kind) || (id === 'casual-chat' && field.key === 'topics' && field.kind === 'topics'))) {
      throw new Error('module.json 包含无效或重复的配置字段')
    }
    keys.add(field.key)
    const options = field.kind === 'options'
      ? (Array.isArray(field.options) ? field.options : []).filter((item) => typeof item === 'string' && item.length <= 60).slice(0, 30)
      : undefined
    return {
      key: field.key,
      kind: field.kind,
      label: String(field.label ?? field.key).slice(0, 80),
      ...(options === undefined ? {} : { options }),
      ...(typeof field.default === 'string' || Array.isArray(field.default) ? { default: field.default } : {}),
    }
  })
  const defaults = raw.defaults !== null && typeof raw.defaults === 'object' ? raw.defaults : {}
  return {
    id,
    label: raw.label.trim().slice(0, 80),
    description: String(raw.description ?? '').slice(0, 300),
    provider: BUILT_IN_IDS.has(id) ? raw.provider ?? null : 'builtin',
    defaults: {
      source: { id: BUILT_IN_IDS.has(id) ? (defaults.source?.id ?? 'custom') : 'none', baseUrl: '' },
      intervalMinutes: Number.isFinite(defaults.intervalMinutes) ? defaults.intervalMinutes : 60,
      scheduleMode: defaults.scheduleMode === 'cron' ? 'cron' : 'interval',
      cron: Array.isArray(defaults.cron) ? defaults.cron.filter((item) => typeof item === 'string').slice(0, 10) : [],
    },
    fields,
    extension: !BUILT_IN_IDS.has(id),
  }
}

/** Scan metadata only; no provider or browser card code executes here. */
export async function discoverModules({ root = DEFAULT_ROOT, onError = () => {} } = {}) {
  const directories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && MODULE_ID.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
  const modules = []
  for (const directory of directories) {
    const path = join(root, directory.name)
    try {
      const manifestPath = join(path, 'module.json')
      const providerPath = join(path, 'provider.js')
      const manifestStat = await lstat(manifestPath)
      if (!manifestStat.isFile() || manifestStat.size > 16_384 || !(await lstat(providerPath)).isFile()) throw new Error('模组文件无效或清单超过 16 KiB')
      const source = await readFile(manifestPath)
      const definition = validateManifest(JSON.parse(source.toString('utf8')), directory.name)
      modules.push({ definition, providerPath })
    } catch (error) {
      onError(directory.name, error)
    }
  }
  return modules
}

/** Import executable code only when an enabled module actually runs. */
export function createLazyProvider(providerPath, options) {
  let provider
  return async (input) => {
    if (provider === undefined) {
      const module = await import(pathToFileURL(providerPath).href)
      if (typeof module.createProvider !== 'function') throw new Error('模组缺少 createProvider 导出')
      provider = module.createProvider(options)
      if (typeof provider !== 'function') throw new Error('createProvider 必须返回运行函数')
    }
    return provider(input)
  }
}
