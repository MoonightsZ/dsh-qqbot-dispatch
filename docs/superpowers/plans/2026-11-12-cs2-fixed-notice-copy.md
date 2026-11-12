# CS2 固定通知文案 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将三种 CS2 固定通知改为各自明确的赛事分组、对阵卡与胜者播报格式。

**Architecture:** 保留现有赛事筛选、分组、分段和发送路径。仅在 `provider.js` 中构造三种固定 Markdown；服务回合的自定义 AI 模板仍使用原有结构化字段，预览继续调用发送使用的格式化函数。

**Tech Stack:** Node.js ES modules、`node:test`、现有客户端构建脚本。

**Spec:** `docs/superpowers/specs/2026-11-12-cs2-fixed-notice-copy-design.md`

## Global Constraints

- 不调用 AI 生成新文案；不改变通知时机、去重、投递选择或现有 AI 焦点分析功能。
- 只根据已确认的赛事与比分生成结论，保留 Liquipedia 链接与 CC BY-SA 3.0。
- 缺少 Bo 或赛事等级时不显示空标签；长内容继续分段。

## Review Focus

- 同赛事多场提醒须合并且时间顺序稳定。
- 汇总含多个赛事时每组标题与场数准确。
- 赛果比分相等时不得宣称胜者。
- 缺失 Bo 时不得出现 `Bo null` 等字样。
- 预览文本须由实际发送格式化函数生成。

---

### Task 1: 三种固定通知正文

**Files:**
- Modify: `modules/cs2-matches/provider.js`
- Test: `tests/cs2-send.test.js`, `tests/cs2-provider.test.js`

**Interfaces:**
- Consumes: `composeSections(matches, tiers, timeZone)` 返回的赛事分组和结构化字段。
- Produces: `composeDailyDigestSections`、新增赛前固定内容格式化函数、`composeResultSections` 返回带 `markdown` 的分段通知；`previewCs2FixedNotice(mode, timeZone)` 调用同一格式化路径。

- [x] **Step 1: 先写失败测试**：每日汇总按赛事分组；赛前对阵卡含赛事、时间与可用 Bo；赛果比分不等时显示胜者、相等时只显示比分；多场合并与来源标注；预览和发送内容同源。
- [x] **Step 2: 运行相关测试并确认因旧文案而失败**：`node --test tests/cs2-send.test.js tests/cs2-provider.test.js`。
- [x] **Step 3: 实现三种固定正文**：保持 AI 模板使用的 `matchupsMarkdown`、`scheduleMarkdown`、`resultsMarkdown` 字段不变；更新固定 `markdown` 和长内容分段检查。
- [x] **Step 4: 运行相关测试并确认通过**：同 Step 2。

### Task 2: 文档与完整验证

**Files:**
- Modify: `modules/cs2-matches/README.md`
- Test: `tests/client-render.test.js`

**Interfaces:**
- Consumes: Task 1 的实际 Markdown 格式与预览。
- Produces: 与实际通知一致的模组说明。

- [x] **Step 1: 核查并补充页面预览测试**：三个通知预览分别显示对应的固定格式。
- [x] **Step 2: 更新模组说明中的固定内容格式描述**。
- [x] **Step 3: 验证**：`npm test`、`npm run build`、`git diff --check`，检查源码与生成的 `client.js`。
