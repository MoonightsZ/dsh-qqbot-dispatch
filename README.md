# dsh-qqbot-dispatch

**中文展示名称：QQ 机器人 · 通知助手。**

本插件是 `@tencent-connect/dsh-qqbot` 的社区补充，可向 QQ 机器人建立的群聊或私聊会话下发任务，并在 DSH 侧栏查看会话、管理可自定义的功能模组。内置模组包括 CS2 赛事通知和偶尔闲聊，也可按需添加其他模组。

## 安装

先安装并配置 `@tencent-connect/dsh-qqbot`，再加入本插件：

```bash
dsh plugin --profile web add /abs/path/to/dsh-qqbot-dispatch
```

在 profile 的 `cordis.patch.yml` 为本插件指定与 qqbot 相同的 AppID：

```yaml
- insert:
    - id: qqbot-dispatch
      name: 'dsh-qqbot-dispatch'
      config:
        appId: '<QQ Bot AppID>'
```

启用包含此补丁的 bundle，重启 Harness 后，侧栏会出现「QQ 机器人 · 通知助手」。如果已有旧配置，将 `tool-qqbot-dispatch` 行的 `id` 和包 `name` 一并更新；工具名称及 `/qqbot-tool-dispatch/*` 路径保持兼容。

## 使用说明

### 下发任务

插件提供两个工具：

| 工具 | 用途 |
| --- | --- |
| `qqbot_dispatch` | 向指定 QQ 群聊或私聊会话提交一项任务。接受后立即返回，不等待目标回合完成或把回复带回当前会话。 |
| `qqbot_sessions` | 列出 QQ Bot 已记录的会话映射；传入 `scope` 和 `peerId` 时解析单个目标。 |

`qqbot_dispatch` 的参数：

| 参数 | 说明 |
| --- | --- |
| `scope` | 必填。`group` 表示群聊，`c2c` 表示私聊。 |
| `peerId` | 必填。群聊填 group openid，私聊填用户 openid。 |
| `text` | 必填。提交给目标会话的任务内容。 |
| `mode` | 可选。`queue` 排队，`steer` 插入进行中的回合；默认 `queue`。 |

例如，向群聊下发任务：

```json
{"scope":"group","peerId":"<group_openid>","text":"整理今天的讨论重点","mode":"queue"}
```

### 会话管理

侧栏「会话」页显示 QQ Bot 已映射会话的标题和活跃状态。页面可见时每 20 秒重读列表，目标会话下拉框获得焦点时也会刷新选项。

| 操作 | 效果 |
| --- | --- |
| 刷新会话 | 只读取本地会话数据。 |
| 同步群名 | 向 QQ 平台查询群信息并更新会话标题。 |

### 功能模组

「功能」页采用模组导航与配置区；配置区较窄时导航移到上方。切换模组不会清空尚未保存的表单。模组的「目标会话」留空时继承「配置」页的全局默认目标；也可为模组单独指定会话。

| 模组 | 用途 | 详细说明 |
| --- | --- | --- |
| CS2 赛事通知 | 按队伍和等级筛选赛程，提供每日汇总与赛前提醒。 | [查看模组说明](./modules/cs2-matches/README.md) |
| 偶尔闲聊 | 按概率、小时冷却和安静时段，偶尔在指定会话发起聊天。 | [查看模组说明](./modules/casual-chat/README.md) |

### 全局默认目标会话

在「配置」页选择默认目标后，未单独指定目标的模组会继承该会话。页面会列出继承此设置的模组；修改默认目标会影响这些模组，已有独立目标保持不变。若已启用的模组仍在继承，须先为其指定独立目标或关闭模组，才能清空默认目标。

### 全局投递配置

「配置」页的开关作用于所有功能模组：

| 模式 | CS2 赛事通知 | 偶尔闲聊 |
| --- | --- | --- |
| 服务回合投递（默认） | 固定赛事内容由 Agent 尽量原样输出；选择“AI 焦点分析”时，Agent 填充模板并生成分析。 | Agent 结合会话上下文生成开场白。 |
| 直接发送 Markdown | 调用上游 Bot 实例的 `sendMarkdown` 发送固定赛事正文；模板和焦点分析暂不生效。 | 将选中的话题作为开场白原文发送。 |

全局设置保存在 `~/.dsh-qqbot/dispatch-features.json` 的 `settings.defaultTargetSessionId` 和 `settings.deliveryMethod` 中。各投递方式的限制见下方「资料与限制」。

## 常见问题

<details>
<summary>为什么直接发送提示“尚未取得 QQ Bot 实例”？</summary>

“直接发送 Markdown”需要先捕获 QQ Bot 的运行实例。启动或重启插件后，让机器人收到一条 QQ 消息即可；向目标群发送一条普通消息最方便，私聊会话则向机器人发送私聊消息。随后再尝试“立即发送”。每次进程重启后都需要重新收到一条消息。

</details>

<details>
<summary>使用服务回合投递也需要先发消息吗？</summary>

服务回合投递不依赖上述实例。若目标会话已由 QQ Bot 建立并记录，可直接选用；新群聊或私聊仍需先给机器人发消息，让目标会话出现在列表中。

</details>

## 资料与限制

### 数据存放

| 数据 | 位置或来源 |
| --- | --- |
| 功能状态、全局默认目标与投递设置 | `~/.dsh-qqbot/dispatch-features.json` |
| 群名缓存、群可用状态 | `~/.dsh-qqbot/group-names.json`、`~/.dsh-qqbot/group-health.json` |
| 数据源 API Key | 宿主凭证服务；不写入功能状态文件。 |
| QQ Bot 的 AppID／AppSecret | profile 中的 `im-qqbot` 配置。 |

### 本插件的设计边界

| 事项 | 当前行为 |
| --- | --- |
| 会话目标 | 以 QQ Bot 的 `model-prefs.json` 当前 peer 映射为准；群名缓存只用于展示。不存在或已归档的会话不进入目标下拉框。服务回合和直接发送均拒绝未记录的映射，不把派生 session ID 当作已确认的 QQ 对象。 |
| 直接发送的 Bot 实例 | 通过运行时包装上游入站方法取得；启动后须先收到一条 QQ 消息。未取得实例时会报错，不会把赛事记为已通知。该模式依赖上游内部方法，版本变化时可能需要适配；`qqbot_send_file` 只用于附件，不发送聊天文字。 |
| 结果记录 | 服务回合显示「已提交」，直接发送显示「已调用上游发送」；这两种状态都不是 QQ 客户端的送达确认。 |
| 群不可用状态 | 群消息接口返回 HTTP 404 时，暂停该目标的赛事通知和闲聊，并从目标选项中排除；保留历史与配置。成功同步群名后恢复。查询失败、限流、超时或 HTTP 5xx 不会触发暂停。 |
| 扩展模组 | 启动时扫描 `modules/*/module.json`，新增模组默认关闭；关闭的扩展模组不能自动运行或手动试运行，也不会加载其 `provider.js`。启用后模组代码与 DSH 同进程运行，关闭开关不能卸载已加载的代码，须重启进程。此机制不提供进程隔离，只应启用已检查来源和代码的模组。 |

### 上游 DSH／QQ Bot 决定的行为

| 事项 | 影响 |
| --- | --- |
| 外部回合 | `qqbot_dispatch` 提交外部回合；QQ 回复是否主动推送由上游 `proactiveDelivery.externalTurns` 控制。 |
| 服务回合 | 默认通知会恢复目标 Agent，提交来源为 `plugin:dsh-qqbot-dispatch` 的服务回合；这类回合不受 `externalTurns` 控制。提交和持久化成功只代表任务已受理，不代表 QQ 已送达。 |

### QQ 平台决定的限制

| 事项 | 影响 |
| --- | --- |
| 主动消息权限与频率 | 服务回合推送和直接 `sendMarkdown` 都受 QQ 平台的权限、额度与频率限制；切换投递方式不能绕过。 |
| 群接口返回 404 | 仅凭 HTTP 404 无法区分群解散与机器人被移出，插件统一显示为「群不可用」。 |

## 开发说明

### 代码结构

```text
.
├── index.js                     插件入口，组装服务、模组与路由
├── module-discovery.js          扫描模组清单，按需加载扩展代码
├── features.js                  全局配置、模组状态与排程
├── routes.js                    设置与会话接口
├── notification-dispatcher.js   全局通知投递策略
├── service-turn.js              服务回合投递
├── upstream-sender.js           调用上游 Bot 实例发送 Markdown
├── modules/
│   ├── cs2-matches/             CS2 赛事通知：定义、数据处理、模板与设置卡片
│   └── casual-chat/             偶尔闲聊：定义、触发逻辑与设置卡片
├── client/                      侧栏页面源码，含扩展模组通用配置卡片
├── client.js                    构建生成的前端文件
├── scripts/build.mjs            前端构建脚本
└── tests/                       模组、投递策略、路由与界面测试
```

### 扩展功能模组

插件启动时扫描 `modules/` 的直属子目录。每个扩展模组遵循以下结构：

```text
modules/<模组 ID>/
├── module.json     清单：id、名称、说明、配置字段和默认排程
├── provider.js     导出 createProvider(options)，返回异步运行函数
└── README.md       可选的功能说明
```

`module.json` 只接受清单字段，扫描时不会执行模组代码。目录名须与清单 `id` 一致；新目录需要重启插件才能被发现。设置页使用通用配置卡片，不读取扩展模组的浏览器脚本。扩展模组不需要单独的 `cordis.patch.yml`：插件包根目录的补丁负责加载整个插件。

`createProvider({ notificationDispatcher })` 返回的函数接收 `{ feature, settings, target, ctx, now, manual, forceResend }`，返回 `{ matched, sent, error?, channel? }`。新增模组默认关闭；只有用户手动启用后，调度或“立即运行”才会首次加载 `provider.js`。模组可通过 `notificationDispatcher` 遵循全局投递方式。内置的 CS2 与闲聊模组仍保留各自的专用设置卡片和 provider。

统一接口便于校验清单和控制启停，但不是安全沙箱。`provider.js` 是普通 Node.js 代码，一旦加载便拥有宿主进程的权限；只应安装并启用自己检查过来源和代码的模组。若要运行未经审核的第三方代码，需另行设计进程隔离与能力限制。

### 本地验证

```bash
npm install --legacy-peer-deps
npm test
npm run build
```

## 相关项目与设计参考

| 项目 | 借鉴点 |
| --- | --- |
| [dsh-context](https://github.com/bowenliang123/dsh-context) | 使用 DSH 语义主题变量组织紧凑的信息卡与控件状态。 |
| [dsh-guizang-design](https://github.com/op7418/dsh-guizang-design) | 用清晰标题、细线和留白区分页面层级。 |
| [dsh-media-desk](https://github.com/woniuniuniu/dsh-media-desk) | 响应式布局、统一的控件反馈与明暗主题适配。 |
| [dsh-qqbot-expands](https://github.com/TONG5395/dsh-qqbot-expands) | 运行时包装上游入站方法，取得 Bot 实例。 |

## 免责声明与许可

本项目是社区独立开发的非官方插件，与腾讯、DeepSeek 及 `@tencent-connect/dsh-qqbot` 的维护方无隶属关系，不代表其官方立场。

使用本插件即表示你已阅读并遵守 QQ 开放平台的相关规则。因违反平台规则而产生的后果，由使用者自行承担。

本项目采用 [MIT 许可证](./LICENSE) 开源。软件按许可证“原样”提供，不附带任何明示或默示担保。
