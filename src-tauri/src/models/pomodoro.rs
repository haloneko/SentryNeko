//! Pomodoro phases: the three kinds of interval a cycle walks through.

use serde::{Deserialize, Serialize};

/// Longest accepted phase length: four hours.
pub const MAX_SECONDS: i64 = 4 * 60 * 60;

/// The three kinds of interval a cycle walks through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Focus,
    ShortBreak,
    LongBreak,
}

impl Phase {
    /// Every phase, in the order a cycle visits them.
    pub const ALL: [Self; 3] = [Self::Focus, Self::ShortBreak, Self::LongBreak];
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Running {
    pub phase: Phase,
    /// UTC epoch seconds the stretch began at.
    pub started_at: i64,
    pub planned_seconds: i64,
    pub category: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phases_round_trip_through_their_json_names() {
        for phase in Phase::ALL {
            let name = serde_json::to_value(phase).expect("serialized");
            let parsed: Phase = serde_json::from_value(name).expect("parsed");

            assert_eq!(parsed, phase);
        }

        assert_eq!(
            serde_json::to_value(Phase::ShortBreak).expect("serialized"),
            serde_json::json!("shortBreak")
        );
    }
}
