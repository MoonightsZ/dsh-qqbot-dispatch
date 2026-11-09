# CS2 服务回合生成模式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 CS2 通知提供可选的服务回合生成模式和可编辑 Markdown 模板。

**Architecture:** CS2 配置增加独立投递模式及模板；赛事 provider 继续负责数据筛选，按模式选择现有直发路径或按赛事提交模板化服务回合。服务回合沿用当前映射与群状态守卫。

**Tech Stack:** Node.js ESM、React、node:test。

**Spec:** `docs/superpowers/specs/2026-11-09-cs2-service-turn-template.md`

## Global Constraints

- UTF-8 无 BOM，不新增运行时依赖。
- 不修改上游 QQ Bot 插件；旧 CS2 配置默认沿用现有直发模式。
- “已提交服务回合”不得写成“QQ 已送达”。

## Review Focus

- 旧配置读取和保存后仍使用 `direct`。
- 服务回合只根据选中赛事生成模板资料，不调用 QQ 直发。
- 用户模板缺少对局、焦点分析或来源占位符时保存失败，错误可见。
- 焦点分析指令不得鼓励编造缺失的战绩、阵容或胜率。
- 无赛事、重复赛事及群不可用时延续原有行为。

---

### Task 1: 配置与模板

**Files:** `modules/cs2-matches/template.js`, `features.js`, `tests/cs2-template.test.js`

- [x] 写失败测试覆盖默认模板、模式往返、无效模板。
- [x] 实现模板常量、校验和 CS2 状态读写。
- [x] 运行定向测试。

### Task 2: 投递与焦点数据

**Files:** `modules/cs2-matches/provider.js`, `index.js`, `tests/cs2-send.test.js`

- [x] 写失败测试覆盖服务回合模式、对局资料、无赛事及去重。
- [x] 生成赛事事实和模板化任务，按模式选择投递入口。
- [x] 运行定向测试。

### Task 3: 设置界面与说明

**Files:** `modules/cs2-matches/card.js`, `client/theme.js`, `tests/client-render.test.js`, `README.md`, `client.js`

- [x] 写失败测试覆盖模式选择、模板编辑、保存载荷。
- [x] 增加设置区和恢复默认模板按钮。
- [x] 运行全量测试、构建和差异检查。
