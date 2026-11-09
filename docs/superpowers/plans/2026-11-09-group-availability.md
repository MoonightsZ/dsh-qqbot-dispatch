# QQ Group Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 已确认不可用的 QQ 群不再收到通知任务，且可在恢复后重新启用。

**Architecture:** 持久化群状态并以当前 peer 映射校验；QQ API 的永久不可达结果更新状态；服务回合统一入口守卫；会话 API 将状态传给目标下拉框。

**Tech Stack:** Node.js ESM、React、node:test。

**Spec:** `docs/superpowers/specs/2026-11-09-group-availability-design.md`

## Global Constraints

- UTF-8 无 BOM，不新增运行时依赖。
- 不修改或删除上游 `model-prefs.json` 和会话历史。

## Review Focus

- 群消息发送 HTTP 404：暂停并保留可见会话；群信息查询 404 不改变状态。
- 限流和 HTTP 5xx：继续允许后续重试。
- 映射换成新 sessionId：旧状态不能误伤新会话。
- 群信息查询成功：恢复可选状态。
- CS2 直发和闲聊服务回合：都不得绕过暂停状态。

---

### Task 1: 持久化可用状态与 API 错误分类

**Files:** `group-health.js`, `qqbot-creds.js`, `tests/group-health.test.js`

- [x] 写失败测试并确认错误原因。
- [x] 实现状态读写与 HTTP 状态记录。
- [x] 运行相关测试。

### Task 2: 守卫所有发送路径

**Files:** `delivery.js`, `service-turn.js`, `index.js`, `tests/delivery.test.js`, `tests/service-turn.test.js`

- [x] 写直发 404 与服务回合阻断的失败测试。
- [x] 接入共享状态，临时错误保留原有回退。
- [x] 运行相关测试。

### Task 3: 同步状态与界面展示

**Files:** `routes.js`, `client/session-options.js`, `client/tables.js`, `client/main.js`, `tests/routes.test.js`, `tests/session-options.test.js`

- [x] 写同步失败和目标过滤的失败测试。
- [x] 展示群不可用状态，成功同步恢复。
- [x] 运行全量测试、构建并检查差异。
