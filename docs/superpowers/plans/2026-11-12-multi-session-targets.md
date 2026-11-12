# 多会话通知目标 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全局默认和每个模组均可选择最多 20 个 QQ 群聊／私聊会话，并可靠地逐目标投递。

**Architecture:** 功能运行时解析有效目标组，按顺序对每个目标调用现有单目标 provider；内置模组按 session ID 分离去重与冷却。前端共用一个多选目标控件，旧字符串配置在读入时迁移为数组。

**Tech Stack:** Node.js ES modules、`node:test`、React 运行时组件、esbuild。

**Spec:** `docs/superpowers/specs/2026-11-12-multi-session-targets-design.md`

## Global Constraints

- 私聊必须来自现有 QQ Bot peer 映射及会话列表；群不可用时跳过该目标但继续其他目标。
- 全局 `defaultTargetSessionIds` 与模组 `target.sessionIds` 各最多 20 个，旧单目标配置自动迁移。
- 模组非空目标组整体覆盖全局；扩展模组 provider 接口仍接收单个 `target.sessionId`。
- 不把「已提交」或「已调用上游发送」称为 QQ 送达。

## Review Focus

- 旧全局／模组单目标及旧 `seen`、闲聊冷却正确归属原会话。
- 一个目标失败时其他目标继续，已成功的赛事及分段不会在重试时重复。
- 手动重发逐目标执行，自动运行保持 CS2 规则间 30 秒错峰。
- 失效目标可从控件移除，但无法重新勾选；刷新候选不清除未保存选择。
- 窄侧栏、私聊标签、键盘焦点与禁用状态均可用。

---

### Task 1: 配置与逐目标运行

**Files:** `features.js`, `modules/cs2-matches/provider.js`, `tests/default-target.test.js`, `tests/cs2-send.test.js`, `tests/chat.test.js`, `tests/module-discovery.test.js`

**Interfaces:** `settings.defaultTargetSessionIds: string[]`；`feature.target.sessionIds: string[]`；单次 provider 仍收 `target.sessionId`；`result.targetResults` 包含逐目标结果。

- [x] 写迁移、数组校验、继承覆盖、私聊／群聊混合及部分失败测试。
- [x] 运行相关测试，确认因旧单目标语义失败。
- [x] 实现读写迁移、逐目标状态、顺序调用与结果汇总；CS2 分段部分成功须向运行时报告已提交数量。
- [x] 运行相关测试，确认通过。

### Task 2: 共用多选控件与四处接入

**Files:** `client/session-options.js`, `client/target-picker.js`（新增）, `client/global-target-settings.js`, `client/extension-card.js`, `modules/cs2-matches/card.js`, `modules/casual-chat/card.js`, `client/main.js`, `tests/session-options.test.js`, `tests/global-target-settings.test.js`, `tests/client-render.test.js`

**Interfaces:** `TargetPicker` 接收 sessions、选中 ID 数组、onChange、onRefreshSessions，以及可选继承入口；返回含搜索、勾选列表、已选标签和刷新按钮的控件。

- [x] 写多选过滤、失效目标、继承和保存 payload 测试并确认失败。
- [x] 实现共用控件、选项计算与四处接入；即时刷新保留未保存选择。
- [x] 运行相关测试，确认通过。

### Task 3: 文档、构建与回归

**Files:** `README.md`, `modules/cs2-matches/README.md`, `modules/casual-chat/README.md`, `client.js`（构建生成）。

- [x] 更新用户说明与扩展模组运行契约。
- [x] 运行 `npm test`、`npm run build` 与 `git diff --check`，检查生成的 `client.js`、完整 diff 和未跟踪文件。
