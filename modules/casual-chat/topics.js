export const DEFAULT_TOPICS = ['最近有什么有趣的事？', '今天过得怎么样？', '最近有没有想聊的话题？']
export const MAX_TOPICS = 50
export const MAX_TOPIC_LENGTH = 120
export const MAX_TAGS = 5

export function normalizeTopics(raw) {
  const items = Array.isArray(raw) ? raw : String(raw ?? '').split(/[|\n]+/)
  const seenText = new Set()
  const seenIds = new Set()
  const result = []
  for (const [index, item] of items.entries()) {
    const source = typeof item === 'string' ? { text: item } : item && typeof item === 'object' ? item : {}
    const text = String(source.text ?? '').trim()
    if (!text || text.length > MAX_TOPIC_LENGTH || seenText.has(text)) continue
    const tags = [...new Set((Array.isArray(source.tags) ? source.tags : [])
      .map((tag) => String(tag).trim()).filter((tag) => tag && tag.length <= 30))].slice(0, MAX_TAGS)
    let id = String(source.id ?? '').trim().slice(0, 80) || `legacy-${index}`
    if (seenIds.has(id)) {
      id = `legacy-${index}`
      while (seenIds.has(id)) id += '-duplicate'
    }
    seenIds.add(id)
    seenText.add(text)
    result.push({ id, text, tags, sourceKeyword: String(source.sourceKeyword ?? '').trim().slice(0, 80), enabled: source.enabled !== false })
    if (result.length >= MAX_TOPICS) break
  }
  return result
}

export function topicPool(raw) {
  const topics = normalizeTopics(raw)
  if (topics.length > 0) return topics.filter((topic) => topic.enabled)
  if ((Array.isArray(raw) && raw.length > 0) || (typeof raw === 'string' && raw.trim() !== '')) return []
  return DEFAULT_TOPICS.map((text, index) => ({ id: `builtin-${index}`, text, tags: [], sourceKeyword: '', enabled: true }))
}

function draw(random, length) {
  return Math.min(length - 1, Math.max(0, Math.floor(random() * length)))
}

export function pickTopic(raw, lastTopicId, random = Math.random) {
  const pool = topicPool(raw)
  if (pool.length === 0) return null
  const eligible = pool.length > 1 ? pool.filter((topic) => topic.id !== lastTopicId) : pool
  const topics = eligible.length > 0 ? eligible : pool
  const tags = [...new Set(topics.flatMap((topic) => topic.tags.length ? topic.tags : ['未分类']))]
  const tag = tags[draw(random, tags.length)]
  const candidates = topics.filter((topic) => (topic.tags.length ? topic.tags : ['未分类']).includes(tag))
  const weights = candidates.map((topic) => 1 / (topic.tags.length || 1))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let value = random() * total
  for (let index = 0; index < candidates.length; index += 1) {
    value -= weights[index]
    if (value < 0) return candidates[index]
  }
  return candidates[candidates.length - 1]
}
