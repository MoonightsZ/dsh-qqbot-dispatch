# dsh-tool-qqbot-dispatch

DSH 插件：把任务下发到 `@tencent-connect/dsh-qqbot` 创建的 QQ 会话，并在左侧边栏提供一个「QQ 会话」页面。

## 组成

| 文件 | 作用 |
|---|---|
| `index.js` | 插件入口：`qqbot_dispatch` / `qqbot_sessions` 两个工具，`/qqbot-tool-dispatch/*` 只读路由，功能调度与 QQ 直发 |
| `features.js` | 功能开关运行时：状态文件、间隔/Cron 调度、数据源与凭证引用 |
| `liquipedia.js` | CS2 赛事数据源：拉取 Liquipedia 赛程、按队伍/等级过滤、去重、Markdown/卡片模板 |
| `qqbot-creds.js` | 复用 profile 中 `im-qqbot` 的 appId/appSecret 换 access_token，调用 v2 群接口 |
| `client.js` | Web 页面：会话 Tab（列表/状态）+ 功能 Tab（开关/配置） |
| `cordis.patch.yml` | bundle 补丁：插入 `tool-qqbot-dispatch` 行 |

## 安装

```bash
dsh plugin --profile web add /abs/path/to/dsh-tool-qqbot-dispatch
```

并在 profile 的 `cordis.patch.yml` 增加：

```yaml
- insert:
    - id: tool-qqbot-dispatch
      name: 'dsh-tool-qqbot-dispatch'
      config: { appId: '<QQ Bot AppID>' }
```

选中 bundle（`plugin_manager set_bundle`）后重启一次 Harness，左侧边栏出现「QQ 会话」。

## 工具

- `qqbot_dispatch(scope, peerId, text, mode?)`：按 `c2c|group` + openid 解析 sessionId 并投递一条用户消息；
- `qqbot_sessions(scope?, peerId?)`：解析/列出 peer→sessionId 映射。

## 页面

- **会话**：已建会话（标题/真实群名、活跃/休眠、最后活动）、peer 映射；
- **功能**：CS2 赛事通知（数据源、关注队伍、赛事等级、目标会话、间隔/Cron、焦点战卡片开关、保存/立即检查）。

## 数据与凭证

- 状态：`~/.dsh-qqbot/dispatch-features.json`；
- 群名缓存：`~/.dsh-qqbot/group-names.json`；
- API Key：写入宿主凭证服务（引用 `QQBOT_DISPATCH_CS2_MATCHES_API_KEY`），不落状态文件；
- QQ Bot 凭据直接读 profile 的 `im-qqbot` 行，不复制 secret。

## 已知限制

- qqbot 不持久化群/私聊 openid：群名需要查一次 `group-info` 学习绑定；
- 主动消息受平台频控（群聊 60 qpm、每群每天 1000 条），失败会回退到「写入会话」；
- 路线 A 的下发依赖会话是否活跃：休眠会话能跑但不会回 QQ。

## 测试

- 卡片/列表模板可在本地用 `createLiquipediaProvider({ deliver })` 注入假 deliver 预览，不触网发送。
