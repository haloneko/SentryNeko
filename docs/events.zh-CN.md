# Tauri 事件

[English](events.md) | **简体中文**

命令是前端发起的调用，事件是后端发起的推送。本文档中的每个事件都经 `services/event_bus.rs`
发出：采集器与定时器把载荷交给总线，由总线推送到 webview。

## 前端监听方式

不要直接调用 `listen`。`hooks/useTauriEvent.ts` 负责订阅并在卸载时清理；不在 Tauri 环境
（例如浏览器里直接 `pnpm dev`）时它不订阅任何东西，界面照常运行。

```tsx
import { BACKEND_EVENTS, useTauriEvent } from "../hooks/useTauriEvent";
import type { TestEventPayload } from "../types";

useTauriEvent<TestEventPayload>(BACKEND_EVENTS.testEvent, (payload) => {
  // payload.sequence
});
```

事件名集中在 `BACKEND_EVENTS`（`hooks/useTauriEvent.ts`），载荷类型在 `src/types/`，两者都在
下表中登记。

## 事件名

命名采用扁平 kebab-case。改名会打断所有监听方，因此改名视作新增事件：先加新名、迁移监听
方，再删旧名。

| 事件 | 载荷 | 触发时机 | 任务 |
| --- | --- | --- | --- |
| `test-event` | `TestEvent` —— `{ sequence: u64 }` | `emit_test_event` 按需推送一条，`sequence` 每次递增 | T08 |
| `notification-fallback` | `NotificationFallback` —— `{ kind, reason }` | `send_test_notification` 在系统拒绝 Toast 时推一条，前端改为在应用内显示 | T14 |
| `app-switch` | `AppEvent` —— `{ id, appName, windowTitle, startedAt, endedAt }` | 前台采集器开了一行，也就是另一个应用来到前台。同一个应用内标题变化只更新该行、不推送，因此一次推送对应一次切换 | T15 |
| `pomodoro-finished` | `PomodoroSession` —— `{ id, phase, plannedSeconds, actualSeconds, startedAt, endedAt, todoId }` | `finish_pomodoro_session` 关闭一个会话，历史视图无需轮询即可刷新；关闭它的那个窗口本来就已经知道 | T15 |
| `tray-start-pomodoro` | —（载荷为 `null`） | 托盘的 `开始番茄钟`：窗口已经先显示出来，外壳重新加载时长并从 store 启动这一轮，所以它和从页面上启动的完全一致 | T25 |
| `alarm-triggered` | `Alarm` —— `{ id, label, hour, minute, repeatDays, enabled, createdAt }` | `services/scheduler.rs` 走到闹钟的本地时间：提示音开始，并且除非存下的默认设置是 `inApp`，Toast（或它的 `notification-fallback`）都已先发出。单次闹钟此时已自动关闭，因此载荷里 `enabled` 为 `false` | T17、T18 |
| `todos-changed` | —（载荷为 `null`） | 任务修改成功或重复周期重置已提交。外壳重新读取当前筛选下的清单与计数，已挂载的完成率和热力图也会刷新。后台调度器每秒检查，窗口驻留托盘时仍然有效 | T34 |

外壳（`App.tsx`）只订阅一次 `app-switch`，把每条推送交给 `stores/appEventStore.ts` 保存最近几条。
`EventsPage` 分页读取数据库并把这份尾部数据放在最上面，因此打开页面时切应用会立即刷新，更早的历史
也能继续加载。外壳同时渲染
`AlarmRinging`：它把最新一条 `alarm-triggered` 留在屏幕上，直到用户关闭或者过一分钟——窗口在后台
时容易错过 Toast，而载荷本身就足够说明是哪个闹钟。

## 载荷规则

- 载荷是 `services/event_bus.rs` 中与事件名相邻的 `serde` 结构体，并在 `src/types/index.ts`
  中有对应接口；字段只有在类型声明为可选时才可选。
- 传输时属性名为 camelCase（`#[serde(rename_all = "camelCase")]`），前端读到的是 `startedAt`
  而不是 `started_at`。
- 时间戳一律用 UTC epoch 秒，与 `docs/database.md` 保持一致，展示时在前端格式化；预格式化
  的本地时间字符串不得进入载荷。
- 载荷中不放本地化文案：文案由前端用自己的 `t()` key 渲染。
