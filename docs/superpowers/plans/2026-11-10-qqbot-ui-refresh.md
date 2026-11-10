# QQ 机器人通知助手界面优化实施计划

**目标：** 在保留现有功能和配置行为的前提下，统一三页的视觉层级和交互状态，改善窄屏使用。

**设计：** [界面优化设计](../specs/2026-11-10-qqbot-ui-refresh-design.md)

**技术：** React `createElement`、DSH 语义主题变量、现有 esbuild 构建与 Node 测试。

## 任务 1：统一基础样式与导航

- [x] 在 `tests/feature-navigation.test.js` 中加入导航状态的可访问名称检查，确认旧实现缺失。
- [x] 调整 `client/theme.js`、`client/main.js`、`client/feature-navigation.js`：统一间距、色彩、边界、按钮和导航状态，减少重复技术说明。
- [x] 跑对应测试并确认通过。

## 任务 2：优化会话页窄屏布局

- [x] 在 `tests/client-render.test.js` 加入窄屏所需的单元格标签检查，确认旧实现缺失。
- [x] 调整 `client/tables.js` 和 `client/main.js`：宽屏保留表格，窄屏以分块行展示会话信息，操作仍可直接使用。
- [x] 跑会话相关测试并确认通过。

## 任务 3：统一模组表单与全局配置

- [x] 复核现有界面测试对状态、保存与手动运行操作的覆盖。
- [x] 调整 `client/extension-card.js`、`client/theme.js` 和 `client/main.js`，使卡片、字段、反馈与配置说明保持一致。
- [x] 运行 `npm test`、`npm run build`、`git diff --check`，核对修改前已存在的闲聊冷却和 CS2 内容配置变更仍通过。
