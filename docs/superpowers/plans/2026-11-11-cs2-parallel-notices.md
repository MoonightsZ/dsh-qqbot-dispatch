# CS2 并行通知规则实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每日赛程汇总和赛前提醒可独立配置并同时自动运行。

**Architecture:** CS2 模组的 `noticeRules` 承载两条规则的计划与状态，通用运行时顺序执行到期规则，provider 显式接收通知模式。页面展示独立规则面板，旧单选配置迁移到对应规则。

**Tech Stack:** Node.js ESM、node:test、React createElement。

**Spec:** `docs/superpowers/specs/2026-11-11-cs2-parallel-notices.md`

## Global Constraints

- 旧配置只启用原通知方式；新配置模组总开关默认关闭。
- 同一比赛允许先汇总、再赛前提醒；两条规则的去重与运行记录独立。
- 共用数据源、筛选、目标会话与全局投递链路。
- 保留旧版通知兼容；`docs/notes/` 已有未追踪文件不纳入改动。

## Review Focus

- 同一分钟两规则都到期时应各执行一次。
- 旧版配置迁移不能突然多发第二种通知。
- 两条规则立即发送各自重发，互不修改对方运行记录。
- 同一赛事在汇总后仍可赛前提醒。
- 重启后每条规则的计划与结果仍可读取。

---

### Task 1: 规则状态与迁移

**Files:** `modules/cs2-matches/rules.js`, `features.js`, `tests/cs2-rules.test.js`

- [x] 写新旧配置与保存读取测试，确认失败。
- [x] 实现独立规则的默认值、迁移、校验与快照，确认通过。

### Task 2: 并行调度和投递

**Files:** `features.js`, `routes.js`, `modules/cs2-matches/provider.js`, `tests/cs2-rules.test.js`, `tests/routes.test.js`

- [x] 写两规则同分钟运行、独立状态、手动指定模式、重叠赛事测试，确认失败。
- [x] 实现按规则到期判断、顺序执行、结果持久化和路由参数，确认通过。

### Task 3: 界面和说明

**Files:** `modules/cs2-matches/card.js`, `modules/cs2-matches/definition.js`, `modules/cs2-matches/README.md`, `tests/client-render.test.js`, `client.js`

- [x] 写独立开关、计划和操作的组件测试，确认失败。
- [x] 替换单选通知方式界面，保留两套模板编辑并更新文档。
- [x] 运行相关测试、全套 `npm test`、`npm run build` 与 diff 检查。
