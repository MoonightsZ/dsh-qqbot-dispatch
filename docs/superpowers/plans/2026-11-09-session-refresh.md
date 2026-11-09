# QQ Session Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 准确展示 QQ 会话并及时更新模组目标选项。

**Architecture:** 从上游 peer 映射关联宿主会话数据；本地列表读取与 QQ 群名同步分离。客户端共享会话快照，按用户操作和页面可见性重读。

**Tech Stack:** Node.js ESM、React、node:test。

**Spec:** `docs/superpowers/specs/2026-11-09-session-refresh-design.md`

## Global Constraints

- 中文界面，UTF-8 无 BOM。
- 不新增运行时依赖。

## Review Focus

- QQ 会话工作目录与插件进程不同：仍须显示。
- 未映射的非 QQ 会话：不得显示为可选目标。
- 上游更换会话 ID 后旧群名缓存：不得决定当前目标。
- QQ 凭据缺失：本地刷新仍须工作。
- 下拉框刷新期间：保留现有选项并防止旧响应覆盖新响应。

---

### Task 1: 修正服务端会话归属

**Files:** `routes.js`, `tests/routes.test.js`, `delivery.js`, `tests/delivery.test.js`

- [x] 为不同工作目录、未映射会话及旧缓存写失败测试并运行。
- [x] 用当前 peer 映射关联宿主会话，限制群名缓存和直发路径。
- [x] 运行相关测试直至通过。

### Task 2: 拆分刷新和更新下拉框

**Files:** `client/main.js`, `client/tables.js`, `modules/cs2-matches/card.js`, `modules/casual-chat/card.js`, `client/session-options.js`, `tests/session-options.test.js`

- [x] 为下拉选项与失效目标写失败测试并运行。
- [x] 增加单独的本地刷新、可见时刷新及目标下拉框刷新，保留旧数据并处理请求顺序。
- [x] 运行全部测试与构建，检查差异。
