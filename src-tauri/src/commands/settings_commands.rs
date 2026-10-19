//! Settings commands: read and update persisted user settings.
//!
//! Preferences are reached through the four generic commands; a new one needs no command here.

use std::path::PathBuf;

use tauri::State;

use crate::config::Config;
use crate::db::connection::Db;
use crate::models::setting::Setting;
use crate::services::autostart::{Autostart, WindowsRunKey};
use crate::services::i18n::Language;
use crate::services::theme::ColorMode;
use crate::services::tray::Tray;
use crate::utils::response::{ApiError, ApiResponse, ApiResult};
use crate::version::PROGRAM_VERSION;

/// Reads one stored setting by key, `null` when nothing is filed under it.
#[tauri::command]
pub fn get_setting(db: State<'_, Db>, key: String) -> ApiResponse<Option<Setting>> {
    Setting::load(&db, &key).into()
}

/// Creates or replaces one setting; `value` is JSON text and `category` is the subject it belongs
/// to.
///
/// The backend stores both as given — it holds no model of any payload — so the caller owns the
/// shape of what it writes.
#[tauri::command]
pub fn set_setting(
    db: State<'_, Db>,
    key: String,
    value: String,
    category: String,
) -> ApiResponse<Setting> {
    Setting::set(&db, &key, &value, &category).into()
}

/// Lists settings in key order, narrowed to one category when it is given.
#[tauri::command]
pub fn list_settings(db: State<'_, Db>, category: Option<String>) -> ApiResponse<Vec<Setting>> {
    Setting::list(&db, category.as_deref()).into()
}

/// Removes one setting, answering `true` when a row was there.
#[tauri::command]
pub fn delete_setting(db: State<'_, Db>, key: String) -> ApiResponse<bool> {
    Setting::delete(&db, &key).into()
}

/// Reads whether Windows starts the application when the user signs in.
#[tauri::command]
pub fn get_autostart(autostart: State<'_, Autostart<WindowsRunKey>>) -> ApiResponse<bool> {
    program()
        .and_then(|program| autostart.enabled(&program))
        .into()
}

/// Registers or unregisters the application for a start at login.
#[tauri::command]
pub fn set_autostart(
    enabled: bool,
    autostart: State<'_, Autostart<WindowsRunKey>>,
) -> ApiResponse<bool> {
    program()
        .and_then(|program| autostart.set(&program, enabled))
        .into()
}

/// The executable a login entry has to point at.
fn program() -> ApiResult<PathBuf> {
    std::env::current_exe().map_err(|error| {
        ApiError::internal("the running executable cannot be located")
            .with_details(error.to_string())
    })
}

/// Reads the language stored in `config.json`.
#[tauri::command]
pub fn get_language(config: State<'_, Config>) -> ApiResponse<String> {
    read_language(&config).into()
}

/// Stores `language` in `config.json` and answers with the tag now in force.
#[tauri::command]
pub fn set_language(
    language: String,
    config: State<'_, Config>,
    tray: State<'_, Tray>,
) -> ApiResponse<String> {
    write_language(&config, &language)
        .map(|chosen| {
            // The tray menu is native copy, so it follows the choice without a restart.
            tray.relabel(chosen);

            chosen.code().to_owned()
        })
        .into()
}

fn read_language(config: &Config) -> ApiResult<String> {
    config.language().map(|language| language.code().to_owned())
}

fn write_language(config: &Config, tag: &str) -> ApiResult<Language> {
    let language = Language::from_code(tag).ok_or_else(|| {
        ApiError::invalid_input(format!("unknown language tag: {tag}"))
            .with_details(format!("expected one of: {}", known_tags()))
    })?;

    config.set_language(language)?;

    Ok(language)
}

fn known_tags() -> String {
    Language::ALL
        .iter()
        .map(|language| language.code())
        .collect::<Vec<_>>()
        .join(", ")
}

/// Reads the appearance stored in `config.json`.
#[tauri::command]
pub fn get_color_mode(config: State<'_, Config>) -> ApiResponse<String> {
    read_color_mode(&config).into()
}

/// Stores the appearance in `config.json` and answers with the mode now in force.
#[tauri::command]
pub fn set_color_mode(mode: String, config: State<'_, Config>) -> ApiResponse<String> {
    write_color_mode(&config, &mode)
        .map(|chosen| chosen.code().to_owned())
        .into()
}

fn read_color_mode(config: &Config) -> ApiResult<String> {
    config.color_mode().map(|mode| mode.code().to_owned())
}

fn write_color_mode(config: &Config, code: &str) -> ApiResult<ColorMode> {
    let mode = ColorMode::from_code(code).ok_or_else(|| {
        ApiError::invalid_input(format!("unknown color mode: {code}"))
            .with_details(format!("expected one of: {}", known_modes()))
    })?;

    config.set_color_mode(mode)?;

    Ok(mode)
}

/// Answers the version of this build, for the interface to display.
///
/// The number is compiled into the binary, so nothing is read from the configuration or the
/// database to produce it.
#[tauri::command]
pub fn get_version() -> ApiResponse<String> {
    ApiResponse::ok(PROGRAM_VERSION.to_owned())
}

fn known_modes() -> String {
    ColorMode::ALL
        .iter()
        .map(|mode| mode.code())
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::response::ApiCode;
    use tempfile::TempDir;

    fn temporary_directory() -> TempDir {
        tempfile::tempdir().expect("a temporary directory is created")
    }

    #[test]
    fn get_language_reports_the_stored_tag() {
        let directory = temporary_directory();
        let config = Config::open(directory.path()).expect("the configuration is created");
        config
            .set_language(Language::EnUs)
            .expect("English is saved");

        assert_eq!(read_language(&config).expect("language"), "en-US");

        write_language(&config, "zh-CN").expect("the tag is written");
        assert_eq!(read_language(&config).expect("language"), "zh-CN");
    }

    #[test]
    fn set_language_rejects_unknown_tags() {
        let directory = temporary_directory();
        let config = Config::open(directory.path()).expect("the configuration is created");
        let previous = read_language(&config).expect("language");

        let error = write_language(&config, "ja-JP").expect_err("the tag is rejected");

        assert_eq!(error.code(), ApiCode::InvalidInput);
        assert!(
            error.details().expect("details").contains("zh-CN"),
            "details list the known tags: {error:?}"
        );
        assert_eq!(read_language(&config).expect("language"), previous);
    }

    #[test]
    fn get_color_mode_reports_the_stored_mode() {
        let directory = temporary_directory();
        let config = Config::open(directory.path()).expect("the configuration is created");

        assert_eq!(read_color_mode(&config).expect("mode"), "system");

        write_color_mode(&config, "dark").expect("the mode is written");
        assert_eq!(read_color_mode(&config).expect("mode"), "dark");
    }

    #[test]
    fn set_color_mode_rejects_unknown_modes() {
        let directory = temporary_directory();
        let config = Config::open(directory.path()).expect("the configuration is created");

        let error = write_color_mode(&config, "sepia").expect_err("the mode is rejected");

        assert_eq!(error.code(), ApiCode::InvalidInput);
        assert!(
            error.details().expect("details").contains("light"),
            "details list the known modes: {error:?}"
        );
        assert_eq!(read_color_mode(&config).expect("mode"), "system");
    }

    #[test]
    fn the_choice_survives_a_restart() {
        let directory = temporary_directory();

        {
            let config = Config::open(directory.path()).expect("the configuration is created");
            write_language(&config, "zh-CN").expect("the tag is written");
        }

        let reopened = Config::open(directory.path()).expect("the configuration is read back");
        assert_eq!(read_language(&reopened).expect("language"), "zh-CN");
    }
}
