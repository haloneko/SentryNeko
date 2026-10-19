//! Dashboard layout: which widgets the home page shows and which cells each one takes.
//!
//! The page is a two-column grid; every placement has its own id, so one kind may appear several
//! times. The row is `dashboard.grid`, written whole through the generic settings commands. The
//! widget catalogue belongs to the frontend, so only the shape is checked here.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::utils::response::{ApiError, ApiResult};

/// Key of the layout row in the `settings` table. A new key, because the order-based layout of the
/// first build cannot be read as cell coordinates; that row is simply left behind.
pub(crate) const LAYOUT_KEY: &str = "dashboard.grid";

/// Widest a widget id or kind may get, so a corrupt file cannot bloat the row.
const MAX_NAME_LENGTH: usize = 32;

/// Most widgets one dashboard may hold; a guard against runaway files, not a product limit.
const MAX_WIDGETS: usize = 24;

/// Columns the dashboard grid has; the page draws the same number.
const GRID_COLUMNS: u32 = 2;

/// Tallest a widget may get, in rows.
const MAX_WIDGET_HEIGHT: u32 = 3;

/// Deepest a widget may start, so a corrupt row cannot open an endless grid.
const MAX_GRID_ROWS: u32 = 32;

/// One placed widget: its identity, what it draws, the cells it takes and where it reads from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardWidget {
    /// Identity of this placement; unique inside the layout, while `kind` may repeat.
    #[serde(default)]
    pub id: String,
    /// Widget type, drawn by the page; the same kind may be placed several times.
    pub kind: String,
    /// Column of the top-left cell, 0-based.
    #[serde(default)]
    pub x: u32,
    /// Row of the top-left cell, 0-based.
    #[serde(default)]
    pub y: u32,
    /// Cells across, 1..=2.
    #[serde(default = "one")]
    pub w: u32,
    /// Cells down, 1..=3.
    #[serde(default = "one")]
    pub h: u32,
    /// Data-source preset of the kind; empty for widgets that have nothing to choose.
    #[serde(default)]
    pub source: String,
}

/// Default span of a widget, so a row written before the grid still opens.
fn one() -> u32 {
    1
}

/// The whole dashboard, a widget per placement.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardLayout {
    #[serde(default)]
    pub widgets: Vec<DashboardWidget>,
}

impl DashboardLayout {
    /// Checks the shape; the settings table calls this before it stores the payload.
    pub(crate) fn validate(&self) -> ApiResult<()> {
        if self.widgets.len() > MAX_WIDGETS {
            return Err(ApiError::invalid_input(format!(
                "a dashboard holds at most {MAX_WIDGETS} widgets"
            ))
            .with_details(format!("received {}", self.widgets.len())));
        }

        let mut ids = HashSet::new();

        for widget in &self.widgets {
            check_name("id", &widget.id)?;
            check_name("kind", &widget.kind)?;

            if !ids.insert(widget.id.as_str()) {
                return Err(ApiError::invalid_input(format!(
                    "the widget id {} appears twice",
                    widget.id
                )));
            }

            if widget.w == 0 || widget.w > GRID_COLUMNS {
                return Err(ApiError::invalid_input(format!(
                    "widget {} has an impossible width: {}",
                    widget.id, widget.w
                ))
                .with_details(format!("the grid is {GRID_COLUMNS} columns wide")));
            }

            if widget.h == 0 || widget.h > MAX_WIDGET_HEIGHT {
                return Err(ApiError::invalid_input(format!(
                    "widget {} has an impossible height: {}",
                    widget.id, widget.h
                ))
                .with_details(format!("a widget spans 1 to {MAX_WIDGET_HEIGHT} rows")));
            }

            if widget.x.saturating_add(widget.w) > GRID_COLUMNS {
                return Err(ApiError::invalid_input(format!(
                    "widget {} starts outside the grid",
                    widget.id
                ))
                .with_details(format!(
                    "a widget of width {} has to start in column 0 or 1",
                    widget.w
                )));
            }

            if widget.y.saturating_add(widget.h) > MAX_GRID_ROWS {
                return Err(ApiError::invalid_input(format!(
                    "widget {} reaches past the last row",
                    widget.id
                ))
                .with_details(format!("the grid is {MAX_GRID_ROWS} rows deep")));
            }

            if widget.source.len() > MAX_NAME_LENGTH {
                return Err(ApiError::invalid_input(format!(
                    "source of {} must be at most {MAX_NAME_LENGTH} characters",
                    widget.id
                ))
                .with_details(format!("received {}", widget.source.len())));
            }
        }

        Ok(())
    }
}

/// Rejects an empty or over-long id or kind.
fn check_name(field: &str, value: &str) -> ApiResult<()> {
    if value.trim().is_empty() {
        return Err(ApiError::invalid_input(format!(
            "{field} must not be empty"
        )));
    }

    if value.len() > MAX_NAME_LENGTH {
        return Err(ApiError::invalid_input(format!(
            "{field} must be at most {MAX_NAME_LENGTH} characters"
        ))
        .with_details(format!("received {}", value.len())));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::Db;
    use crate::db::schema;
    use crate::models::setting::Setting;
    use crate::utils::response::ApiCode;

    fn created() -> Db {
        let db = Db::open_in_memory().expect("in-memory database opens");
        schema::ensure(&db).expect("schema is created");
        db
    }

    fn widget(id: &str, kind: &str) -> DashboardWidget {
        DashboardWidget {
            id: id.to_owned(),
            kind: kind.to_owned(),
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            source: String::new(),
        }
    }

    fn at(id: &str, kind: &str, x: u32, y: u32, w: u32, h: u32) -> DashboardWidget {
        DashboardWidget {
            id: id.to_owned(),
            kind: kind.to_owned(),
            x,
            y,
            w,
            h,
            source: String::new(),
        }
    }

    fn layout(widgets: Vec<DashboardWidget>) -> DashboardLayout {
        DashboardLayout { widgets }
    }

    /// Stores through the settings table, which is the path a command takes.
    fn store(db: &Db, widgets: Vec<DashboardWidget>) -> ApiResult<DashboardLayout> {
        let chosen = layout(widgets);
        Setting::write_json(db, LAYOUT_KEY, &chosen)?;

        Ok(chosen)
    }

    #[test]
    fn a_fresh_database_has_no_layout() {
        assert_eq!(
            Setting::read_json::<DashboardLayout>(&created(), LAYOUT_KEY)
                .expect("the layout is read"),
            None
        );
    }

    #[test]
    fn a_saved_layout_comes_back() {
        let db = created();
        let saved = store(
            &db,
            vec![
                at("focus-1", "focus", 0, 0, 1, 2),
                at("todos-1", "todos", 1, 0, 1, 1),
            ],
        )
        .expect("the layout is stored");

        assert_eq!(
            Setting::read_json::<DashboardLayout>(&db, LAYOUT_KEY).expect("the layout is read"),
            Some(saved)
        );
    }

    #[test]
    fn one_kind_may_be_placed_several_times() {
        let stored = store(
            &created(),
            vec![
                at("todos-1", "todos", 0, 0, 1, 1),
                at("todos-2", "todos", 1, 0, 1, 1),
            ],
        )
        .expect("two placements of one kind are accepted");

        assert_eq!(stored.widgets.len(), 2);
    }

    #[test]
    fn one_id_may_appear_only_once() {
        let error = store(
            &created(),
            vec![widget("todos-1", "todos"), widget("todos-1", "focus")],
        )
        .expect_err("the duplicate id is rejected");

        assert_eq!(error.code(), ApiCode::InvalidInput);
        assert!(error.message().contains("todos-1"), "{error:?}");
    }

    #[test]
    fn a_widget_wider_than_the_grid_is_rejected() {
        let error = store(&created(), vec![at("focus-1", "focus", 0, 0, 3, 1)])
            .expect_err("the width is rejected");

        assert_eq!(error.code(), ApiCode::InvalidInput);
        assert!(
            error.details().expect("details").contains("columns"),
            "details explain the grid: {error:?}"
        );
    }

    #[test]
    fn a_widget_taller_than_the_grid_is_rejected() {
        let error = store(&created(), vec![at("focus-1", "focus", 0, 0, 1, 4)])
            .expect_err("the height is rejected");

        assert_eq!(error.code(), ApiCode::InvalidInput);
    }

    #[test]
    fn a_widget_cannot_start_past_the_last_column() {
        let error = store(&created(), vec![at("focus-1", "focus", 1, 0, 2, 1)])
            .expect_err("the placement is rejected");

        assert_eq!(error.code(), ApiCode::InvalidInput);
        assert!(
            error.message().contains("outside"),
            "the message names the problem: {error:?}"
        );
    }

    #[test]
    fn an_empty_id_is_rejected() {
        let error =
            store(&created(), vec![widget("", "focus")]).expect_err("the empty id is rejected");

        assert_eq!(error.code(), ApiCode::InvalidInput);
    }

    #[test]
    fn too_many_widgets_are_rejected() {
        let widgets = (0..=MAX_WIDGETS)
            .map(|index| widget(&format!("focus-{index}"), "focus"))
            .collect();

        let error = store(&created(), widgets).expect_err("the oversized layout is rejected");

        assert_eq!(error.code(), ApiCode::InvalidInput);
    }
}
