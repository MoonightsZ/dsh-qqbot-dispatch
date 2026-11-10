import { MAX_TOPIC_LENGTH } from './topics.js'

export async function listTopicModels(llm) {
  if (typeof llm?.listProviders !== 'function' || typeof llm?.listModels !== 'function') return []
  const providers = llm.listProviders()
  const catalogs = await Promise.all(providers.map(async (provider) => {
    try {
      const models = await llm.listModels(provider.id)
      return models.map((model) => ({ provider: provider.id, model: model.id, label: `${provider.name} · ${model.name}` }))
    } catch {
      return []
    }
  }))
  return catalogs.flat()
}

export async function recommendTopics(llm, { keyword, provider, model }) {
  if (typeof llm?.stream !== 'function') throw new Error('模型服务不可用')
  const theme = String(keyword ?? '').trim()
  if (!theme || theme.length > 80) throw new Error('请输入不超过 80 字的主题词')
  if (!provider || !model) throw new Error('请选择推荐模型')
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 30_000)
  let output = ''
  let finished = false
  try {
    for await (const chunk of llm.stream({
      provider, model, maxTokens: 600, temperature: 0.8, signal: abort.signal,
      system: '你是 QQ 群聊开场白编辑。根据用户给的主题词生成 3 到 5 条不同的简短自然问句，每条可以直接发给群友；不编造新闻、比赛结果、个人近况；只输出 JSON 字符串数组，不加解释。',
      messages: [{ role: 'user', content: [{ type: 'text', text: `主题词：${theme}` }] }],
    })) {
      if (chunk.type === 'text-delta') {
        output += chunk.text
        if (output.length > 8192) throw new Error('模型回复过长')
      }
      if (chunk.type === 'finish') {
        if (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted') throw new Error(`模型推荐失败：${chunk.reason.failure?.message ?? chunk.reason.kind}`)
        finished = true
      }
    }
  } finally {
    clearTimeout(timeout)
  }
  if (!finished) throw new Error('模型回复未完成')
  let parsed
  try { parsed = JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) } catch { throw new Error('模型返回的候选格式无效') }
  if (!Array.isArray(parsed)) throw new Error('模型返回的候选格式无效')
  const topics = [...new Set(parsed.map((item) => typeof item === 'string' ? item.trim() : '').filter((item) => item && item.length <= MAX_TOPIC_LENGTH))].slice(0, 5)
  if (topics.length === 0) throw new Error('模型没有生成可用的话题')
  return topics
}
