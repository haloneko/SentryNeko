//! Application configuration: database location, active language, appearance and user settings.

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};

use crate::db::connection::DATABASE_FILE_NAME;
use crate::models::font::FontSettings;
use crate::services::i18n::Language;
use crate::services::theme::ColorMode;
use crate::utils::response::{ApiCode, ApiError, ApiResult};

/// Configuration file created inside the application data directory.
pub const CONFIG_FILE_NAME: &str = "config.json";

/// Shape of `config.json`; an absent field falls back to its default.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredConfig {
    #[serde(default)]
    database_path: Option<PathBuf>,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    color_mode: String,
    #[serde(default)]
    font_settings: FontSettings,
}

/// Configuration as the application runs it, with every default resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
struct AppConfig {
    database_path: PathBuf,
    language: Language,
    color_mode: ColorMode,
    font_settings: FontSettings,
}

/// Loads, holds and rewrites `config.json`; share it through Tauri managed state.
///
/// Cloning hands out another handle to the same file and the same value, so a background service
/// that needs the interface language reads the one the settings page writes.
#[derive(Debug, Clone)]
pub struct Config {
    path: Arc<PathBuf>,
    current: Arc<RwLock<AppConfig>>,
}

impl Config {
    /// Reads the configuration and detects the system language if none is stored.
    pub fn open(directory: impl AsRef<Path>) -> ApiResult<Self> {
        Self::open_with_locale(directory, sys_locale::get_locale)
    }

    fn open_with_locale(
        directory: impl AsRef<Path>,
        detect_locale: impl FnOnce() -> Option<String>,
    ) -> ApiResult<Self> {
        let directory = directory.as_ref();
        std::fs::create_dir_all(directory)
            .map_err(|error| io_error("create directory", directory, &error))?;

        let path = directory.join(CONFIG_FILE_NAME);
        let (mut stored, contents) = match std::fs::read_to_string(&path) {
            Ok(contents) => (parse(&path, &contents)?, Some(contents)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                (StoredConfig::default(), None)
            }
            Err(error) => return Err(io_error("read", &path, &error)),
        };

        let language_missing = stored
            .language
            .as_deref()
            .map_or(true, |language| language.trim().is_empty());
        if language_missing {
            let language = detect_locale()
                .as_deref()
                .and_then(Language::from_locale)
                .unwrap_or(Language::DEFAULT);
            stored.language = Some(language.code().to_owned());
        }

        let config = Self {
            path: Arc::new(path),
            current: Arc::new(RwLock::new(stored.resolve(directory))),
        };

        match contents {
            Some(contents) if language_missing => {
                // Backfilling an existing file is best effort: a failed write must not
                // prevent startup with the language already resolved in memory.
                let _ = config.persist_detected_language(&contents);
            }
            None => config.persist(&config.snapshot()?)?,
            _ => {}
        }

        Ok(config)
    }

    /// Path of the configuration file itself.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Database file the application opens.
    pub fn database_path(&self) -> ApiResult<PathBuf> {
        Ok(self.snapshot()?.database_path)
    }

    /// Language in force.
    pub fn language(&self) -> ApiResult<Language> {
        Ok(self.snapshot()?.language)
    }

    /// Persists `language` and returns the language it replaced.
    pub fn set_language(&self, language: Language) -> ApiResult<Language> {
        let mut current = self.current.write().map_err(|_| lock_error("write"))?;
        let previous = current.language;

        if previous != language {
            let updated = AppConfig {
                language,
                ..current.clone()
            };
            self.persist(&updated)?;
            *current = updated;
        }

        Ok(previous)
    }

    /// Color mode in force.
    pub fn color_mode(&self) -> ApiResult<ColorMode> {
        Ok(self.snapshot()?.color_mode)
    }

    /// Persists `mode` and returns the mode it replaced.
    pub fn set_color_mode(&self, mode: ColorMode) -> ApiResult<ColorMode> {
        let mut current = self.current.write().map_err(|_| lock_error("write"))?;
        let previous = current.color_mode;

        if previous != mode {
            let updated = AppConfig {
                color_mode: mode,
                ..current.clone()
            };
            self.persist(&updated)?;
            *current = updated;
        }

        Ok(previous)
    }

    /// Typography in force, resolved before the frontend renders.
    pub fn font_settings(&self) -> ApiResult<FontSettings> {
        Ok(self.snapshot()?.font_settings)
    }

    /// Validates and persists the family and size together, preserving other preferences.
    pub fn set_font_settings(&self, settings: FontSettings) -> ApiResult<FontSettings> {
        settings.validate()?;
        let mut current = self.current.write().map_err(|_| lock_error("write"))?;

        if current.font_settings != settings {
            let updated = AppConfig {
                font_settings: settings.clone(),
                ..current.clone()
            };
            self.persist(&updated)?;
            *current = updated;
        }

        Ok(settings)
    }

    fn snapshot(&self) -> ApiResult<AppConfig> {
        self.current
            .read()
            .map_err(|_| lock_error("read"))
            .map(|current| current.clone())
    }

    /// Patches only the language, preserving relative paths and fields we do not recognise.
    fn persist_detected_language(&self, contents: &str) -> ApiResult<()> {
        let mut document: serde_json::Map<String, serde_json::Value> =
            parse(self.path(), contents)?;
        document.insert(
            "language".to_owned(),
            serde_json::Value::String(self.language()?.code().to_owned()),
        );
        self.write_document(&document)
    }

    fn persist(&self, config: &AppConfig) -> ApiResult<()> {
        self.write_document(&StoredConfig::from(config))
    }

    /// Writes beside the target and swaps, so a crash cannot truncate the file.
    fn write_document(&self, document: &impl Serialize) -> ApiResult<()> {
        let contents = serde_json::to_string_pretty(document).map_err(|error| {
            ApiError::new(ApiCode::Internal)
                .with_details(format!("serialize {}: {error}", self.path.display()))
        })?;

        let temporary = self.path.with_extension("json.tmp");
        std::fs::write(&temporary, format!("{contents}\n"))
            .map_err(|error| io_error("write", &temporary, &error))?;
        std::fs::rename(&temporary, self.path.as_path()).map_err(|error| {
            let _ = std::fs::remove_file(&temporary);
            io_error("replace", &self.path, &error)
        })
    }
}

impl StoredConfig {
    fn resolve(self, directory: &Path) -> AppConfig {
        let database_path = match self.database_path {
            Some(path) if path.is_absolute() => path,
            Some(path) => directory.join(path),
            None => directory.join(DATABASE_FILE_NAME),
        };

        AppConfig {
            database_path,
            language: self
                .language
                .as_deref()
                .and_then(Language::from_code)
                .unwrap_or(Language::DEFAULT),
            color_mode: ColorMode::from_code(&self.color_mode).unwrap_or(ColorMode::DEFAULT),
            font_settings: if self.font_settings.validate().is_ok() {
                self.font_settings
            } else {
                FontSettings::default()
            },
        }
    }
}

impl From<&AppConfig> for StoredConfig {
    fn from(config: &AppConfig) -> Self {
        Self {
            database_path: Some(config.database_path.clone()),
            language: Some(config.language.code().to_owned()),
            color_mode: config.color_mode.code().to_owned(),
            font_settings: config.font_settings.clone(),
        }
    }
}

fn parse<T: serde::de::DeserializeOwned>(path: &Path, contents: &str) -> ApiResult<T> {
    serde_json::from_str(contents).map_err(|error| {
        ApiError::new(ApiCode::Io).with_details(format!("parse {}: {error}", path.display()))
    })
}

fn io_error(action: &str, path: &Path, error: &std::io::Error) -> ApiError {
    ApiError::new(ApiCode::Io).with_details(format!("{action} {}: {error}", path.display()))
}

fn lock_error(action: &str) -> ApiError {
    ApiError::internal(format!("the configuration lock is poisoned ({action})"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::DATABASE_FILE_NAME;
    use tempfile::TempDir;

    fn temporary_directory() -> TempDir {
        tempfile::tempdir().expect("a temporary directory is created")
    }

    fn write_config(directory: &Path, contents: &str) -> PathBuf {
        let path = directory.join(CONFIG_FILE_NAME);
        std::fs::write(&path, contents).expect("the configuration is written");

        path
    }

    #[test]
    fn first_run_creates_the_configuration() {
        let directory = temporary_directory();
        let config = Config::open_with_locale(directory.path(), || None)
            .expect("the configuration is created");

        assert_eq!(config.path(), directory.path().join(CONFIG_FILE_NAME));
        assert_eq!(
            config.database_path().expect("database path"),
            directory.path().join(DATABASE_FILE_NAME)
        );
        assert_eq!(config.language().expect("language"), Language::DEFAULT);

        let stored: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(config.path()).expect("the configuration is readable"),
        )
        .expect("the configuration is json");

        assert_eq!(
            stored["databasePath"],
            serde_json::json!(directory.path().join(DATABASE_FILE_NAME).to_string_lossy())
        );
        assert_eq!(stored["language"], serde_json::json!("en-US"));
        assert_eq!(stored["colorMode"], serde_json::json!("system"));
    }

    #[test]
    fn first_run_detects_and_persists_the_system_language() {
        let directory = temporary_directory();
        let config = Config::open_with_locale(directory.path(), || Some("zh-Hans-CN".to_owned()))
            .expect("the configuration is created");

        assert_eq!(config.language().expect("language"), Language::ZhCn);
        let stored: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(config.path()).expect("the configuration is readable"),
        )
        .expect("the configuration is json");
        assert_eq!(stored["language"], "zh-CN");

        let reopened = Config::open_with_locale(directory.path(), || {
            panic!("a saved language must not query the operating system")
        })
        .expect("the configuration is read back");
        assert_eq!(reopened.language().expect("language"), Language::ZhCn);
    }

    #[test]
    fn an_unsupported_system_language_persists_the_fallback() {
        let directory = temporary_directory();
        let config = Config::open_with_locale(directory.path(), || Some("ja-JP".to_owned()))
            .expect("the configuration is created");
        assert_eq!(config.language().expect("language"), Language::EnUs);

        let reopened = Config::open_with_locale(directory.path(), || {
            panic!("the fallback must also be saved")
        })
        .expect("the configuration is read back");
        assert_eq!(reopened.language().expect("language"), Language::EnUs);
    }

    #[test]
    fn an_existing_configuration_without_a_language_is_completed() {
        for contents in [
            r#"{}"#,
            r#"{ "language": null }"#,
            r#"{ "language": "" }"#,
            r#"{ "language": "  " }"#,
        ] {
            let directory = temporary_directory();
            let mut stored: serde_json::Value = serde_json::from_str(contents).expect("json");
            stored["databasePath"] = serde_json::json!("library.db");
            stored["colorMode"] = serde_json::json!("dark");
            stored["futureSetting"] = serde_json::json!({"enabled": true, "items": [1, null]});
            let path = write_config(directory.path(), &stored.to_string());

            let config = Config::open_with_locale(directory.path(), || Some("zh-CN".to_owned()))
                .expect("the configuration is read");
            assert_eq!(config.language().expect("language"), Language::ZhCn);
            assert_eq!(config.color_mode().expect("color mode"), ColorMode::Dark);
            assert_eq!(
                config.database_path().expect("database path"),
                directory.path().join("library.db")
            );

            let saved: serde_json::Value = serde_json::from_str(
                &std::fs::read_to_string(path).expect("the configuration is readable"),
            )
            .expect("the configuration is json");
            stored["language"] = serde_json::json!("zh-CN");
            assert_eq!(saved, stored, "only the language field may change");
        }
    }

    #[test]
    fn detecting_language_keeps_relative_database_paths_portable() {
        let original = temporary_directory();
        let relocated = temporary_directory();
        let path = write_config(original.path(), r#"{ "databasePath": "data/library.db" }"#);
        let config = Config::open_with_locale(original.path(), || Some("zh-CN".to_owned()))
            .expect("the configuration is read");
        assert_eq!(
            config.database_path().expect("database path"),
            original.path().join("data/library.db")
        );

        let saved = std::fs::read_to_string(&path).expect("the configuration is readable");
        let document: serde_json::Value = serde_json::from_str(&saved).expect("json");
        assert_eq!(document["databasePath"], "data/library.db");
        write_config(relocated.path(), &saved);

        let reopened = Config::open_with_locale(relocated.path(), || {
            panic!("the saved language must survive relocation")
        })
        .expect("the relocated configuration is read");
        assert_eq!(
            reopened.database_path().expect("database path"),
            relocated.path().join("data/library.db")
        );
        assert_eq!(reopened.language().expect("language"), Language::ZhCn);
    }

    #[test]
    fn detecting_language_preserves_missing_and_unknown_fields() {
        let directory = temporary_directory();
        let mut document = serde_json::json!({
            "colorMode": "sepia",
            "futureSetting": {"enabled": true, "items": [1, null, "keep"]}
        });
        let path = write_config(directory.path(), &document.to_string());

        let config = Config::open_with_locale(directory.path(), || Some("zh-CN".to_owned()))
            .expect("the configuration is read");
        assert_eq!(config.color_mode().expect("color mode"), ColorMode::DEFAULT);
        assert_eq!(
            config.database_path().expect("database path"),
            directory.path().join(DATABASE_FILE_NAME)
        );

        let saved: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(path).expect("the configuration is readable"),
        )
        .expect("json");
        document["language"] = serde_json::json!("zh-CN");
        assert_eq!(
            saved, document,
            "defaults and unknown fields must stay untouched"
        );
    }

    #[test]
    fn an_existing_configuration_opens_when_saving_the_detected_language_fails() {
        let directory = temporary_directory();
        let contents = r#"{ "databasePath": "data/library.db", "futureSetting": true }"#;
        let path = write_config(directory.path(), contents);
        let temporary = path.with_extension("json.tmp");
        std::fs::create_dir(&temporary).expect("the temporary file path is blocked");

        let config = Config::open_with_locale(directory.path(), || Some("zh-CN".to_owned()))
            .expect("a failed language save must not prevent startup");
        assert_eq!(config.language().expect("language"), Language::ZhCn);
        assert_eq!(
            config.database_path().expect("database path"),
            directory.path().join("data/library.db")
        );
        assert_eq!(
            std::fs::read_to_string(&path).expect("the configuration is readable"),
            contents
        );

        std::fs::remove_dir(temporary).expect("the save obstruction is removed");
        let reopened = Config::open_with_locale(directory.path(), || Some("en-GB".to_owned()))
            .expect("detection and persistence are retried next launch");
        assert_eq!(reopened.language().expect("language"), Language::EnUs);
        let saved: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(path).expect("the configuration is readable"),
        )
        .expect("json");
        let mut expected: serde_json::Value = serde_json::from_str(contents).expect("json");
        expected["language"] = serde_json::json!("en-US");
        assert_eq!(saved, expected);
    }

    #[test]
    fn first_run_still_reports_a_failed_configuration_write() {
        let directory = temporary_directory();
        std::fs::create_dir(directory.path().join("config.json.tmp"))
            .expect("the temporary file path is blocked");

        let error = Config::open_with_locale(directory.path(), || None)
            .expect_err("a new configuration still requires a successful write");
        assert_eq!(error.code(), ApiCode::Io);
        assert!(!directory.path().join(CONFIG_FILE_NAME).exists());
    }

    #[test]
    fn the_color_mode_survives_a_restart() {
        let directory = temporary_directory();

        {
            let config = Config::open(directory.path()).expect("the configuration is created");
            assert_eq!(
                config
                    .set_color_mode(ColorMode::Dark)
                    .expect("the mode is written"),
                ColorMode::DEFAULT
            );
            assert_eq!(config.color_mode().expect("mode"), ColorMode::Dark);

            let stored: serde_json::Value = serde_json::from_str(
                &std::fs::read_to_string(config.path()).expect("the configuration is readable"),
            )
            .expect("the configuration is json");
            assert_eq!(stored["colorMode"], serde_json::json!("dark"));
        }

        let reopened = Config::open(directory.path()).expect("the configuration is read back");
        assert_eq!(reopened.color_mode().expect("mode"), ColorMode::Dark);
    }

    #[test]
    fn font_settings_survive_a_restart_and_preserve_other_preferences() {
        let directory = temporary_directory();
        let chosen = FontSettings {
            family: Some("JetBrains Mono".to_owned()),
            size: 24,
        };

        {
            let config = Config::open(directory.path()).expect("the configuration is created");
            config.set_language(Language::ZhCn).expect("language saved");
            config.set_color_mode(ColorMode::Light).expect("mode saved");
            config
                .set_font_settings(chosen.clone())
                .expect("font saved");
        }

        let config = Config::open(directory.path()).expect("configuration reopened");
        assert_eq!(config.font_settings().expect("font"), chosen);
        assert_eq!(config.language().expect("language"), Language::ZhCn);
        assert_eq!(config.color_mode().expect("mode"), ColorMode::Light);

        let before = std::fs::read(config.path()).expect("configuration readable");
        assert!(config
            .set_font_settings(FontSettings {
                size: 33,
                ..chosen.clone()
            })
            .is_err());
        assert_eq!(config.font_settings().expect("font"), chosen);
        assert_eq!(
            std::fs::read(config.path()).expect("configuration readable"),
            before
        );
    }

    #[test]
    fn missing_or_invalid_font_preferences_use_the_defaults() {
        let directory = temporary_directory();

        for contents in [
            r#"{ "language": "zh-CN" }"#,
            r#"{ "fontSettings": { "family": "Arial", "size": 9 } }"#,
            r#"{ "fontSettings": { "family": "", "size": 14 } }"#,
        ] {
            write_config(directory.path(), contents);
            let config = Config::open(directory.path()).expect("configuration opened");
            assert_eq!(
                config.font_settings().expect("font"),
                FontSettings::default()
            );
        }
    }

    #[test]
    fn an_unknown_color_mode_falls_back_to_the_system() {
        let directory = temporary_directory();
        write_config(directory.path(), r#"{ "colorMode": "sepia" }"#);

        let config = Config::open(directory.path()).expect("the configuration is read");

        assert_eq!(config.color_mode().expect("mode"), ColorMode::DEFAULT);
    }

    #[test]
    fn a_manual_language_overrides_detection_and_survives_a_restart() {
        let directory = temporary_directory();

        {
            let config = Config::open_with_locale(directory.path(), || Some("zh-CN".to_owned()))
                .expect("the configuration is created");
            assert_eq!(
                config
                    .set_language(Language::EnUs)
                    .expect("language is written"),
                Language::ZhCn
            );
            assert_eq!(config.language().expect("language"), Language::EnUs);
        }

        let reopened = Config::open_with_locale(directory.path(), || {
            panic!("a manual choice must not query the operating system")
        })
        .expect("the configuration is read back");
        assert_eq!(reopened.language().expect("language"), Language::EnUs);
    }

    #[test]
    fn a_configured_database_path_is_used() {
        let directory = temporary_directory();
        let elsewhere = temporary_directory();

        write_config(
            directory.path(),
            r#"{ "databasePath": "data\\library.db", "language": "zh-CN" }"#,
        );
        let relative = Config::open(directory.path()).expect("the configuration is read");
        assert_eq!(
            relative.database_path().expect("database path"),
            directory.path().join("data").join("library.db")
        );
        assert_eq!(relative.language().expect("language"), Language::ZhCn);

        write_config(
            directory.path(),
            &format!(
                r#"{{ "databasePath": "{}" }}"#,
                elsewhere
                    .path()
                    .join("library.db")
                    .display()
                    .to_string()
                    .replace('\\', "\\\\")
            ),
        );
        let absolute = Config::open(directory.path()).expect("the configuration is read");
        assert_eq!(
            absolute.database_path().expect("database path"),
            elsewhere.path().join("library.db")
        );
    }

    #[test]
    fn missing_fields_and_unknown_languages_fall_back() {
        let directory = temporary_directory();
        write_config(directory.path(), r#"{ "language": "ja-JP" }"#);

        let config = Config::open_with_locale(directory.path(), || {
            panic!("an unknown stored tag must retain its existing fallback behavior")
        })
        .expect("the configuration is read");

        assert_eq!(config.language().expect("language"), Language::DEFAULT);
        assert_eq!(
            config.database_path().expect("database path"),
            directory.path().join(DATABASE_FILE_NAME)
        );
        assert_eq!(
            std::fs::read_to_string(config.path()).expect("the configuration is readable"),
            r#"{ "language": "ja-JP" }"#
        );
    }

    #[test]
    fn a_malformed_configuration_is_reported_and_left_alone() {
        let directory = temporary_directory();
        let path = write_config(directory.path(), "{ not json");

        let error = Config::open(directory.path()).expect_err("the configuration is rejected");

        assert_eq!(error.code(), ApiCode::Io);
        assert!(
            error.details().expect("details").contains(CONFIG_FILE_NAME),
            "details name the file: {error:?}"
        );
        assert_eq!(
            std::fs::read_to_string(path).expect("the configuration is readable"),
            "{ not json"
        );
    }
}
