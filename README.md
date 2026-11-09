# dsh-qqbot-dispatch

**中文展示名稱：QQ 机器人 · 通知助手。**

這是 `@tencent-connect/dsh-qqbot` 的補充插件：向 QQ Bot 建立的會話下發任務，並在 DSH 側欄查看會話與設定 CS2 賽事通知。它會讀取 qqbot 的 peer 對應資料，沿用 profile 中 `im-qqbot` 的憑證。

## 安裝

先安裝並設定 `@tencent-connect/dsh-qqbot`，再加入本插件：

```bash
dsh plugin --profile web add /abs/path/to/dsh-qqbot-dispatch
```

在 profile 的 `cordis.patch.yml` 為本插件指定與 qqbot 相同的 AppID：

```yaml
- insert:
    - id: qqbot-dispatch
      name: 'dsh-qqbot-dispatch'
      config:
        appId: '<QQ Bot AppID>'
```

選中包含此補丁的 bundle，重啟 Harness 後，側欄會出現「QQ 机器人 · 通知助手」。如果已有舊配置，將 `tool-qqbot-dispatch` 行的 `id` 和套件 `name` 一併更新；工具名稱及 `/qqbot-tool-dispatch/*` 路徑保持相容。

## 下發任務

`qqbot_dispatch` 使用 QQ 會話類型、對方的 openid 和任務文字。例如，向群聊下發：

```json
{"scope":"group","peerId":"<group_openid>","text":"整理今天的討論重點","mode":"queue"}
```

`scope` 可為 `group` 或 `c2c`；`mode` 可為 `queue`（排隊）或 `steer`（插入進行中的回合），預設為 `queue`。工具接受任務後即返回，不等待目標回合完成。`qqbot_sessions` 可列出 prefs 中已記錄的 peer 對應，或傳入 `scope` 與 `peerId` 解析單一目標。

側欄「會話」頁以 QQ Bot 當前的 peer 映射顯示會話標題與活躍狀態。「刷新會話」只讀取本地資料；「同步群名」向 QQ 平台查詢群資訊並更新會話標題。頁面可見期間每 20 秒更新會話，下拉框獲得焦點時也會重讀選項。「功能」頁可設定 CS2 賽事通知的資料源、隊伍、賽事等級、目標會話及間隔／Cron，並立即檢查。

「偶尔闲聊」是与 CS2 赛事通知平级的独立模组，默认关闭。开启后每天 19:00（默认 `Asia/Shanghai`）检查一次，默认有 30% 概率发起；安静时段为 22:00–09:00，距上次发送至少 3 天，滚动 7 天最多发送 2 次。目标会话最近 6 小时有活动时会跳过。可修改检查时间、概率、冷却天数、安静时段和话题提示；「立即发起」会先保存当前设置，再跳过自动触发限制。生成开场白的任务通过插件服务回合提交，QQ 实际送达仍受平台限制。

「功能」页使用左侧模组导航和右侧配置区；配置区较窄时导航移到上方。切换模组不会清空尚未保存的表单。CS2 的「立即检查」只发送未通知过的匹配赛事；「立即发送」先保存当前配置，再发送所有匹配赛事，包含已通知过的赛事。两者都显示匹配和发送数量。

CS2 的 Cron 配置使用多个输入框，每条规则独立保存为数组元素。页面会把规则解释为具体执行时间，并显示按设定时区计算的下一次计划执行时间；修改后需保存才会更新该时间。兼容读取旧版用 `;` 分隔的字符串，保存时转为数组。支持五段格式「分 时 日 月 周」，以及 `*`、`*/步长`、数字列表和范围；同时填写日期与星期时，两个条件必须同时满足。

CS2 的“通知投递方式”可选“直发优先”（默认）或“服务回合生成”。后者按赛事提交服务回合，让 Agent 依据赛事数据和已有会话上下文填充可编辑的 Markdown 模板；不会直发图文卡片，也不会让 Agent 自行联网。默认模板按赛事、对局、焦点分析和 Liquipedia 来源排列：

```md
# {{tournament}}

{{tier}}

## 对局
{{matchups}}

## 焦点分析
{{focusAnalysis}}

---
数据来源：[Liquipedia]({{sourceUrl}}) · CC BY-SA 3.0
```

模板必须保留 `{{matchups}}`、`{{focusAnalysis}}`、`{{sourceUrl}}` 和 Liquipedia 来源标注。插件填入赛事、对局与来源信息；Agent 仅生成焦点分析，不应编造未提供的战绩、阵容或胜率。服务回合成功提交后仍需等待上游向 QQ 推送，页面不会将提交视为已送达。

## 資料與限制

- 功能狀態：`~/.dsh-qqbot/dispatch-features.json`；群名快取：`~/.dsh-qqbot/group-names.json`；群可用狀態：`~/.dsh-qqbot/group-health.json`。
- API Key 存入宿主憑證服務；QQ Bot 的 AppID／AppSecret 從 profile 的 `im-qqbot` 配置讀取。
- 群聊／私聊目標以 QQ Bot 的 `model-prefs.json` 當前映射為準；群名快取只作展示資訊。不存在或已歸檔的會話不會出現在目標下拉框中。
- `qqbot_dispatch` 提交的是外部回合，QQ 回覆是否主動推送受上游 `proactiveDelivery.externalTurns` 設定控制。
- 賽事通知優先直發 QQ；無直發路徑或遇到臨時發送失敗時，插件會恢復目標 Agent 並提交來源為 `plugin:dsh-qqbot-dispatch` 的服務回合。這類回合不受 `externalTurns` 限制，但實際送達仍受 QQ 平台限制。
- 群消息接口返回 HTTP 404 时，插件把当前群会话标为「群不可用」，暂停该目标的赛事通知和闲聊，并从目标选项中排除。保留会话、历史及配置；成功同步群名后恢复。群信息查询失败、限流、超时和 HTTP 5xx 不会触发此状态。这个状态不能区分群解散与机器人被移出。
- 服務回合只接受上游 `model-prefs.json` 已記錄的 QQ 會話映射；未記錄的派生 session ID 會報錯，不會假定它已對應到 QQ 對象。

## 開發

`features.js` 统一管理模组状态、排程和运行；`modules/cs2-matches/` 与 `modules/casual-chat/` 各自包含定义、服务逻辑和设置卡片。`index.js` 组装插件，`service-turn.js` 提交服务回合，`delivery.js` 处理赛事通知投递。前端入口位于 `client/`，执行 `npm run build` 生成根目录的 `client.js`。

```bash
npm install --legacy-peer-deps
npm test
npm run build
```
