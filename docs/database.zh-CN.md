# 数据库

[English](database.md) | **简体中文**

SQLite，驱动为 `rusqlite`，连接由 `r2d2` 池管理；表结构由一份幂等脚本创建，不手工建表。

## 分层

| 文件 | 职责 |
| --- | --- |
| `db/connection.rs` | `Db` 句柄、连接池参数、连接 PRAGMA、`ApiError` 映射 |
| `db/schema.rs` | 完整的 DDL，每次启动幂等执行 |
| `db/repository.rs` | 所有模型共用的通用 CRUD 助手 |

启动时 `Db` 被托管进 Tauri 状态，命令通过 `State<Db>` 取用：

```rust
let directory = app.path().app_data_dir()?;
let db = Db::open(directory.join(DATABASE_FILE_NAME))?;
schema::ensure(&db)?;
app.manage(db);
```

## 连接

| 项 | 取值 |
| --- | --- |
| 文件 | `<应用数据目录>/sentryneko.db`（即 `%APPDATA%\com.sentryneko.desktop\sentryneko.db`），除非 `config.json` 另指路径 |
| 连接池 | 4 条连接，取用超时 5 秒 |
| 每条连接 | `foreign_keys = ON`、`journal_mode = WAL`、`synchronous = NORMAL`、`busy_timeout = 5000 ms` |
| 时间戳 | UTC 纪元秒 |
| 失败 | `ApiCode::DATABASE`，SQLite 的报错原文放在 `details` |

## 配置

`config.rs` 在数据库旁边维护一个小 JSON 文件，首次运行自动创建：

```json
{
  "databasePath": "C:\\Users\\you\\AppData\\Roaming\\com.sentryneko.desktop\\sentryneko.db",
  "language": "en-US",
  "colorMode": "system",
  "fontSettings": { "family": null, "size": 14 }
}
```

| 字段 | 含义 | 默认值 |
| --- | --- | --- |
| `databasePath` | 应用打开的 SQLite 文件 | `<应用数据目录>/sentryneko.db` |
| `language` | 语言标签，见 `docs/i18n.md` | 检测到的系统语言，兜底为 `en-US` |
| `colorMode` | `dark`、`light` 或 `system`；`system` 跟随操作系统 | `system` |
| `fontSettings` | 字体名（`null` 为系统默认，`JetBrains Mono` 为内置字体，也可指定已安装字体）及 10–32 的整数字号，单位 px | `{ "family": null, "size": 14 }` |

规则：

- `databasePath` 为相对路径时，相对 `config.json` 所在目录解析；字段缺失则用默认值。
- `language` 缺失、为 `null` 或空白时检测系统 locale，立即尝试保存支持的标签；检测失败或
  不支持时使用 `en-US`。已有文件只补写 `language`：保留相对路径、未知键和其他已存值，
  缺失的其他字段仍保持缺失。保存失败时仍使用内存中解析出的语言启动，下次启动重新检测。
  新建配置仍要求写入成功。后续启动优先使用已存选择，设置页可以手动覆盖。
- `language` 为未知标签时回落到 `Language::DEFAULT`，文件保持原样。
- `colorMode` 为未知取值时同样回落到 `ColorMode::DEFAULT`（`system`）。
- 字体偏好缺失、字号越界或字体名无效时，回落到 14 px 系统默认字体，旧配置无需迁移。
- 首屏渲染前恢复字体。前端在本地存储中保留镜像，用于浏览器预览与启动回退；修改即时
  生效，后端写入按序执行，连续调整时旧值不会覆盖新值。保存失败会在设置页显示，重启
  时以最后成功保存的配置为准。
- 文件无法解析时报 `IO`，解析器原文放进 `details`，且绝不覆盖原文件——手工修好或删除即可恢复。
- 写入先落到 `config.json.tmp` 再改名就位，进程崩溃不会截断配置文件。
- `settings`（下面那张表）存用户偏好；`config.json` 存「打开数据库之前就必须知道」的东西。

## 表结构

表结构共九张表：

| 表 | 存放 | 关键列 |
| --- | --- | --- |
| `todos` | 用户维护的任务 | `title`、`completed`、`completed_at`、`created_at`、`updated_at`、`tag_ids`、`due_date` |
| `pomodoro_sessions` | 一次专注或休息区间 | `phase`、`planned_seconds`、`actual_seconds`、`started_at`、`ended_at`、`todo_id` |
| `app_events` | 前台应用活动 | `app_name`、`window_title`、`started_at`、`ended_at` |
| `alarms` | 单次或每周提醒 | `label`、`hour`、`minute`、`repeat_days`、`enabled`、`created_at` |
| `settings` | 键值型设置 | `key`、`value`、`updated_at` |
| `tags` | 任务可携带的标签名 | `name`（唯一、大小写不敏感）、`created_at` |
| `todo_tags` | 任务与标签的关联 | `todo_id`、`tag_id` |
| `todo_recurrences` | 可选的任务重复规则与当前周期 | `todo_id`（主键）、`unit`、`interval`、`current_at`、`next_at` |
| `todo_completions` | 热力图保留的已完成重复周期 | `todo_id`、`occurrence_at`（联合主键）、`completed_at` |

`todos.due_date` 可为空，使用 1970-01-01 至 9999-12-31 的 UTC 零点 epoch 秒编码日历日期。
`NULL` 表示无截止日期，新增此列之前的任务也默认无日期。`Todo::update` 一起保存标题和截止日期，
不改变完成状态和标签。前端使用 UTC 格式化，避免时区偏移改变用户所选的日期。

标签刻意存两份：`todos.tag_ids` 是标签 id 的 JSON 数组，任务行不必 join 就能回答「带哪些
标签」；`todo_tags` 是另一个方向的索引，`idx_todo_tags_tag_id` 用来查「哪些任务带某个标签」。
`Todo::set_tags` 在一个事务里同时写两边，`Tag::delete` 会把 id 从所有仍列着它的任务缓存里删掉。

没有 `todo_recurrences` 记录即为一次性任务，因此新增这两张表不会改变已有任务或完成状态。
重复任务保留原有任务 id 和标签，按 1–365 天、周或月的间隔重复，以创建时的本地日期为锚点：

- 首个周期从创建时开始，后续周期在计划日期的本地零点开始；使用 Windows 时区规则，而非固定
  24 小时时长。若调钟跳过零点，则使用当天第一个有效整点。
- 月份较短时取月末，但不改变原始锚点：1 月 31 日 → 2 月 28/29 日 → 3 月 31 日。自定义间隔
  使用同样的日历计算。
- 后台调度器每秒检查 `next_at`；启动和读取任务清单、计数时也会补周期。错过多个周期时直接进入
  当前周期，清单始终保留一项，不生成积压任务。
- 周期切换时，先把已完成周期存进 `todo_completions`，再重置 `completed` 与 `completed_at`；
  规则与任务在同一事务内更新，重试不会重复记录。未完成周期也会重置，但不记录完成。
- 周期结束前取消完成会移除本周期的完成状态；删除任务会级联删除规则和历史完成记录。重复设置
  完成保留首次完成时间；恰在周期边界完成时计入新周期。

番茄钟时长是 `settings` 里的一行：键 `pomodoro.durations`，值是 `PomodoroDurations` 的 JSON；
这一行不存在时按默认值处理。闹钟默认设置同样是一行：键 `alarm.defaults`，值形如
`{ "ringSeconds": 10, "method": "toast" }`——提示音重复多久，以及消息怎么走（`toast`，或
`inApp` 只交给窗口）。

仪表盘布局是第三行：键 `dashboard.grid`，值形如
`{ "widgets": [{ "id": "focus-1", "kind": "focus", "x": 0, "y": 0, "w": 1, "h": 2, "source": "today" }] }`
——首页显示哪些组件，每项有自己的标识、左上角所在的格子与在两列网格上横跨的格数。`id` 让每个放置项
可以被单独寻址，所以同一种 `kind` 可以出现多次。这一行不存在时表示从未自定义过，页面回落到内置布局。

任务列表布局使用键 `todo.displayMode`，值为 JSON 字符串：`"separated"`（缺失时的默认值）、
`"merged"` 或 `"twoColumns"`。设置页通过 `set_todo_display_mode` 保存，启动时通过
`get_todo_display_mode` 读取后再渲染。更改这一行不修改任务、完成状态、循环规则或列表顺序。
分区模式上下排列；双栏模式左右并排，列表可用宽度不超过 560 CSS 像素时自动堆叠。
合并模式标明每项任务的类型。所有布局共用完成状态筛选与剩余任务计数。
非空的 `recurrence` 字段表示循环任务（由 #25 提供）；字段缺失或为空时表示单次任务，
因此现有任务载荷保持兼容。

`app_events` 由前台采集器（`collectors/foreground_app.rs`）写入，它每秒采样一次前台窗口：

- 某个应用来到前台的采样点开一行（`started_at`），换另一个应用的那个采样点把上一行关掉
  （`ended_at`）。`ended_at IS NULL` 表示这一行还在进行——正常情况下最多到应用退出为止，
  退出时会被关掉。
- `app_name` 是去掉扩展名的可执行文件名（`chrome`、`Code`），同一个应用在不同版本和安装路径下
  保持同一个值。
- 同一个应用仍在前台、只是窗口标题变了时，就地更新 `window_title`。一行就是一段连续的应用
  停留，所以每秒重写一次标题的窗口也不会把表刷爆。
- SentryNeko 自己的窗口会被跳过，并把之前的行关掉：花在本应用里的时间不算值得记录的活动。
- 键盘鼠标五分钟没有输入就视为人不在：在该采样点关掉打开的行，等输入恢复再开新行，因此留在
  前台没人操作的应用不会继续累计时间。
- 采不到可归因对象时（没有前台窗口、锁屏、进程打不开），同样把打开的行关掉。

`AppEvent::usage` 读取这张表生成排行：把每一行裁到所问的时间窗内，按应用把多行相加（窗口中
再次出现的应用与之前那段时间合并，而不是出现两次），没有 `ended_at` 的行计到窗口结束，并丢掉
`LockApp` / `LogonUI`，让锁屏时间不归到任何应用头上。

热力图（`models/heatmap.rs`）把 `pomodoro_sessions` 与 `todos` 汇总成桶：

- 一个桶是本地的一天、以周一为起点的一周，或一个自然月。边界按 Windows 时区规则换算，所以
  一年里两次调钟的那些天长度仍然正确，不会整体偏一小时。
- 窗口内每一天都会返回，空桶也返回，图表不必自己补齐。
- 专注阶段按 `actual_seconds` 计入，并归属到它「开始」的那一天；还没收尾的阶段在收尾后计入。
  其他阶段（休息）不计。
- 任务计入 `completed_at` 所在的那一天。`set_completed` 在勾选时写入、取消勾选时清空，所以之后
  重命名一个已完成任务不会把它挪到别的日子。
- 重复任务的历史完成记录与当前任务完成记录一起计入原本的完成日，因此周期重置不会抹去此前的活动。

任务完成率（`models/todo.rs`）从两个角度看 `todos`：`all` 统计全部任务的当前状态，`today` 只统计
创建于本地零点之后或当前重复周期始于本地零点之后的任务（`COALESCE(todo_recurrences.current_at, todos.created_at)`）。
分子是该口径下已勾选完成的任务，所以取消勾选会把完成率降回去；任务删除时
分子分母同时移除，与用户看到的清单保持一致。

`alarms` 由 `commands/alarm_commands.rs` 维护、由 `services/scheduler.rs` 读取：

- `hour` 与 `minute` 是本地墙钟时间，而不是某个瞬间，所以换时区后一行仍然保持原本含义。
  `repeat_days` 是星期掩码：第 0 位是周一、第 6 位是周日，`127` 表示每天，`0` 表示单次。
- 单次闹钟在它的时间下一次到来时响一次，响过之后自动关闭；重新打开就再次进入待响状态。重复
  闹钟保持启用，等下一个被选中的星期几。
- 每一行都会持久化，所以未过期的闹钟在应用重启后依然有效：调度器在启动时按当前时钟重新算下一
  个触发瞬间，而不是把它存下来。同理，应用关闭期间已经过去的瞬间不会补响。
- 触发瞬间按 Windows 时区规则换算，所以调钟的那些天长度仍然正确。当天墙钟会跳过的时间
  （春季前拨）就跟着跳过——重复闹钟等它下一个被选中的日子；当天墙钟会重复的时间（秋季回拨）
  只响第一次，绝不响两次。
- 调度器为每个闹钟保存一个触发瞬间，并每秒读一次表，所以新增、编辑、删除或启停都在一秒内生效。
  恰好在读取那一行时到点的闹钟仍会响，最多晚一拍。
- 闹钟怎么响由 `alarm.defaults` 决定，而且是在响的那一刻读取、不是抄进闹钟行里：提示音每两秒响
  一次，直到 `ringSeconds` 用完；`method` 决定要不要向系统申请 Toast，`inApp` 时只靠
  `alarm-triggered` 推送让窗口显示。因此保存默认设置会同时改变所有闹钟。

## 建表

`ensure` 每次启动都在事务里执行整份脚本，创建缺失的表和索引，并检查 `pragma_table_info('todos')`，
在缺少 `due_date` 时添加可空列，保留已有任务、标签和关联。这项增量升级可重复执行；没有表结构版本表。

## 仓储助手

| 助手 | 返回 |
| --- | --- |
| `insert` | 新行 id |
| `execute` | 受影响行数 |
| `query_one` | 映射后的单行，无匹配则 `NOT_FOUND` |
| `query_optional` | 映射后的单行，无匹配则 `None` |
| `query_all` | 映射后的全部行 |
| `count` | 首行首列，类型 `i64` |
| `exists` | 查询是否至少匹配一行 |
| `transaction` | `work` 的返回值，`work` 失败时回滚 |
| `immediate_transaction` | 同上，但在读取前取得写锁，供周期重置与完成操作并发使用 |

行映射器就是 `fn(&Row<'_>) -> ApiResult<T>`（`RowMapper<T>`），因此模型只需把映射函数作为
关联函数暴露出来，各助手保持通用。

## scripts/init_db.ps1

不启动应用也能创建同一套表结构：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/init_db.ps1 [-DatabasePath <file>]
```

脚本需要 `PATH` 上有 `sqlite3`；没有时脚本会直接停止，并提示改用应用本身——应用首次启动也会
建表。表和索引使用 `IF NOT EXISTS`，并在旧库缺少 `due_date` 时才添加该列，重复执行安全。

有一个测试会从脚本里抽出 SQL，在空库及已建表的库上执行，断言两侧最终得到的表及任务列相同。

## 新增表或列

1. 在 `db/schema.rs` 里加上 DDL。
2. 在 `scripts/init_db.ps1` 里同步同样的 DDL、创建及升级条件检查。
3. 跑 `cargo test`——两侧不一致时脚本检查会失败。
4. 给已有表增列时，在 `ensure` 和维护脚本中先检查列是否存在，再执行添加；测试重复执行会保留已有数据。

截止日期排序在每个任务类型分区内统一应用：升序和降序都把无日期任务放在最后，相同日期按 id 从新到旧排列，不按完成状态打断顺序。默认排序仍把进行中任务放在前面。仅未完成且截止日期早于当前本地日历日的任务显示逾期；今天到期不算逾期。
