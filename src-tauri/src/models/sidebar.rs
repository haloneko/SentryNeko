//! Sidebar layout: which panels the rail shows and in what order.
//!
//! The panel catalogue belongs to the frontend, so only the shape is guarded: ids are non-empty and
//! unique, and the list is not empty. The row is `sidebar.panels`, read and written through the
//! generic settings commands.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::utils::response::{ApiError, ApiResult};

/// Key of the layout row in the `settings` table.
pub(crate) const LAYOUT_KEY: &str = "sidebar.panels";

/// Longest panel id accepted.
const MAX_PANEL_ID_LENGTH: usize = 32;

/// Most panels one rail may hold.
const MAX_PANELS: usize = 32;

/// One entry: the panel's id and whether the rail draws it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarPanel {
    /// Panel id, matching the catalogue the frontend ships.
    pub id: String,
    /// Missing in old rows, where the panel was shown.
    #[serde(default = "shown")]
    pub visible: bool,
}

/// The whole rail, in the order it draws.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarLayout {
    #[serde(default)]
    pub panels: Vec<SidebarPanel>,
}

impl SidebarLayout {
    /// Checks the shape before the settings table stores it.
    pub(crate) fn validate(&self) -> ApiResult<()> {
        if self.panels.is_empty() {
            return Err(ApiError::invalid_input(
                "a sidebar layout needs at least one panel",
            ));
        }

        if self.panels.len() > MAX_PANELS {
            return Err(ApiError::invalid_input(format!(
                "a sidebar holds at most {MAX_PANELS} panels"
            ))
            .with_details(format!("received {}", self.panels.len())));
        }

        let mut ids = HashSet::new();

        for panel in &self.panels {
            check_id(&panel.id)?;

            if !ids.insert(panel.id.as_str()) {
                return Err(ApiError::invalid_input(format!(
                    "the panel {} appears twice",
                    panel.id
                )));
            }
        }

        Ok(())
    }
}

/// A panel missing its flag is drawn: the rail showed everything before hiding existed.
fn shown() -> bool {
    true
}

/// Rejects an empty or over-long panel id.
fn check_id(id: &str) -> ApiResult<()> {
    if id.trim().is_empty() {
        return Err(ApiError::invalid_input("a panel id must not be empty"));
    }

    if id.len() > MAX_PANEL_ID_LENGTH {
        return Err(ApiError::invalid_input(format!(
            "a panel id must be at most {MAX_PANEL_ID_LENGTH} characters"
        ))
        .with_details(format!("received {}", id.len())));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::Db;
    use crate::db::schema;
    use crate::models::setting::{Setting, CATEGORY_SIDEBAR};
    use crate::utils::response::ApiCode;

    fn created() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        schema::ensure(&db).expect("schema is created");
        db
    }

    fn panel(id: &str, visible: bool) -> SidebarPanel {
        SidebarPanel {
            id: id.to_owned(),
            visible,
        }
    }

    fn layout(panels: Vec<SidebarPanel>) -> SidebarLayout {
        SidebarLayout { panels }
    }

    /// Stores through the settings table, which is the path a command takes.
    fn store(db: &Db, panels: Vec<SidebarPanel>) -> ApiResult<SidebarLayout> {
        let chosen = layout(panels);
        Setting::write_json(db, LAYOUT_KEY, &chosen)?;

        Ok(chosen)
    }

    fn load(db: &Db) -> ApiResult<Option<SidebarLayout>> {
        Setting::read_json(db, LAYOUT_KEY)
    }

    #[test]
    fn a_fresh_database_has_no_layout() {
        assert_eq!(load(&created()).expect("the layout is read"), None);
    }

    #[test]
    fn a_saved_layout_comes_back_in_order() {
        let db = created();
        let chosen = store(
            &db,
            vec![
                panel("todos", true),
                panel("dashboard", false),
                panel("heatmap", true),
            ],
        )
        .expect("the layout is stored");

        assert_eq!(load(&db).expect("the layout is read"), Some(chosen));
    }

    #[test]
    fn the_row_is_filed_under_the_sidebar_category() {
        let db = created();
        store(&db, vec![panel("dashboard", true)]).expect("stored");

        let rows = Setting::list(&db, Some(CATEGORY_SIDEBAR)).expect("the category is listed");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].key, LAYOUT_KEY);
    }

    #[test]
    fn a_panel_written_without_the_flag_is_shown() {
        let stored: SidebarLayout = serde_json::from_str(r#"{"panels":[{"id":"todos"}]}"#)
            .expect("the payload is readable");

        assert_eq!(stored.panels, vec![panel("todos", true)]);
    }

    #[test]
    fn one_panel_may_appear_only_once() {
        let error = store(
            &created(),
            vec![panel("todos", true), panel("todos", false)],
        )
        .expect_err("the duplicate is rejected");

        assert_eq!(error.code(), ApiCode::InvalidInput);
        assert!(error.message().contains("todos"), "{error:?}");
    }

    #[test]
    fn an_empty_layout_is_rejected() {
        let error = store(&created(), Vec::new()).expect_err("the empty layout is rejected");

        assert_eq!(error.code(), ApiCode::InvalidInput);
    }

    #[test]
    fn an_empty_or_over_long_id_is_rejected() {
        let db = created();

        assert_eq!(
            store(&db, vec![panel("  ", true)])
                .expect_err("the empty id is rejected")
                .code(),
            ApiCode::InvalidInput
        );
        assert_eq!(
            store(&db, vec![panel(&"p".repeat(MAX_PANEL_ID_LENGTH + 1), true)])
                .expect_err("the long id is rejected")
                .code(),
            ApiCode::InvalidInput
        );
    }

    #[test]
    fn too_many_panels_are_rejected() {
        let panels = (0..=MAX_PANELS)
            .map(|index| panel(&format!("panel-{index}"), true))
            .collect();

        let error = store(&created(), panels).expect_err("the oversized layout is rejected");

        assert_eq!(error.code(), ApiCode::InvalidInput);
    }
}
