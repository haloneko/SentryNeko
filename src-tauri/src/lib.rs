//! Module registration and Tauri application bootstrap.

pub mod collectors;
pub mod commands;
pub mod config;
pub mod db;
pub mod models;
pub mod services;
pub mod utils;

use tauri::{Manager, RunEvent};

use crate::collectors::foreground_app::RunningCollector;
use crate::commands::{
    alarm_commands, app_event_commands, event_commands, heatmap_commands, notification_commands,
    pomodoro_commands, settings_commands, system_commands, tag_commands, todo_commands,
};
use crate::config::Config;
use crate::db::connection::Db;
use crate::db::schema;
use crate::services::autostart::{self, Autostart, WindowsRunKey};
use crate::services::event_bus::EventBus;
use crate::services::scheduler::RunningScheduler;
use crate::services::tray;

/// Builds and runs the application.
pub fn run() {
    let app = tauri::Builder::default()
        // Check before any other plugin or setup can create another tray or background worker.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            let config = Config::open(&directory)?;
            let db = Db::open(config.database_path()?)?;
            schema::ensure(&db)?;
            crate::models::todo::Todo::advance_recurring(&db, crate::utils::time::now_seconds())?;
            app.manage(config.clone());
            app.manage(db.clone());
            let bus = EventBus::new(app.handle().clone());
            app.manage(bus.clone());
            app.manage(RunningCollector::spawn(db.clone(), bus.clone())?);
            app.manage(RunningScheduler::spawn(
                db.clone(),
                bus.clone(),
                config.clone(),
                app.handle().clone(),
            )?);
            app.manage(tray::Tray::install(app.handle(), db, config, bus)?);
            app.manage(Autostart::new(WindowsRunKey));

            // The window is the face of a resident app: closing it parks it in the tray instead of
            // ending the process, so the tracking and the alarms keep running.
            if let Some(window) = app.get_webview_window(tray::WINDOW_LABEL) {
                tray::hide_on_close(&window);
            }

            // A login start stays in the tray: nobody asked for a window at that moment.
            if autostart::launched_at_login() {
                tray::hide_window(app.handle());
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings_commands::get_language,
            settings_commands::set_language,
            settings_commands::get_color_mode,
            settings_commands::set_color_mode,
            settings_commands::get_todo_display_mode,
            settings_commands::set_todo_display_mode,
            event_commands::emit_test_event,
            todo_commands::list_todos,
            todo_commands::add_todo,
            todo_commands::update_todo,
            todo_commands::set_todo_due_date,
            todo_commands::rename_todo,
            todo_commands::set_todo_completed,
            todo_commands::delete_todo,
            todo_commands::todo_counts,
            todo_commands::completion_rate,
            tag_commands::list_tags,
            tag_commands::add_tag,
            tag_commands::rename_tag,
            tag_commands::delete_tag,
            tag_commands::set_todo_tags,
            tag_commands::todo_tags,
            tag_commands::todos_with_tag,
            settings_commands::get_pomodoro_durations,
            settings_commands::set_pomodoro_durations,
            settings_commands::get_alarm_defaults,
            settings_commands::set_alarm_defaults,
            settings_commands::get_dashboard_layout,
            settings_commands::apply_dashboard_changes,
            settings_commands::get_autostart,
            settings_commands::set_autostart,
            notification_commands::send_test_notification,
            notification_commands::notify_pomodoro_phase,
            pomodoro_commands::start_pomodoro_session,
            pomodoro_commands::finish_pomodoro_session,
            pomodoro_commands::list_pomodoro_sessions,
            system_commands::get_uptime,
            app_event_commands::app_usage,
            app_event_commands::list_app_events,
            heatmap_commands::heatmap,
            alarm_commands::list_alarms,
            alarm_commands::add_alarm,
            alarm_commands::update_alarm,
            alarm_commands::set_alarm_enabled,
            alarm_commands::delete_alarm
        ])
        .build(tauri::generate_context!())
        .expect("error while building the SentryNeko application");

    app.run(|handle, event| {
        // Closing the app ends the collector's open row instead of leaving it open forever, and
        // stops the alarm loop instead of waiting for it to notice.
        if matches!(event, RunEvent::Exit) {
            if let Some(collector) = handle.try_state::<RunningCollector>() {
                collector.stop();
            }

            if let Some(scheduler) = handle.try_state::<RunningScheduler>() {
                scheduler.stop();
            }

            if let Some(tray) = handle.try_state::<tray::Tray>() {
                tray.stop();
            }
        }
    });
}
