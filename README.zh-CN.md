# SentryNeko

[English](README.md) | **简体中文**

<img src="src-tauri/app-icon.svg" alt="SentryNeko 猫咪时钟标志" width="96" height="96" />

> Windows 桌面生产力工具：待办清单、番茄钟、前台应用采集与专注统计，全部数据本地存储，不依赖云端。

## 简介

SentryNeko 是一款面向 Windows 的个人效率与时间追踪应用。它把「任务管理」和「实际时间去向」放在一起：一边用待办清单和番茄钟安排工作，一边在后台采集前台应用与窗口标题，最终用热力图和统计图表回答一个问题——**我的时间到底花在了哪里**。

- 单机优先：SQLite 本地存储，无需注册、无需联网
- 轻量常驻：托盘运行 + 开机自启，采集进程静默工作
- 实时反馈：番茄钟完成、闹钟触发、应用切换通过 Tauri 事件即时推送到界面
- 中英双语：界面与后端错误消息均支持多语言

## 平台支持

**仅支持 Windows 10 / 11（x64）。**

本项目不做跨平台抽象，直接调用 Win32 API（`GetForegroundWindow`、`GetWindowText`、`GetTickCount64` 等）并在 Windows 上使用 Toast 通知、注册表 / 计划任务实现开机自启。macOS 与 Linux 不在支持范围内，若在其他平台运行不保证可编译。

运行时依赖：[WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)（Windows 11 已内置，Windows 10 需自行安装）。

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 桌面框架 | Tauri 2.x |
| 后端 | Rust（Win32 FFI、SQLite、定时调度、Toast 通知） |
| 前端 | React + TypeScript + Vite |
| 数据库 | SQLite（rusqlite 驱动、r2d2 连接池、版本化迁移） |
| 国际化 | i18next / react-i18next（简体中文、英文） |
| 状态管理 | 前端 store 层 + Tauri 事件订阅 |

## 功能规划

状态说明：✅ 已规划（本期实现）；🚧 预留（后续版本，接口与模型先占位）。

### 一、核心生产力

| 功能 | 说明 | 状态 |
| --- | --- | --- |
| 待办清单（TodoList） | 增删改查、完成状态切换、筛选（全部/进行中/已完成）、剩余计数；设置页可选择单次与循环任务上下分区（默认）、合并列表或左右双栏，并在本地保存偏好 | ✅ 规划 |
| 番茄钟 | 25 分钟专注倒计时、休息倒计时、自定义时长、开始/暂停/重置 | ✅ 规划 |
| 热力图 | 按日/周/月聚合专注时长和完成任务数，GitHub 风格展示 | ✅ 规划 |
| 闹钟提醒 | 单次/重复闹钟、自定义时间、Windows Toast 通知 + 应用内响铃 | ✅ 规划 |

### 二、系统采集

| 功能 | 说明 | 状态 |
| --- | --- | --- |
| 前台应用监控 | 实时采集当前前台应用名 + 窗口标题，记录切换时间，可查询历史记录 | ✅ 规划 |
| 开机时间 | 记录系统启动时间，计算当日开机时长 | ✅ 规划 |
| 系统信息 | CPU 使用率、内存占用、磁盘空间（预留） | 🚧 预留 |

### 三、实时通信

| 功能 | 说明 | 状态 |
| --- | --- | --- |
| Tauri 事件推送 | 前台应用切换、番茄钟完成、闹钟触发等事件实时推送到前端 UI | ✅ 规划 |
| 系统通知 | Windows Toast 通知（闹钟响铃、番茄钟完成提醒） | ✅ 规划 |

### 四、数据统计

| 功能 | 说明 | 状态 |
| --- | --- | --- |
| 应用使用统计 | 按应用聚合使用时长，展示 Top 应用排行 | ✅ 规划 |
| 专注趋势 | 日/周/月专注时长趋势图 | ✅ 规划 |
| 任务完成率 | 完成任务数 / 总任务数统计 | ✅ 规划 |

### 五、国际化

| 功能 | 说明 | 状态 |
| --- | --- | --- |
| 多语言支持 | 简体中文、英文、日文（预留） | ✅ 规划 |
| 语言切换 | 设置页切换语言，持久化到本地 | ✅ 规划 |

### 六、社交（预留）

| 功能 | 说明 | 状态 |
| --- | --- | --- |
| 互相监督 | 好友/房间机制，查看对方在线状态、专注时长 | 🚧 预留 |
| 分享 | 公开主页/分享卡片，展示热力图和统计 | 🚧 预留 |

### 七、系统集成

| 功能 | 说明 | 状态 |
| --- | --- | --- |
| 开机自启 | 设置页开关写入当前用户的 Run 键，开机登录后启动并留在托盘 | ✅ 规划 |
| 系统托盘 | 关闭到托盘，右键菜单快速操作（开始番茄、查看今日统计）；再次启动时恢复已有窗口 | ✅ 规划 |
| 全局快捷键 | 自定义快捷键快速开始/暂停番茄钟、显示/隐藏主窗口 | 🚧 预留 |

### 八、设置

| 功能 | 说明 | 状态 |
| --- | --- | --- |
| 番茄钟设置 | 专注时长、休息时长、长休息间隔、每日目标 | ✅ 规划 |
| 闹钟默认设置 | 默认响铃时长、通知方式 | ✅ 规划 |
| 语言设置 | 切换界面语言 | ✅ 规划 |
| 数据管理 | 导出/导入数据、清空历史记录 | 🚧 预留 |

### 汇总

| 分类 | 数量 |
| --- | --- |
| ✅ 已规划 | 17 项 |
| 🚧 预留 | 5 项 |
| 合计 | 22 项 |

## 目录结构

> **说明**：下列目录为**规划结构**，并非仓库当前状态。

```text
SentryNeko/
├── src-tauri/                        # Tauri Rust 后端
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── build.rs                      # Tauri 构建脚本（生成权限 schema）
│   ├── tauri.conf.json               # Tauri 配置（窗口、权限、打包等）
│   ├── capabilities/
│   │   └── default.json              # 权限配置（IPC 允许的命令）
│   ├── app-icon.svg                  # 图标源文件，供 `pnpm icons` 使用
│   ├── icons/                        # 应用图标（生成产物，不纳入版本管理）
│   └── src/
│       ├── main.rs                   # 入口：启动 Tauri 应用
│       ├── lib.rs                    # 模块注册 + Tauri 命令注册
│       ├── config.rs                 # 配置读取（数据库路径、语言等）
│       ├── db/
│       │   ├── mod.rs                # 数据库模块入口
│       │   ├── connection.rs         # SQLite 连接池初始化
│       │   ├── schema.rs             # 幂等建表脚本
│       │   └── repository.rs         # 通用数据访问层（CRUD）
│       ├── models/
│       │   ├── mod.rs                # 模型模块入口
│       │   ├── todo.rs               # 待办任务模型
│       │   ├── tag.rs                # 标签模型（预留：任务标签）
│       │   ├── pomodoro.rs           # 番茄钟模型
│       │   ├── heatmap.rs            # 热力图数据模型
│       │   ├── alarm.rs              # 闹钟模型
│       │   ├── user.rs               # 用户模型（预留，用于分享/互督）
│       │   └── app_event.rs          # 前台应用事件模型
│       ├── commands/                 # Tauri 命令层
│       │   ├── mod.rs                # 命令模块入口
│       │   ├── todo_commands.rs      # 待办 CRUD 命令
│       │   ├── tag_commands.rs       # 标签命令（预留）
│       │   ├── pomodoro_commands.rs  # 番茄钟命令
│       │   ├── heatmap_commands.rs   # 热力图数据命令
│       │   ├── alarm_commands.rs     # 闹钟命令
│       │   ├── app_event_commands.rs # 前台应用事件查询命令
│       │   ├── event_commands.rs     # 事件总线命令
│       │   ├── settings_commands.rs  # 设置命令
│       │   └── system_commands.rs    # 系统信息命令（开机时长）
│       ├── collectors/               # Windows 系统采集层
│       │   ├── mod.rs                # 采集模块入口
│       │   ├── foreground_app.rs     # 前台应用采集器（GetForegroundWindow + GetWindowText）
│       │   └── system_info.rs        # 系统信息采集（开机时间、CPU、内存等）
│       ├── services/
│       │   ├── mod.rs                # 服务模块入口
│       │   ├── scheduler.rs          # 定时任务调度器（闹钟触发）
│       │   ├── notification.rs       # Windows 通知推送（Toast 通知）
│       │   ├── event_bus.rs          # 事件总线（采集器 → 前端推送）
│       │   └── i18n.rs               # 后端国际化（错误消息多语言）
│       └── utils/
│           ├── mod.rs                # 工具模块入口
│           ├── time.rs               # 时间处理工具
│           ├── windows.rs            # Windows 特定 API 封装（Win32 FFI）
│           └── response.rs           # 统一命令响应格式
│
├── src/                              # React 前端（Tauri 前端）
│   ├── main.tsx                      # 入口
│   ├── App.tsx                       # 根组件 + 路由配置
│   ├── i18n/                         # 国际化模块
│   │   ├── index.ts                  # i18n 初始化（i18next/react-i18next）
│   │   ├── locales/
│   │   │   ├── zh-CN.json            # 简体中文
│   │   │   ├── en-US.json            # 英文
│   │   │   └── ja-JP.json            # 日文（预留）
│   │   └── config.ts                 # 语言配置
│   ├── hooks/
│   │   ├── useTodos.ts               # 待办数据 Hook
│   │   ├── usePomodoro.ts            # 番茄钟 Hook
│   │   ├── useHeatmap.ts             # 热力图数据 Hook
│   │   ├── useAlarms.ts              # 闹钟 Hook
│   │   ├── useAppEvents.ts           # 前台应用事件 Hook
│   │   ├── useI18n.ts                # 语言切换 Hook
│   │   ├── useTauriEvent.ts          # Tauri 事件监听封装
│   │   └── useWindowControls.ts      # 自绘标题栏的窗口控制
│   ├── components/
│   │   ├── TodoList.tsx              # 待办列表组件
│   │   ├── TodoItem.tsx              # 单个待办项
│   │   ├── AddTodoForm.tsx           # 添加待办表单
│   │   ├── PomodoroTimer.tsx         # 番茄钟计时器
│   │   ├── PomodoroSettings.tsx      # 阶段时长设置表单
│   │   ├── HeatmapChart.tsx          # 热力图组件
│   │   ├── AlarmList.tsx             # 闹钟列表
│   │   ├── AppEventLog.tsx           # 前台应用事件日志列表
│   │   ├── LanguageSwitcher.tsx      # 语言选择（设置页使用）
│   │   ├── TitleBar.tsx              # 自绘标题栏（拖拽、最小化、最大化、关闭）
│   │   ├── ToastHost.tsx             # 系统通知被拒时的应用内提示
│   │   ├── I18nProvider.tsx          # 国际化 Provider 组件
│   │   └── ui/                       # 公共组件库
│   │       ├── NumericInput.tsx      # 支持输入校验、滚轮和箭头调节的数字输入框
│   │       └── SegmentedControl.tsx  # 公共分段控件（带滑动高亮）
│   ├── pages/
│   │   ├── Dashboard.tsx             # 主面板
│   │   ├── TodosPage.tsx             # 待办页面
│   │   ├── PomodoroPage.tsx          # 番茄钟页面
│   │   ├── HeatmapPage.tsx           # 热力图页面
│   │   ├── AlarmsPage.tsx            # 闹钟页面
│   │   ├── SettingsPage.tsx          # 设置页
│   │   ├── EventsPage.tsx            # 事件流页面
│   │   └── AnalyticsPage.tsx         # 数据分析页
│   ├── stores/
│   │   ├── todoStore.ts              # 待办状态管理
│   │   ├── pomodoroStore.ts          # 番茄钟状态
│   │   ├── appEventStore.ts          # 前台应用事件状态
│   │   └── i18nStore.ts              # 语言状态管理
│   ├── styles/
│   │   └── app.css                   # 设计令牌与窗口外壳样式
│   └── types/
│       ├── index.ts                  # 全局类型定义
│       ├── todo.ts                   # 待办类型
│       ├── tag.ts                    # 标签类型（预留）
│       ├── pomodoro.ts               # 番茄钟类型
│       ├── heatmap.ts                # 热力图类型
│       ├── alarm.ts                  # 闹钟类型
│       ├── appEvent.ts               # 前台应用事件类型
│       └── i18n.ts                   # 国际化类型定义
│
├── docs/                             # 文档（中英双语）
│   ├── commands.md                   # Tauri 命令文档
│   ├── database.md                   # 表结构、迁移与连接池
│   ├── events.md                     # Tauri 事件定义文档
│   ├── i18n.md                       # 国际化说明文档
│   └── architecture.md               # 架构说明
│
├── scripts/
│   ├── init_db.ps1                   # 初始化数据库脚本（PowerShell）
│   ├── dev.ps1                       # 一键启动开发环境（PowerShell）
│   └── check_locales.mjs             # locale 键集合校验，由 `pnpm lint` 执行
│
├── package.json
├── pnpm-lock.yaml
├── vite.config.ts
├── tsconfig.json
├── index.html
├── .gitignore
├── README.md                         # 英文说明（默认）
├── README.zh-CN.md                   # 中文说明（本文件）
├── TODO.md                           # 英文任务拆分（默认）
├── TODO.zh-CN.md                     # 中文任务拆分
├── CONTRIBUTING.md                   # 英文贡献指南（默认）
└── CONTRIBUTING.zh-CN.md             # 中文贡献指南（本文件）
```

## 开发环境

| 依赖 | 版本要求 |
| --- | --- |
| Windows | 10 1903+ / 11（x64） |
| Node.js | 20 LTS 及以上 |
| 包管理器 | pnpm（推荐）或 npm |
| Rust | stable（MSVC toolchain） |
| Visual Studio Build Tools | 含「使用 C++ 的桌面开发」工作负载 |
| WebView2 Runtime | 最新版 |

## 快速开始

```powershell
# 1. 安装前端依赖
pnpm install

# 2. 生成应用图标（图标为生成产物，仓库只保留 app-icon.svg 源文件）
pnpm icons

# 3. 初始化本地数据库（可选，首次运行会自动建表）
powershell -ExecutionPolicy Bypass -File scripts/init_db.ps1

# 4. 启动开发环境（前端热更新 + Rust 后端）
pnpm tauri dev
# 或使用一键脚本
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1

# 5. 打包 Windows 安装包（msi / nsis）
pnpm tauri build
```

> 采集器需要读取前台窗口信息，它跑在应用进程内、使用你本人的账户。如遇杀软拦截，在该工具里放行 SentryNeko 的可执行文件即可，没有需要单独注册的东西。开机自启是设置页上的一个开关，会在 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 下写入一条值。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md) | 分层架构、数据流与模块职责 |
| [docs/commands.zh-CN.md](docs/commands.zh-CN.md) | Tauri 命令签名与返回格式 |
| [docs/database.zh-CN.md](docs/database.zh-CN.md) | 表结构、迁移、连接池与 `scripts/init_db.ps1` |
| [docs/events.zh-CN.md](docs/events.zh-CN.md) | Tauri 事件定义与触发时机 |
| [docs/i18n.zh-CN.md](docs/i18n.zh-CN.md) | 文案组织与新增语言步骤 |
| [docs/tray.zh-CN.md](docs/tray.zh-CN.md) | 系统托盘：关闭即隐藏、菜单项与实时今日行 |
| [TODO.zh-CN.md](TODO.zh-CN.md) | 功能拆解、优先级与依赖关系 |
| [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) | 分支约定、提交规范与完成标准 |

> `docs/` 下的文档均为双语：每份都有一个英文默认版 `<name>.md` 和对应的简体中文版 `<name>.zh-CN.md`，本表指向中文版。

## 许可证

[Apache License 2.0](LICENSE) © 2026 haloneko

原创应用图标（`src-tauri/app-icon.svg`）将紫色猫咪轮廓与时钟结合，沿用界面的深灰、紫色与灰白配色，并遵循项目的 Apache License 2.0 许可证。编辑 SVG 后运行 `pnpm icons`，即可重新生成窗口、托盘与安装包图标；`src-tauri/icons/` 下的生成文件不纳入版本控制。
