//! System tray: the window parks here when it is closed, and the menu is the way back in.
//!
//! A resident app cannot be reopened from the taskbar once its window is gone, so closing the
//! window hides it instead of ending the process ([`hide_on_close`]). The menu carries the three
//! things that still make sense from outside the window — start a focus phase, see what today has
//! amounted to, and get the window back — plus the only way to actually quit.
//!
//! The "today" line is a disabled entry: a native menu cannot be updated while it is open, so a
//! background thread keeps it current and the user reads it as a summary, not a button.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent, Wry};

use crate::config::Config;
use crate::db::connection::Db;
use crate::models::heatmap::{self, Granularity};
use crate::services::event_bus::EventBus;
use crate::services::i18n::Language;
use crate::utils::response::{ApiError, ApiResult};
use crate::utils::time;
use crate::utils::windows;

/// Id the tray is registered under, so it can be found again to relabel it.
pub const TRAY_ID: &str = "sentryneko-tray";

/// Label of the window the tray shows, hides and parks.
pub const WINDOW_LABEL: &str = "main";

/// Hover text of the icon; the product name, which does not depend on the language.
const TOOLTIP: &str = "SentryNeko";

/// How often the "today" line catches up with the database.
pub const REFRESH: Duration = Duration::from_secs(60);

/// Menu ids; the event handler matches on values instead of literals.
pub mod ids {
    pub const START_POMODORO: &str = "tray-start-pomodoro";
    pub const TODAY: &str = "tray-today";
    pub const TOGGLE: &str = "tray-toggle-window";
    pub const QUIT: &str = "tray-quit";
}

/// What a menu entry asks the application to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// Start a focus phase and show the window; the timer itself lives in the frontend.
    StartPomodoro,
    /// Show the window when it is hidden, hide it when it is visible.
    ToggleWindow,
    /// End the process.
    Quit,
}

impl Action {
    /// Reads the action behind a menu id; the "today" line has none, it only reports.
    #[must_use]
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            ids::START_POMODORO => Some(Self::StartPomodoro),
            ids::TOGGLE => Some(Self::ToggleWindow),
            ids::QUIT => Some(Self::Quit),
            _ => None,
        }
    }
}

/// The copy the menu shows in one language.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Labels {
    pub start_pomodoro: String,
    pub toggle: String,
    pub quit: String,
}

/// The menu copy of one language.
#[must_use]
pub fn labels(language: Language) -> Labels {
    match language {
        Language::EnUs => Labels {
            start_pomodoro: "Start Pomodoro".to_owned(),
            toggle: "Show or hide window".to_owned(),
            quit: "Quit SentryNeko".to_owned(),
        },
        Language::ZhCn => Labels {
            start_pomodoro: "开始番茄钟".to_owned(),
            toggle: "显示 / 隐藏窗口".to_owned(),
            quit: "退出 SentryNeko".to_owned(),
        },
    }
}

/// The "today" line: what the focus timer and the todo list have produced since local midnight.
#[must_use]
pub fn today_label(language: Language, focus_seconds: i64, completed_tasks: i64) -> String {
    let hours = focus_seconds / 3600;
    let minutes = (focus_seconds % 3600) / 60;

    match (language, hours, focus_seconds, completed_tasks) {
        (Language::ZhCn, _, 0, 0) => "今日：还没有专注记录".to_owned(),
        (Language::ZhCn, 0, _, tasks) => format!("今日：专注 {minutes} 分钟 · 完成 {tasks} 项"),
        (Language::ZhCn, _, _, tasks) => {
            format!("今日：专注 {hours} 小时 {minutes} 分 · 完成 {tasks} 项")
        }
        (Language::EnUs, _, 0, 0) => "Today: nothing recorded yet".to_owned(),
        (Language::EnUs, 0, _, tasks) => format!("Today: {minutes} min focused · {tasks} done"),
        (Language::EnUs, _, _, tasks) => {
            format!("Today: {hours} h {minutes} min focused · {tasks} done")
        }
    }
}

/// Focus seconds and completed tasks of the local day `now` falls in.
pub fn today_totals(db: &Db, now: i64) -> ApiResult<(i64, i64)> {
    let start = windows::local_midnight(now)
        .ok_or_else(|| ApiError::internal("the local day has no start"))?;
    let buckets = heatmap::load(db, start, now.max(start) + 1, Granularity::Day)?;

    Ok(buckets.iter().fold((0, 0), |(focus, tasks), bucket| {
        (focus + bucket.focus_seconds, tasks + bucket.completed_tasks)
    }))
}

/// The tray, its menu entries and the thread that keeps the "today" line current.
pub struct Tray {
    db: Db,
    start_pomodoro: MenuItem<Wry>,
    today: MenuItem<Wry>,
    toggle: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    stopped: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Tray {
    /// Builds the icon, the menu and the refresh thread; leaves the window untouched.
    pub fn install(app: &AppHandle, db: Db, config: Config, bus: EventBus) -> ApiResult<Self> {
        let language = config.language().unwrap_or(Language::DEFAULT);
        let copy = labels(language);
        let icon = app
            .default_window_icon()
            .cloned()
            .ok_or_else(|| ApiError::internal("the application has no window icon for the tray"))?;

        // A database that cannot answer still gets a line, so a broken read cannot keep the tray
        // from appearing; the refresh thread fills in the real numbers as soon as one works.
        let line = today_line(&db, language).unwrap_or_else(|_| today_label(language, 0, 0));

        let start_pomodoro = MenuItemBuilder::with_id(ids::START_POMODORO, copy.start_pomodoro)
            .build(app)
            .map_err(|error| tray_error("the tray entry could not be built", error))?;
        let today = MenuItemBuilder::with_id(ids::TODAY, line)
            .enabled(false)
            .build(app)
            .map_err(|error| tray_error("the tray entry could not be built", error))?;
        let toggle = MenuItemBuilder::with_id(ids::TOGGLE, copy.toggle)
            .build(app)
            .map_err(|error| tray_error("the tray entry could not be built", error))?;
        let quit = MenuItemBuilder::with_id(ids::QUIT, copy.quit)
            .build(app)
            .map_err(|error| tray_error("the tray entry could not be built", error))?;

        let menu = MenuBuilder::new(app)
            .item(&start_pomodoro)
            .item(&today)
            .separator()
            .item(&toggle)
            .separator()
            .item(&quit)
            .build()
            .map_err(|error| tray_error("the tray menu could not be built", error))?;

        let menu_bus = bus.clone();

        TrayIconBuilder::with_id(TRAY_ID)
            .icon(icon)
            .menu(&menu)
            .show_menu_on_left_click(false)
            .tooltip(TOOLTIP)
            .on_menu_event(move |app, event| {
                handle_menu_event(app, event.id().as_ref(), &menu_bus);
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    toggle_window(tray.app_handle());
                }
            })
            .build(app)
            .map_err(|error| tray_error("the tray icon could not be added", error))?;

        let stopped = Arc::new(AtomicBool::new(false));
        let thread = spawn_refresh(Arc::clone(&stopped), today.clone(), db.clone(), config)?;

        Ok(Self {
            db,
            start_pomodoro,
            today,
            toggle,
            quit,
            stopped,
            thread: Mutex::new(Some(thread)),
        })
    }

    /// Rewrites the menu in `language`.
    ///
    /// The menu is native copy, so it has to follow the choice in the settings page; the "today"
    /// line is rebuilt from the database rather than waiting for the next refresh.
    pub fn relabel(&self, language: Language) {
        let copy = labels(language);

        // A menu that refuses the new text is left as it was; the choice still reaches the window.
        let _ = self.start_pomodoro.set_text(copy.start_pomodoro);
        let _ = self.toggle.set_text(copy.toggle);
        let _ = self.quit.set_text(copy.quit);

        if let Ok(with_today) = today_line(&self.db, language) {
            let _ = self.today.set_text(with_today);
        }
    }

    /// Asks the refresh thread to finish and waits for it.
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Relaxed);

        let Ok(mut thread) = self.thread.lock() else {
            return;
        };
        let Some(handle) = thread.take() else {
            return;
        };

        handle.thread().unpark();
        let _ = handle.join();
    }
}

/// Hides the window, e.g. when Windows started the application at login and the user asked for a
/// quiet start.
pub fn hide_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.hide();
    }
}

/// Parks the window in the tray when it is closed instead of ending the process.
pub fn hide_on_close(window: &WebviewWindow) {
    let parked = window.clone();

    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = parked.hide();
        }
    });
}

/// Runs one menu entry; an entry without an action (the "today" line) does nothing.
fn handle_menu_event(app: &AppHandle, id: &str, bus: &EventBus) {
    match Action::from_id(id) {
        Some(Action::StartPomodoro) => {
            // The window comes back first: the timer lives in the frontend, which has to be awake
            // to receive the push.
            show_window(app);
            let _ = bus.emit_tray_start_pomodoro();
        }
        Some(Action::ToggleWindow) => toggle_window(app),
        Some(Action::Quit) => app.exit(0),
        None => {}
    }
}

/// Brings the window back to the front, from the tray or from a minimized state.
pub fn show_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };

    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        show_window(app);
    }
}

/// Keeps the "today" line current while the app runs.
fn spawn_refresh(
    stopped: Arc<AtomicBool>,
    today: MenuItem<Wry>,
    db: Db,
    config: Config,
) -> ApiResult<JoinHandle<()>> {
    thread::Builder::new()
        .name("tray-stats".to_owned())
        .spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                thread::park_timeout(REFRESH);

                if stopped.load(Ordering::Relaxed) {
                    break;
                }

                let language = config.language().unwrap_or(Language::DEFAULT);

                // A failed read keeps the previous line instead of showing zeroes.
                if let Ok(text) = today_line(&db, language) {
                    let _ = today.set_text(text);
                }
            }
        })
        .map_err(|error| {
            ApiError::internal("the tray refresh thread could not start")
                .with_details(error.to_string())
        })
}

/// The "today" line as the menu should show it right now.
fn today_line(db: &Db, language: Language) -> ApiResult<String> {
    let (focus_seconds, completed_tasks) = today_totals(db, time::now_seconds())?;

    Ok(today_label(language, focus_seconds, completed_tasks))
}

/// Wraps a Tauri menu or tray failure in the envelope the rest of the app reports in.
fn tray_error(context: &str, error: tauri::Error) -> ApiError {
    ApiError::internal(context).with_details(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use crate::models::pomodoro::{Phase, PomodoroSession};
    use crate::models::todo::Todo;

    fn created() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        schema::ensure(&db).expect("schema is created");
        db
    }

    #[test]
    fn menu_ids_map_to_their_actions() {
        assert_eq!(
            Action::from_id(ids::START_POMODORO),
            Some(Action::StartPomodoro)
        );
        assert_eq!(Action::from_id(ids::TOGGLE), Some(Action::ToggleWindow));
        assert_eq!(Action::from_id(ids::QUIT), Some(Action::Quit));
        assert_eq!(
            Action::from_id(ids::TODAY),
            None,
            "the stats line only reports"
        );
        assert_eq!(Action::from_id("something-else"), None);
    }

    #[test]
    fn the_menu_copy_is_translated() {
        let english = labels(Language::EnUs);
        let chinese = labels(Language::ZhCn);

        assert!(english.start_pomodoro.starts_with("Start"));
        assert_ne!(english.start_pomodoro, chinese.start_pomodoro);
        assert_ne!(english.toggle, chinese.toggle);
        assert_ne!(english.quit, chinese.quit);
        assert!(english.quit.contains(TOOLTIP), "the product name is kept");
    }

    #[test]
    fn the_today_line_reads_minutes_when_the_day_is_short() {
        assert_eq!(
            today_label(Language::EnUs, 42 * 60, 3),
            "Today: 42 min focused · 3 done"
        );
        assert_eq!(
            today_label(Language::ZhCn, 42 * 60, 3),
            "今日：专注 42 分钟 · 完成 3 项"
        );
    }

    #[test]
    fn the_today_line_reads_hours_when_there_are_some() {
        assert_eq!(
            today_label(Language::EnUs, 3600 + 5 * 60, 1),
            "Today: 1 h 5 min focused · 1 done"
        );
        assert_eq!(
            today_label(Language::ZhCn, 3600 + 5 * 60, 1),
            "今日：专注 1 小时 5 分 · 完成 1 项"
        );
    }

    #[test]
    fn an_empty_day_says_so_instead_of_showing_zeroes() {
        let english = today_label(Language::EnUs, 0, 0);
        let chinese = today_label(Language::ZhCn, 0, 0);

        assert!(!english.contains('0'), "{english}");
        assert!(!chinese.contains('0'), "{chinese}");
        assert_ne!(english, chinese);
    }

    #[test]
    fn the_today_totals_come_from_the_heatmap_of_the_local_day() {
        let db = created();

        assert_eq!(
            today_totals(&db, time::now_seconds()).expect("totals"),
            (0, 0)
        );

        let finished = PomodoroSession::start(&db, Phase::Focus, 600, None).expect("started");
        PomodoroSession::finish(&db, finished.id, 600).expect("finished");
        let open = PomodoroSession::start(&db, Phase::Focus, 300, None).expect("started");

        let todo = Todo::add_with_due_date(&db, "ship the tray", None).expect("added");
        Todo::set_completed(&db, todo.id, true).expect("completed");

        let (focus_seconds, completed_tasks) =
            today_totals(&db, time::now_seconds()).expect("totals");

        assert_eq!(focus_seconds, 600, "only the closed phase counts");
        assert_eq!(completed_tasks, 1);
        assert_eq!(open.actual_seconds, None);
    }
}
