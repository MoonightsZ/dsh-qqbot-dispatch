# 偶尔闲聊话题池实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将闲聊话题改为可多标签管理的列表，支持按主题词生成候选并手选入池，同时平衡标签抽取。

**Architecture:** `topics.js` 管理规范化、旧配置迁移与抽取；模组设置和运行继续由现有 `features.js`、`provider.js` 管理。独立的推荐服务调用宿主 `ctx.llm`，路由只处理输入校验与返回，前端只保存用户选中的候选。

**Tech Stack:** Node.js ESM、内置测试运行器、React `createElement`、DSH `ctx.llm`。

**Spec:** `docs/superpowers/specs/2026-11-10-casual-chat-topic-pool-design.md`

## Global Constraints

- 旧 `|` / 换行分隔配置必须迁移；自定义池为空才使用内置话题。
- 直接发送原文；AI 候选不自动入池、不经 QQ 服务回合生成。
- 不改变每日触发、概率、冷却和安静时段。
- 文档、界面用简体中文；文件 UTF-8 无 BOM。

## Review Focus

- 全部禁用时不能退回内置话题；Task 1 测试。
- 多标签话题不能随标签数线性增加抽中机会；Task 2 测试。
- 上次发送失败不能更新上次话题；Task 2 测试。
- 模型不可用、无模型与模型输出格式错误时应清晰失败；Task 3 测试。
- 候选未保存前不能参与发送；Task 4 测试配置流。

---

### Task 1: 话题数据与迁移

**Files:** `modules/casual-chat/topics.js`, `features.js`, `module-discovery.js`, `modules/casual-chat/definition.js`, `modules/casual-chat/module.json`, `tests/chat-topics.test.js`, `tests/module-discovery.test.js`

**Interfaces:** `normalizeTopics(raw)` 返回话题数组，`configuredTopics(raw)` 返回可抽取池与是否为空；数组元素为 `{ id, text, tags, sourceKeyword, enabled }`。

- [x] 写旧字符串迁移、多标签规范化、全禁用与限额测试，确认先失败。
- [x] 实现数据层及 `features.js` 保存和读取兼容，确认测试通过。

### Task 2: 抽取与投递

**Files:** `modules/casual-chat/topics.js`, `modules/casual-chat/provider.js`, `tests/chat.test.js`, `tests/chat-topics.test.js`

**Interfaces:** `pickTopic(topics, lastTopicId, random)` 返回话题对象或 `null`；随机源可注入。

- [x] 写标签优先、逆标签数权重、避开上次、发送失败不更新记录测试，确认先失败。
- [x] 实现抽取并接入两种投递，确认测试通过。

### Task 3: AI 候选服务与路由

**Files:** `modules/casual-chat/recommend.js`, `routes.js`, `tests/chat-recommend.test.js`, `tests/routes.test.js`

**Interfaces:** `recommendTopics(llm, { keyword, provider, model })` 返回去重后的候选文本数组；新增模型目录 GET 和推荐 POST 路由。

- [x] 写模型发现、输入与同源校验、模型失败、候选解析测试，确认先失败。
- [x] 使用宿主 `ctx.llm` 的已注册提供方与模型完成一次受限请求，确认测试通过。

### Task 4: 设置界面与文档

**Files:** `modules/casual-chat/card.js`, `client/main.js`, `modules/casual-chat/README.md`, `tests/client-render.test.js`

- [x] 写列表、AI 候选手选入池、保存前不生效的组件测试，确认先失败。
- [x] 实现列表编辑、标签、筛选、推荐、候选选择与错误提示，更新模组说明。
- [x] 运行相关测试、`npm test`、`npm run build`，检查完整 diff、编码与生成的 `client.js`。
