# 数据库

[English](database.md) | **简体中文**

SQLite，驱动为 `rusqlite`，连接由 `r2d2` 池管理；表结构由一份幂等脚本创建，不手工建表。

## 状态都存在哪里

状态存在三处，其中只有一处是本数据库；在库内又分成偏好与记录两类：

| 位置 | 内容 | 为什么在这里 |
| --- | --- | --- |
| `config.json` | `databasePath`、`language`、`colorMode` | 打开数据库之前就要知道，数据库打不开时也能读到 |
| `settings` 表 | 四项偏好：`alarm.defaults`、`pomodoro.durations`、`dashboard.grid`、`sidebar.panels` | 整块读写，从不按字段查询 |
| 其余表 | 任务、标签、专注记录、前台事件、闹钟 | 一行一条记录，要筛选和连接 |
| 浏览器 `localStorage` | 两个布局与主题的镜像 | 只为首屏；以上两处才是准 |

`settings` 的一行是 key、category 与按原样收发的 JSON——后端不持有任何负载的模型（见[表结构](#表结构)）。
写入的界面自己声明类别、自己校验，取用的后端代码把值解析成自己的模型再校验。

清空、导出或导入数据要同时覆盖 `config.json` 与数据库：清空 `settings` 恢复的是偏好，不包括语言与外观。

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
  "colorMode": "system"
}
```

| 字段 | 含义 | 默认值 |
| --- | --- | --- |
| `databasePath` | 应用打开的 SQLite 文件 | `<应用数据目录>/sentryneko.db` |
| `language` | 语言标签，见 `docs/i18n.md` | 检测到的系统语言，兜底为 `en-US` |
| `colorMode` | `dark`、`light` 或 `system`；`system` 跟随操作系统 | `system` |

规则：

- `databasePath` 为相对路径时，相对 `config.json` 所在目录解析；字段缺失则用默认值。
- `language` 缺失、为 `null` 或空白时检测系统 locale，立即尝试保存支持的标签；检测失败或
  不支持时使用 `en-US`。已有文件只补写 `language`：保留相对路径、未知键和其他已存值，
  缺失的其他字段仍保持缺失。保存失败时仍使用内存中解析出的语言启动，下次启动重新检测。
  新建配置仍要求写入成功。后续启动优先使用已存选择，设置页可以手动覆盖。
- `language` 为未知标签时回落到 `Language::DEFAULT`，文件保持原样。
- `colorMode` 为未知取值时同样回落到 `ColorMode::DEFAULT`（`system`）。
- 文件无法解析时报 `IO`，解析器原文放进 `details`，且绝不覆盖原文件——手工修好或删除即可恢复。
- 写入先落到 `config.json.tmp` 再改名就位，进程崩溃不会截断配置文件。
- `settings`（下面那张表）存用户偏好；`config.json` 存「打开数据库之前就必须知道」的东西。

## 表结构

表结构共七张表：

| 表 | 存放 | 关键列 |
| --- | --- | --- |
| `todos` | 用户维护的任务 | `title`、`completed`、`completed_at`、`created_at`、`updated_at`、`tag_ids`、`start_at`、`end_at` |
| `pomodoro_sessions` | 一次专注或休息区间 | `phase`、`planned_seconds`、`actual_seconds`、`started_at`、`ended_at`、`todo_id` |
| `app_events` | 前台应用活动 | `app_name`、`window_title`、`started_at`、`ended_at` |
| `alarms` | 单次或每周提醒 | `label`、`hour`、`minute`、`repeat_days`、`enabled`、`created_at` |
| `settings` | 应用设置：一行一个键，按类别分组 | `id`、`key`（唯一）、`value`、`category`、`updated_at` |
| `tags` | 任务可携带的标签名 | `name`（唯一、大小写不敏感）、`created_at` |
| `todo_tags` | 任务与标签的关联 | `todo_id`、`tag_id` |

标签刻意存两份：`todos.tag_ids` 是标签 id 的 JSON 数组，任务行不必 join 就能回答「带哪些
标签」；`todo_tags` 是另一个方向的索引，`idx_todo_tags_tag_id` 用来查「哪些任务带某个标签」。
`Todo::set_tags` 在一个事务里同时写两边，`Tag::delete` 会把 id 从所有仍列着它的任务缓存里删掉。

`settings` 是运行期偏好的落脚处，与业务数据分开存放：新增一个设置界面只是加一行，而不是加一张表。
一行的内容是唯一的 `key`、JSON 形式的 `value`、它归属的 `category`，以及 `updated_at`（纪元秒，
与本库其他时间戳一致）；`id` 是代理主键，使得一行可以不靠名字被寻址。`key` 在整张表里唯一，
因此读写单个设置不需要类别；`idx_settings_category` 让「某个主题下的全部设置」变成一次索引扫描。
当前使用的类别有 `pomodoro`、`alarm`、`dashboard` 与 `sidebar`；未来新界面自报的类别会照原样存下，
无需改表。

所有行都经 `Setting` 写入：它拒绝空白或过长的键、空白类别、超大值，以及不是 JSON 的值——对负载只要求
这些，所以 `get_setting`/`set_setting` 能服务任意偏好，新增一个偏好不需要任何 Rust 改动。值本身是什么
意思由别处决定，见[状态都存在哪里](#状态都存在哪里)。

番茄钟时长是 `pomodoro.durations` 这一行（类别 `pomodoro`），值形如
`{ "focusSeconds": 1500, "shortBreakSeconds": 300, "longBreakSeconds": 900 }`；这一行不存在时
按默认值处理。闹钟默认设置是 `alarm.defaults`（类别 `alarm`），值形如
`{ "ringSeconds": 10, "method": "toast" }`——提示音重复多久，以及消息怎么走（`toast`，或
`inApp` 只交给窗口）。

仪表盘布局是 `dashboard.grid`（类别 `dashboard`），值形如
`{ "columns": 4, "placements": { "focus": { "x": 0, "y": 0, "w": 2, "h": 2 } }, "hidden": ["todos"] }`
——网格的列数、按面板 id 存放的每个面板矩形，以及收进组件库的面板；收起的面板保留自己的矩形，所以
放回原处不花任何代价。这一行不存在时表示从未自定义过，页面回落到内置布局。

侧栏布局是 `sidebar.panels`（类别 `sidebar`），值形如
`{ "panels": [{ "id": "todos", "visible": true }] }`——侧栏能显示的全部面板，按绘制顺序排列，
每项带一个决定是否绘制的标记。这一行不存在时表示从未自定义过，按内置顺序显示；写成 `visible` 缺省
的面板视为显示，这也是隐藏功能出现之前的行为。

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

任务完成率（`models/todo.rs`）从两个角度看 `todos`：`all` 统计全部任务，`today` 只统计 `created_at`
在本地零点之后的任务。分子是该口径下已勾选完成的任务，所以取消勾选会把完成率降回去；任务删除时
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

`ensure` 每次启动都在事务里执行整份脚本：缺的表和索引会建出来，已存在的保持原样。这里不做
版本管理——应用尚未发布，改表结构就是本地重建，而不是写迁移。

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

行映射器就是 `fn(&Row<'_>) -> ApiResult<T>`（`RowMapper<T>`），因此模型只需把映射函数作为
关联函数暴露出来，各助手保持通用。

## scripts/init_db.ps1

不启动应用也能创建同一套表结构：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/init_db.ps1 [-DatabasePath <file>]
```

脚本需要 `PATH` 上有 `sqlite3`；没有时脚本会直接停止，并提示改用应用本身——应用首次启动也会
建表。所有语句都带 `IF NOT EXISTS`，重复执行安全。

有一个测试会从脚本里抽出 SQL，在已建表的库上执行，断言两侧最终得到的表相同。

## 新增表或列

1. 在 `db/schema.rs` 里加上 DDL。
2. 在 `scripts/init_db.ps1` 里同步同样的 DDL（一样的 `IF NOT EXISTS`）。
3. 跑 `cargo test`——两侧不一致时脚本检查会失败。
4. 重建本地库：对空文件跑 `scripts/init_db.ps1`，或直接删掉旧库。已存在的库不会被升级，因为
   还没有发布过版本。
