//! Module registration and Tauri application bootstrap.

pub mod collectors;
pub mod commands;
pub mod config;
pub mod db;
pub mod models;
pub mod services;
pub mod utils;
pub mod version;

use tauri::{Manager, RunEvent};

use crate::collectors::focus_tick::FocusTicker;
use crate::collectors::foreground_app::RunningCollector;
use crate::commands::{
    alarm_commands, app_event_commands, event_commands, heatmap_commands, migration_commands,
    notification_commands, pomodoro_commands, settings_commands, system_commands, tag_commands,
    todo_commands,
};
use crate::config::Config;
use crate::db::upgrade;
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
            // The database file's name carries the version that wrote it. A file named for this
            // build is opened as it stands; any other name is carried into this build's file first,
            // and only a copy that committed in full moves the configuration — a failed one leaves
            // the previous build's file on record and starts nothing that reads a database.
            let migration = match upgrade::open(&config)? {
                upgrade::Opened::Current(db) => {
                    app.manage(db.clone());
                    let bus = EventBus::new(app.handle().clone());
                    app.manage(bus.clone());
                    // Usage is counted in hourly buckets from this build on, so the events stored
                    // before it are folded in once, while they are still the only record of time.
                    crate::models::app_event::AppUsage::backfill(
                        &db,
                        crate::utils::time::now_seconds(),
                    )?;
                    // The focus clock lives here, not in a row: a stretch left by an earlier run is
                    // simply gone, and its seconds were already written a minute at a time.
                    app.manage(FocusTicker::spawn(db.clone(), bus.clone())?);
                    app.manage(RunningCollector::spawn(db.clone(), bus.clone())?);
                    app.manage(RunningScheduler::spawn(
                        db.clone(),
                        bus.clone(),
                        config.clone(),
                        app.handle().clone(),
                    )?);
                    app.manage(tray::Tray::install(app.handle(), db, config.clone(), bus)?);
                    app.manage(Autostart::new(WindowsRunKey));

                    // The window is the face of a resident app: closing it parks it in the tray
                    // instead of ending the process, so the tracking and the alarms keep running.
                    if let Some(window) = app.get_webview_window(tray::WINDOW_LABEL) {
                        tray::hide_on_close(&window);
                    }

                    // A login start stays in the tray: nobody asked for a window at that moment.
                    if autostart::launched_at_login() {
                        tray::hide_window(app.handle());
                    }

                    upgrade::Migration::current()
                }
                upgrade::Opened::Stranded(stranded) => {
                    // No database means nothing that reads one is started, and no tray to park a
                    // window in: closing the window ends the process, which is the only way
                    // forward. The window opens on the rollback the interface offers.
                    upgrade::Migration::stranded(stranded)
                }
            };

            app.manage(config);
            app.manage(migration);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings_commands::get_language,
            settings_commands::set_language,
            settings_commands::get_color_mode,
            settings_commands::set_color_mode,
            settings_commands::get_version,
            migration_commands::get_stranded,
            migration_commands::roll_back,
            event_commands::emit_test_event,
            todo_commands::list_todos,
            todo_commands::add_todo,
            todo_commands::rename_todo,
            todo_commands::set_todo_start_at,
            todo_commands::set_todo_end_at,
            todo_commands::set_todo_completed,
            todo_commands::set_todo_starred,
            todo_commands::set_todo_extra,
            todo_commands::delete_todo,
            todo_commands::todo_counts,
            todo_commands::todo_completions,
            tag_commands::list_tags,
            tag_commands::add_tag,
            tag_commands::rename_tag,
            tag_commands::delete_tag,
            tag_commands::set_todo_tags,
            tag_commands::todo_tags,
            tag_commands::todos_with_tag,
            settings_commands::get_setting,
            settings_commands::set_setting,
            settings_commands::list_settings,
            settings_commands::delete_setting,
            settings_commands::get_autostart,
            settings_commands::set_autostart,
            notification_commands::send_test_notification,
            notification_commands::notify_pomodoro_phase,
            pomodoro_commands::start_pomodoro_session,
            pomodoro_commands::stop_pomodoro_session,
            pomodoro_commands::get_running_pomodoro_session,
            pomodoro_commands::focus_categories,
            system_commands::get_uptime,
            app_event_commands::app_usage,
            app_event_commands::app_usage_hours,
            app_event_commands::list_app_events,
            app_event_commands::list_app_events_between,
            heatmap_commands::heatmap,
            heatmap_commands::focus_hours,
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
            // The thread stops first, then the stretch writes its last partial minute: quitting
            // must not cost the seconds since the previous tick.
            if let Some(ticker) = handle.try_state::<FocusTicker>() {
                ticker.shutdown();
                let _ = ticker.stop();
            }

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
