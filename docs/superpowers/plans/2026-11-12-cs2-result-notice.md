# CS2 赛果提醒实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立的 CS2 赛果提醒，只发送最近 6 小时内明确完赛且有有效比分的比赛。

**Architecture:** 现有 MediaWiki 解析器补充状态与比分；`result` 规则复用 `noticeRules` 调度和全局投递，使用独立去重键和赛果模板。页面增加第三张规则卡片与模板/固定内容预览。

**Tech Stack:** Node.js ESM、node:test、React createElement。

**Spec:** `docs/superpowers/specs/2026-11-12-cs2-result-notice-design.md`

## Global Constraints

- 仅 `data-finished="finished"` 且双方数字比分有效、总分大于零时发送；不得把进行中比分当赛果。
- 默认关闭，每 15 分钟检查；开赛时间必须在最近 6 小时内，因为公开接口没有完赛时间。
- 旧配置迁移不启用新规则；保留原两种通知、目标、过滤、投递和模板行为。
- 发送失败不写去重记录；QQ 送达仍需与服务回合提交区分。
- 保留已有未跟踪的 `docs/notes/`，不纳入改动。

## Review Focus

- 页面中同时出现已完赛和进行中的数字比分时，只选择已完赛场次。
- 完赛但比分缺失、`vs`、`0:0` 或格式损坏时跳过。
- 刚好 6 小时和未来时间的比赛边界正确。
- 已发赛前提醒的比赛仍可发赛果，重复赛果检查不再发送。
- 发送第二段失败时，重试只补未成功的场次。

---

### Task 1: 解析与独立规则

**Files:** `modules/cs2-matches/provider.js`, `modules/cs2-matches/rules.js`, `features.js`, `tests/cs2-provider.test.js`, `tests/cs2-rules.test.js`

**Interfaces:** `parseMatches(html)` 增加 `finished:boolean`、`scoreA:number|null`、`scoreB:number|null`；规则 ID 为 `result`。

- [x] 写完成、进行中、无效比分解析测试及默认/迁移测试，运行相关测试确认失败。
- [x] 补充解析与 `result` 默认关闭的规则，运行相关测试确认通过。

### Task 2: 赛果内容与投递

**Files:** `modules/cs2-matches/provider.js`, `modules/cs2-matches/template.js`, `features.js`, `tests/cs2-send.test.js`, `tests/cs2-template.test.js`

**Interfaces:** `composeCs2ResultSections(matches, tiers, timeZone)` 返回既有 section 结构及 `resultsMarkdown`；`DEFAULT_CS2_RESULT_TEMPLATE`、`validateCs2ResultTemplate`；服务回合 `composeCs2ServiceTurnPrompt(..., 'result')`。

- [x] 写筛选、6 小时边界、独立去重、重发、失败重试和模板测试，确认失败。
- [x] 实现赛果分组、独立去重与模板，确认相关测试通过。

### Task 3: 页面与文档

**Files:** `modules/cs2-matches/card.js`, `modules/cs2-matches/README.md`, `client.js`, `tests/client-render.test.js`

**Interfaces:** 第三张 `result` 规则卡片，赛果模板选择与固定内容预览。

- [x] 写页面渲染和独立规则操作测试，确认失败。
- [x] 实现页面、预览及说明。
- [x] 运行 `npm test`、`npm run build`、`git diff --check`，检查完整 diff。
