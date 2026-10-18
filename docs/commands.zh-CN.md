# Tauri 命令

[English](commands.md) | **简体中文**

前端与后端之间的每一次调用都通过 `src-tauri/src/commands/` 下的 `#[tauri::command]`
函数完成。处理函数保持轻薄：校验参数、委托给 `services/` 或 `db/`，再把结果映射为
`utils::response` 的结构。业务逻辑不放在命令里。

## 响应信封

命令不直接返回领域类型，而是统一 resolve 成同一种结构，成功与失败一致（定义在
`src-tauri/src/utils/response.rs`，由 `src/types/index.ts` 的 `ApiResponse<T>` 镜像）：

```json
// 成功
{ "code": "OK", "message": "OK", "details": null, "data": { "id": 1, "title": "Write the docs" } }

// 失败
{ "code": "INVALID_INPUT", "message": "title must not be empty", "details": null, "data": null }
```

- `code` —— 契约本身。前端据此分支，并挑选本地化文案。
- `message` —— 后端给出的兜底文案，用于日志以及前端尚未认识的错误码，绝不作为界面文案的唯一来源。
- `details` —— 底层诊断信息（I/O 报错、解析报错）。用于日志与问题反馈，不做本地化，也不要当作界面文案渲染。
- `data` —— 成功时的载荷，失败时为 `null`。

信封是 resolve 而不是 reject：`invoke()` 只在传输层失败（命令未注册、处理函数 panic、
载荷序列化失败）时 reject，因此一次 `code` 判断即可覆盖所有业务结果。

## 错误码

| 错误码 | 含义 | 由谁产生 |
| --- | --- | --- |
| `OK` | 成功，`data` 有值 | — |
| `INVALID_INPUT` | 参数未通过校验 | 任何校验入参的命令 |
| `NOT_FOUND` | 请求的记录不存在 | CRUD 命令（T10、T16、T17） |
| `CONFLICT` | 与已存状态冲突（唯一键重复、版本过期） | CRUD 命令 |
| `DATABASE` | 数据库层失败 | `db/`（T04） |
| `IO` | 文件系统或其他 OS 级 I/O 失败 | `config.rs`、导出导入（T29） |
| `PERMISSION_DENIED` | 系统拒绝该操作 | 采集器（T12）、开机自启（T26） |
| `UNSUPPORTED` | 属于后续里程碑的预留能力 | P3 桩实现（T27–T32） |
| `INTERNAL` | 其他意外情况，`details` 说明原因 | `?` 的兜底 |

`services::i18n`（T06）负责把错误码映射为本地化的 `message`。新增错误码需要同时更新
`ApiCode` 与 `src/types/index.ts` 中的 `ApiCode` 联合类型。

## 编写命令

```rust
// src-tauri/src/commands/todo_commands.rs
use crate::utils::response::{ApiError, ApiResponse, ApiResult};

#[tauri::command]
pub fn toggle_todo(id: i64) -> ApiResponse<Todo> {
    toggle(id).into()
}

fn toggle(id: i64) -> ApiResult<Todo> {
    if id <= 0 {
        return Err(ApiError::invalid_input("id must be a positive integer"));
    }

    repository::toggle_todo(id) // -> ApiResult<Todo>
}
```

规则（`CONTRIBUTING.md` 中同样有约束）：

1. 对外命令返回 `ApiResponse<T>`；可失败的辅助函数返回 `ApiResult<T>`，最后用 `.into()` 一次性转换。
2. 用户可触发的路径上不得使用 `unwrap()` / `expect()`，一律返回 `ApiError`。
3. 需要在信封里返回数值时，用 `?` 传播 `ApiResult`，最后再转换。
4. 在 `lib.rs` 中用 `.invoke_handler(tauri::generate_handler![toggle_todo])` 注册命令。
5. 应用自定义命令不需要在 `capabilities/default.json` 中登记，该文件只授予 core 与插件命令的权限。
6. 在下表中补一行，签名变化时同步更新。

## 命令索引

字体设置使用 `FontSettings`（`{ family: string | null, size: number }`）：`null` 跟随系统
界面字体，`JetBrains Mono` 选择内置字体，其他名称选择 Windows 已安装字体。
`get_font_settings` 读取 `config.json`；`set_font_settings` 校验 10–32 的整数字号，字体名
须非空、不超过 128 个字符，且不含控制字符或首尾空白。`get_system_fonts` 在线程池中
枚举 Windows 字体，返回排序、去重后的名称，并排除竖排字体（`@`）别名。
已保存的字体若被卸载，界面回退到系统字体，同时保留原选择。

前端可以调用的命令都列在这里。语言这两个是 `src/i18n/` 的后端接口：`get_language` 返回
`config.json` 中的标签，`set_language` 对 `Language::ALL` 之外的标签返回 `INVALID_INPUT`。
外观这一对同理：`get_color_mode` 读回已存的 `dark` / `light` / `system`，`set_color_mode`
拒绝其余取值并返回 `INVALID_INPUT`。
`add_todo` 可接收 `recurrence: { unit: "day" | "week" | "month", interval: 1..365 }`。
省略或传 `null` 即创建一次性任务。`Todo` 包含 `recurrence` 和 `nextOccurrenceAt`（UTC 秒）；
一次性任务的这两个字段均为 `null`。首个周期立即开始，后续周期在计划日期的本地零点开始。
读取清单或计数时先补上到期周期，再筛选完成状态或统计。日历规则见 `docs/database.md`。

`emit_test_event` 是事件探针背后的诊断命令，它推送的事件定义在 `docs/events.md`。待办这一组
就是清单本身：`list_todos` 按完成状态筛选，写操作都返回落库后的整行（含可为空的 `dueDate`），`todo_counts` 供剩余
计数使用，`completion_rate` 回答 `all` 或 `today` 口径下任务已完成的比例——统计规则写在
`docs/database.md`。`add_todo` 接受可选截止日期，`update_todo` 一起保存标题和日期；传 `null` 清除日期。
`dueDate` 使用 1970-01-01 至 9999-12-31 的 UTC 零点 epoch 秒编码日历日期，不表示本地瞬间。
选择器和列表按 UTC 年月日读写，避免时区改变所选日期；今天/明天按用户本地日历计算。
超出范围或不在 UTC 零点的值返回 `INVALID_INPUT`。
标签这一组属于预留，目前没有页面调用：它维护名称索引，`set_todo_tags` 建立任务与
标签的关联，并从两个方向读取关系（`todo_tags` 查某任务的标签，`todos_with_tag` 查某标签下的任务）。
番茄钟这一组负责持久化：`start_pomodoro_session` 在阶段开始时插入一行，`finish_pomodoro_session`
用实际秒数收尾——倒计时本身由前端按时间戳推进，不依赖 tick 计数，且由 store 驱动而非页面，
因此切换页面不会中断。时长属于设置，读写命令放在
`settings_commands` 里，并在设置页编辑。通知这一组就是 Toast 通道：`send_test_notification`
是诊断命令，`notify_pomodoro_phase` 由计时器在阶段结束时调用。两者成功返回 `toast`；系统拒绝
时推送 `notification-fallback`（见 `docs/events.md`）并返回 `fallback`，番茄钟无论如何都会继续流转。
系统这一组描述的是机器而不是数据：`get_uptime` 返回开机时刻（`bootAt`）、开机至今的秒数
（`totalSeconds`，含休眠）以及其中落在今天的那部分（`todaySeconds`）——今天从本地零点算起，
按 Windows 时区规则换算，所以零点前开机的只计入零点之后的部分；计数器在休眠期间照常走，
因此恢复后开机时刻不会漂移。前台这一组回答排行榜用什么：`app_usage` 接收一个时间窗
（`from`、`to`，UTC epoch 秒）和一个 `limit`，按应用在该窗口内占据前台的秒数排名。窗口由前端按
预设算好（「今天」从本地零点起），后端只负责把存储的行裁到窗口内、把窗口中再次出现的应用合并，
并丢掉锁屏与登录界面外壳。事件流读的是同一张表：`list_app_events` 倒序返回一页，`before` 传上一页
最后一行的 id，采集器持续插入时翻页也不会错位。热力图这一组回答图表要什么：`heatmap` 接收窗口和 `granularity`
（`day`、`week`、`month`），按本地日、周一或月初返回每个桶——空桶也返回——桶里带在该处开始的
专注秒数和在该处完成的任务数；规则写在 `docs/database.md`。闹钟这一组维护调度器盯着的那批提醒：
`list_alarms`、`add_alarm`、`update_alarm`、`set_alarm_enabled`、`delete_alarm`。`hour` 和
`minute` 是本地墙钟时间，`repeatDays` 是星期掩码（`0` 表示单次）；这里没有任何命令会响铃——
真正响铃的是 `services/scheduler.rs`，跑在拥有时钟的那个线程上，所以页面开没开都不影响闹钟。
闹钟怎么响是设置而不是列，所以和时长放在一起：`get_alarm_defaults` 与 `set_alarm_defaults`
读写响铃时长和通知方式，调度器在响的那一刻读取它们——改一次默认值，所有闹钟一起变，而不只是下
一个。仪表盘这一组承载首页本身：`get_dashboard_layout` 读取已放置的组件，
`apply_dashboard_changes` 应用一次排列产生的变更——移动、缩放或新增的组件各一条 `upsert`，被移除
的组件一条 `remove`。每个放置项都有自己的 `id`，所以同一种组件可以放多个；每项还给出左上角所在的
格子与横跨的格数（两列网格上的 `x`、`y`、`w`、`h`）以及它读取的数据来源。从未自定义过的配置没有
这一行，`get_dashboard_layout` 返回 `null`，页面把内置布局作为第一批变更写入。两个自启命令管的是
另一半机器状态：`get_autostart` 报告当前用户的 Run 键会不会启动这个可执行文件，`set_autostart`
写入或删除那条记录，并返回此刻生效的状态；注册表拒绝写入时是 `PERMISSION_DENIED`。

| 命令 | 模块 | 参数 | 返回 | 任务 |
| --- | --- | --- | --- | --- |
| `get_language` | `settings_commands` | — | `String`（BCP-47 标签） | T07 |
| `set_language` | `settings_commands` | `language: String` | `String`（生效后的标签） | T07 |
| `get_color_mode` | `settings_commands` | — | `String`（`dark`、`light` 或 `system`） | — |
| `set_color_mode` | `settings_commands` | `mode: String` | `String`（生效后的模式） | — |
| `get_font_settings` | `settings_commands` | — | `FontSettings`（`{ family, size }`） | T34 |
| `set_font_settings` | `settings_commands` | `settings: FontSettings` | `FontSettings`（生效后的设置） | T34 |
| `get_system_fonts` | `settings_commands` | — | `String[]`（Windows 已安装字体名称） | T34 |
| `emit_test_event` | `event_commands` | — | `TestEvent`（`{ sequence }`） | T08 |
| `list_todos` | `todo_commands` | `completed: bool?`, `sort: TodoSort?` (`default`, `dueDateAsc`, `dueDateDesc`) | `Todo[]` | T10 |
| `add_todo` | `todo_commands` | `title: String`, `recurrence: Recurrence?`, `dueDate: i64?` | `Todo` | T10, T37 |
| `update_todo` | `todo_commands` | `id: i64`, `title: String`, `dueDate: i64?` | `Todo` | T10 |
| `set_todo_due_date` | `todo_commands` | `id: i64`, `dueDate: i64?` | `Todo` | T10 |
| `rename_todo` | `todo_commands` | `id: i64`、`title: String` | `Todo` | T10 |
| `set_todo_completed` | `todo_commands` | `id: i64`、`completed: bool` | `Todo` | T10 |
| `delete_todo` | `todo_commands` | `id: i64` | — | T10 |
| `todo_counts` | `todo_commands` | — | `TodoCounts`（`{ total, remaining, completed }`） | T10 |
| `completion_rate` | `todo_commands` | `scope: "all" \| "today"` | `TaskCompletion`（`{ total, completed }`） | T22 |
| `list_tags` | `tag_commands` | — | `Tag[]` | T33 |
| `add_tag` | `tag_commands` | `name: String` | `Tag` | T33 |
| `rename_tag` | `tag_commands` | `id: i64`、`name: String` | `Tag` | T33 |
| `delete_tag` | `tag_commands` | `id: i64` | — | T33 |
| `set_todo_tags` | `tag_commands` | `id: i64`、`tagIds: i64[]` | `Todo` | T33 |
| `todo_tags` | `tag_commands` | `todoId: i64` | `Tag[]` | T33 |
| `todos_with_tag` | `tag_commands` | `tagId: i64` | `Todo[]` | T33 |
| `get_pomodoro_durations` | `settings_commands` | — | `PomodoroDurations`（`{ focusSeconds, shortBreakSeconds, longBreakSeconds }`） | T11 |
| `set_pomodoro_durations` | `settings_commands` | `durations: PomodoroDurations` | `PomodoroDurations` | T11 |
| `start_pomodoro_session` | `pomodoro_commands` | `phase: Phase`、`plannedSeconds: i64`、`todoId: i64?` | `PomodoroSession` | T11 |
| `finish_pomodoro_session` | `pomodoro_commands` | `id: i64`、`actualSeconds: i64` | `PomodoroSession` | T11 |
| `list_pomodoro_sessions` | `pomodoro_commands` | `limit: i64` | `PomodoroSession[]` | T11 |
| `send_test_notification` | `notification_commands` | — | `Outcome`（`"toast"` 或 `"fallback"`） | T14 |
| `notify_pomodoro_phase` | `notification_commands` | `phase: Phase` | `Outcome`（`"toast"` 或 `"fallback"`） | T14 |
| `get_uptime` | `system_commands` | — | `Uptime`（`{ bootAt, todaySeconds, totalSeconds }`） | T13 |
| `app_usage` | `app_event_commands` | `from: i64`、`to: i64`、`limit: i64` | `AppUsage[]`（`{ appName, seconds }`） | T20 |
| `list_app_events` | `app_event_commands` | `before: i64?`、`limit: i64` | `AppEventPage`（`{ events, more }`） | T23 |
| `heatmap` | `heatmap_commands` | `from: i64`、`to: i64`、`granularity: "day" \| "week" \| "month"` | `HeatmapBucket[]`（`{ start, focusSeconds, completedTasks }`） | T19 |
| `list_alarms` | `alarm_commands` | — | `Alarm[]`（`{ id, label, hour, minute, repeatDays, enabled, createdAt }`） | T17 |
| `add_alarm` | `alarm_commands` | `label: String`、`hour: i64`、`minute: i64`、`repeatDays: i64` | `Alarm` | T17 |
| `update_alarm` | `alarm_commands` | `id: i64`、`label: String`、`hour: i64`、`minute: i64`、`repeatDays: i64` | `Alarm` | T17 |
| `set_alarm_enabled` | `alarm_commands` | `id: i64`、`enabled: bool` | `Alarm` | T17 |
| `delete_alarm` | `alarm_commands` | `id: i64` | — | T17 |
| `get_alarm_defaults` | `settings_commands` | — | `AlarmDefaults`（`{ ringSeconds, method }`） | T18 |
| `set_alarm_defaults` | `settings_commands` | `defaults: AlarmDefaults` | `AlarmDefaults` | T18 |
| `get_autostart` | `settings_commands` | — | `bool` —— 自启项是否指向当前可执行文件 | T26 |
| `set_autostart` | `settings_commands` | `enabled: bool` | `bool` —— 此刻生效的状态 | T26 |
| `get_dashboard_layout` | `settings_commands` | — | `DashboardLayout?`（`{ widgets: { id, kind, x, y, w, h, source }[] }`；未自定义时为 `null`） | — |
| `apply_dashboard_changes` | `settings_commands` | `changes: WidgetChange[]`（`upsert` 带组件，或 `remove` 带 id） | `DashboardLayout` —— 应用后生效的布局 | — |
| `get_todo_display_mode` | `settings_commands` | — | `"separated"`（默认）、`"merged"` 或 `"twoColumns"` | T35 |
| `set_todo_display_mode` | `settings_commands` | `mode: String` | 保存后的显示方式；其他值返回 `INVALID_INPUT` | T35 |

截止日期排序在每个任务类型分区内统一应用：升序和降序都把无日期任务放在最后，相同日期按 id 从新到旧排列，不按完成状态打断顺序。默认排序仍把进行中任务放在前面。仅未完成且截止日期早于当前本地日历日的任务显示逾期；今天到期不算逾期。
