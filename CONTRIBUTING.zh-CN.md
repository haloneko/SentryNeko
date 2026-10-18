# SentryNeko 贡献指南

[English](CONTRIBUTING.md) | **简体中文**

感谢你关注 SentryNeko。本文说明开发环境、需要遵守的约定，以及一次改动在合并前必须达到的标准。

## 开始之前

- **仅支持 Windows。** SentryNeko 面向 Windows 10/11（x64），有意不引入跨平台抽象。不要新增 `cfg(target_os = ...)` 分支、平台无关的封装层，也不要补充 macOS/Linux 的构建说明。所有 Win32 调用统一放在 `src-tauri/src/utils/windows.rs`。
- **本地优先。** 不做埋点、不要账号、不发起网络请求。数据只存在本地 SQLite 文件里。
- **先看 [TODO.zh-CN.md](TODO.zh-CN.md)。** 它是范围与优先级的唯一依据：先做 P0 再做 P1，不要去动 P3（预留）项；确有必要时先在评审中升级为 P2。
- **README 中的目录结构是约定布局。** 新增文件应放进对应层（`models` / `commands` / `collectors` / `services` / `utils`），不要另建顶层模块。

## 开发环境

工具链要求见 [README.zh-CN.md](README.zh-CN.md#开发环境)（Windows 10 1903+、Node.js 20 LTS+、Rust stable MSVC、含「使用 C++ 的桌面开发」的 VS Build Tools、WebView2 Runtime）。

```powershell
pnpm install
pnpm tauri dev          # 前端热更新 + Rust 后端
```

## 分支约定

| 改动类型 | 分支名 | 说明 |
| --- | --- | --- |
| 新功能 | `feat/<任务编号>-<简短描述>`（如 `feat/t12-foreground-collector`） | 必须带 TODO 编号 |
| 缺陷修复 | `fix/<简短描述>` | |
| 仅文档 / 元数据 | `docs/<简短描述>` | |
| 工具链、依赖、CI | `chore/<简短描述>` | |

## 提交信息

使用英文 [Conventional Commits](https://www.conventionalcommits.org/) 风格，祈使句，标题不超过 72 字符。正文说明**做了什么**和**为什么**，涉及任务时标注 TODO 编号。

```
feat(pomodoro): persist focus sessions when a cycle completes

Sessions are written on phase transition instead of on window close,
so a crash no longer loses the current cycle.

Refs: T11
```

```
fix(collector): skip duplicate rows for an unchanged foreground window
docs: mark directory structure as planned rather than current
refactor(response): remove bare returns from the command layer
test(heatmap): cover week boundary aggregation
```

使用的类型：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`、`perf`。

**scope 名称**与模块对应：`pomodoro`、`todo`、`collector`、`alarm`、`heatmap`、`tray`、`i18n`、`db`、`response`，前端外壳（路由、布局、页面）用 `ui`。

## 完成标准

以下每一项都满足，改动才进入评审：

- [ ] 对应的 TODO.md 条目在**实现它的同一次提交**中被勾选为 `[x]`，提交信息中带上其 T 编号。
- [ ] `cargo fmt --check` 与 `cargo clippy -- -D warnings` 无告警（在 `src-tauri/` 下执行）。
- [ ] `cargo test` 通过；新增的纯逻辑（聚合、时间分桶、调度）需带测试。
- [ ] `pnpm lint`、`pnpm build` 通过。前端 TypeScript 为严格模式：不使用 `any`，不加无说明的 `@ts-ignore`。
- [ ] 用户可触发的路径上不使用 `unwrap()` / `expect()`，一律返回统一错误响应。
- [ ] Tauri 命令返回 `utils/response.rs` 的统一结构，签名同步写入 `docs/commands.md` + `docs/commands.zh-CN.md`。
- [ ] 新增 Tauri 事件在 `docs/events.md` 中记录负载类型与触发时机。
- [ ] 所有面向用户的文案同时存在于 `src/i18n/locales/zh-CN.json` 与 `en-US.json`（键集合一致性由 `pnpm lint` 校验）；后端错误以错误码返回并在 `services/i18n.rs` 中映射。界面不得硬编码文案。
- [ ] 行为、范围或优先级有变化时，同一提交内更新 `README.md` / `TODO.md` / `docs/*.md` 的对应章节。
- [ ] 不留调试输出、注释掉的代码或代码内 TODO 标记；待办事项写进 TODO.md。
- [ ] 不引入跨平台抽象；所有 Win32 调用经 `utils/windows.rs`。

## 代码约定

**Rust（`src-tauri/`）**

- 保持单向分层：`commands` → `services` / `db` → `models`；`collectors` 只向 `services::event_bus` 与 `db` 输出。
- 命令处理函数保持薄：校验入参 → 委托 → 映射为 `utils::response`。
- 采集器不直接接触 UI：通过事件总线推送，并通过 `db::repository` 落库。
- 时间统一以 UTC 时间戳存储，格式化放在 `utils/time.rs`；不要存预格式化好的本地时间字符串。
- 托盘与采集逻辑不得占用 UI 线程；定时调度统一放在 `services/scheduler.rs`。

**React / TypeScript（`src/`）**

- 只用函数组件与 Hook。取数在 `src/hooks`，状态在 `src/stores`，类型在 `src/types`。
- 组件里不直接调用 Tauri `invoke`，统一走 Hook 或 store。
- 事件监听复用 `hooks/useTauriEvent.ts`，不要直接 `listen`，以保证卸载时正确清理订阅。
- 倒计时与时长必须以时间戳推算，不依赖 `setInterval` 累加。
- 图表需处理加载中、空数据与错误三种状态。
- 样式集中在 `src/styles/app.css`：设计令牌写在 `:root`，其后是外壳与共享基础类。只有来自状态的值（例如测量出的位置）才写行内样式。
- 可复用、与具体功能无关的控件放 `src/components/ui/`，文案由调用方以 props 传入；只有一个页面用到的组件留在 `src/components/`。

## 测试

```powershell
# 后端
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings

# 前端
pnpm lint
pnpm test
pnpm build

# 数字输入框浏览器回归测试（首次需安装 Chromium）
pnpm exec playwright install chromium
pnpm test:numeric-input
```

`src/components/ui/` 中的 `NumericInput` 接收数值 `value`、`onChange`、可选的
`min` / `max` / 正数 `step`（默认 `1`），以及翻译后的 `increaseLabel` /
`decreaseLabel`。输入框本身使用关联的 label 或 `aria-label`。数值会限制在范围内，
手动输入按相对 `min`（未指定则为零）的步长就近取整。清空、符号或小数点可暂时保留编辑，
失焦或按 Enter 时恢复为当前数值。滚轮和箭头调节即时通知父组件；禁用或只读时允许页面正常滚动。

涉及前台应用采集、通知、托盘行为或开机自启的改动，还需要在真实 Windows 机器上手动过一遍：在几个应用间切换、让机器空闲、锁屏、从休眠恢复，然后确认记录的事件与时长合理。

## 文档

| 改动内容 | 需要更新 |
| --- | --- |
| 新增或修改 Tauri 命令 | `docs/commands.md` + `docs/commands.zh-CN.md` |
| 新增或修改 Tauri 事件 | `docs/events.md` + `docs/events.zh-CN.md` |
| 表、列、迁移、连接池参数或配置项 | `docs/database.md` + `docs/database.zh-CN.md` |
| 文案、locale key、语言列表 | `docs/i18n.md` + `docs/i18n.zh-CN.md` |
| 分层、数据流、模块职责 | `docs/architecture.md` + `docs/architecture.zh-CN.md` |
| 范围、优先级、里程碑 | `TODO.md` + `TODO.zh-CN.md` |
| 功能列表、搭建步骤、目录结构 | `README.md` + `README.zh-CN.md` |

**双语约定：** README、TODO、CONTRIBUTING 以及 `docs/` 下的每个文件均维护英文（默认）与简体中文两份——`<name>.md` 与 `<name>.zh-CN.md`。改动其中一份时，必须在同一提交内更新另一份，并保持两份文件结构一致——同样的标题、同样的顺序、同样的表格。

## 反馈问题

提 issue 请包含：

1. Windows 版本与内部版本号（`winver`），以及应用版本。
2. 复现步骤——能暴露问题的最短路径。
3. 期望行为与实际行为。
4. 采集器当时是否在运行，重启应用后问题是否仍存在。
5. 相关日志；若数据不对，说明你查看的聚合时间范围。

功能建议请先查 [TODO.zh-CN.md](TODO.zh-CN.md)：预留（🚧）项已在跟踪，若与之重合，写成「+1 并说明优先级理由」更有帮助。

## 许可证

提交贡献即表示你同意以 [Apache License 2.0](LICENSE) 授权你的工作，不附加任何额外条款。
