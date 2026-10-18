//! Interface typography, shared by the configuration and settings commands.

use serde::{Deserialize, Serialize};

use crate::utils::response::{ApiError, ApiResult};

pub const MIN_FONT_SIZE: i64 = 10;
pub const MAX_FONT_SIZE: i64 = 32;

/// `None` follows the system UI font; `JetBrains Mono` is bundled with the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FontSettings {
    pub family: Option<String>,
    pub size: i64,
}

impl Default for FontSettings {
    fn default() -> Self {
        Self {
            family: None,
            size: 14,
        }
    }
}

impl FontSettings {
    /// Validate before persisting; font names may contain spaces and non-Latin characters.
    pub fn validate(&self) -> ApiResult<()> {
        if !(MIN_FONT_SIZE..=MAX_FONT_SIZE).contains(&self.size) {
            return Err(ApiError::invalid_input(format!(
                "font size must be between {MIN_FONT_SIZE} and {MAX_FONT_SIZE} pixels"
            )));
        }

        if let Some(family) = &self.family {
            if family.is_empty()
                || family.trim() != family
                || family.chars().count() > 128
                || family.chars().any(char::is_control)
            {
                return Err(ApiError::invalid_input("invalid font family name"));
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_bundled_and_localized_system_families_at_both_size_limits() {
        for family in [None, Some("JetBrains Mono"), Some("微软雅黑")] {
            for size in [MIN_FONT_SIZE, MAX_FONT_SIZE] {
                assert!(FontSettings {
                    family: family.map(str::to_owned),
                    size,
                }
                .validate()
                .is_ok());
            }
        }
    }

    #[test]
    fn rejects_invalid_sizes_and_family_names() {
        for size in [-1, 0, MIN_FONT_SIZE - 1, MAX_FONT_SIZE + 1, i64::MAX] {
            assert!(FontSettings {
                size,
                ..FontSettings::default()
            }
            .validate()
            .is_err());
        }

        for family in ["", " ", " Arial", "Arial\n", "A\0B", &"a".repeat(129)] {
            assert!(FontSettings {
                family: Some(family.to_owned()),
                ..FontSettings::default()
            }
            .validate()
            .is_err());
        }
    }
}
