import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

export function createGroupNameStore(groupNamesPath = resolve(homedir(), '.dsh-qqbot', 'group-names.json')) {
  /** Persisted group_openid → { sessionId, name, memberNum } learned from the QQ API. */
  function readGroupNames() {
    try {
      if (!existsSync(groupNamesPath)) return {}
      const data = JSON.parse(readFileSync(groupNamesPath, 'utf8'))
      return data !== null && typeof data === 'object' ? data : {}
    } catch {
      return {}
    }
  }

  function writeGroupNames(map) {
    try {
      mkdirSync(dirname(groupNamesPath), { recursive: true })
      writeFileSync(`${groupNamesPath}.${process.pid}.tmp`, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 })
      renameSync(`${groupNamesPath}.${process.pid}.tmp`, groupNamesPath)
    } catch {
      /* best effort */
    }
  }

  return { readGroupNames, writeGroupNames }
}
