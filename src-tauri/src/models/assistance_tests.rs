use super::*;
use crate::db::schema;
use crate::models::alarm::Alarm;

fn database() -> Db {
    let db = Db::open_in_memory().expect("database opens");
    schema::ensure(&db).expect("schema");
    db
}

fn propose(db: &Db, action: AiAction) -> Suggestion {
    Suggestion::propose(
        db,
        vec![Proposal {
            reason: "A useful next step".into(),
            action,
            expected_state: None,
        }],
    )
    .expect("proposed")
    .remove(0)
}

fn create(title: &str) -> AiAction {
    AiAction::CreateTodo {
        title: title.into(),
    }
}

#[test]
fn deadline_changes_invalidate_review_even_with_the_same_timestamp() {
    let db = database();
    let task = Todo::add_with_due_date(&db, "deadline", Some(0)).expect("task");
    let suggestion = propose(&db, AiAction::CompleteTodo { todo_id: task.id });
    repository::execute(
        &db,
        "UPDATE todos SET due_date = 86400 WHERE id = ?1",
        [task.id],
    )
    .expect("deadline changed without a timestamp update");
    assert_eq!(
        Suggestion::confirm(&db, suggestion.id, 1, true)
            .expect_err("fresh review required")
            .code(),
        ApiCode::Conflict
    );
    assert!(!Todo::find(&db, task.id).expect("task").completed);
}

#[test]
fn recurring_cycle_boundaries_invalidate_old_confirmations() {
    use crate::models::recurrence::{Recurrence, RecurrenceUnit};
    let db = database();
    let task = Todo::add_with_options(
        &db,
        "daily",
        Some(Recurrence {
            unit: RecurrenceUnit::Day,
            interval: 1,
        }),
        Some(0),
    )
    .expect("recurring dated task");
    let suggestion = propose(&db, AiAction::CompleteTodo { todo_id: task.id });
    let yesterday = time::now_seconds() - 86400;
    repository::execute(
        &db,
        "UPDATE todos SET created_at = ?1 WHERE id = ?2",
        params![yesterday, task.id],
    )
    .expect("move the series anchor into the previous cycle");
    repository::execute(
        &db,
        "UPDATE todo_recurrences SET current_at = ?1, next_at = ?2 WHERE todo_id = ?3",
        params![yesterday, time::now_seconds() - 1, task.id],
    )
    .expect("cycle boundary due");
    // Review the old visible fields after changing the anchor, before the scheduler catches up.
    Suggestion::edit(
        &db,
        suggestion.id,
        1,
        AiAction::CompleteTodo { todo_id: task.id },
    )
    .expect("preview");
    assert_eq!(
        Suggestion::confirm(&db, suggestion.id, 2, true)
            .expect_err("old cycle")
            .code(),
        ApiCode::Conflict
    );
    assert!(!Todo::find(&db, task.id).expect("task").completed);
    assert!(OperationLog::list(&db, None)
        .expect("audit")
        .iter()
        .all(|entry| entry.event != "confirmed"));
}

#[test]
fn confirming_a_recurring_task_keeps_its_deadline_schedule_and_tags() {
    use crate::models::recurrence::{Recurrence, RecurrenceUnit};
    let db = database();
    let rule = Recurrence {
        unit: RecurrenceUnit::Day,
        interval: 1,
    };
    let task = Todo::add_with_options(&db, "daily", Some(rule), Some(0)).expect("task");
    let tag = Tag::add(&db, "work").expect("tag");
    Todo::set_tags(&db, task.id, &[tag.id]).expect("tagged");
    let suggestion = propose(&db, AiAction::CompleteTodo { todo_id: task.id });
    Suggestion::confirm(&db, suggestion.id, 1, true).expect("confirmed");
    let updated = Todo::find(&db, task.id).expect("task");
    assert!(updated.completed);
    assert_eq!(updated.due_date, Some(0));
    assert_eq!(updated.recurrence, Some(rule));
    assert_eq!(updated.tag_ids, [tag.id]);
    assert_eq!(updated.next_occurrence_at, task.next_occurrence_at);
}

#[test]
fn edits_require_separate_confirmation_and_old_revisions_cannot_run() {
    let db = database();
    let original = propose(&db, create("original"));
    assert!(Todo::list(&db, None).expect("tasks").is_empty());
    assert_eq!(
        Suggestion::confirm(&db, original.id, 1, false)
            .expect_err("confirmation required")
            .code(),
        ApiCode::InvalidInput
    );
    Suggestion::edit(&db, original.id, 1, create(" edited ")).expect("preview saved");
    assert!(Todo::list(&db, None).expect("tasks").is_empty());
    assert_eq!(
        Suggestion::confirm(&db, original.id, 1, true)
            .expect_err("old revision")
            .code(),
        ApiCode::Conflict
    );
    Suggestion::confirm(&db, original.id, 2, true).expect("confirmed");
    assert_eq!(Todo::list(&db, None).expect("tasks")[0].title, "edited");
    assert_eq!(
        Suggestion::confirm(&db, original.id, 2, true)
            .expect_err("no replay")
            .code(),
        ApiCode::Conflict
    );
    assert_eq!(
        Suggestion::edit(&db, original.id, 2, create("again"))
            .expect_err("terminal state")
            .code(),
        ApiCode::Conflict
    );
    let log = OperationLog::list(&db, None).expect("log");
    assert_eq!(
        log.iter()
            .map(|entry| entry.event.as_str())
            .collect::<Vec<_>>(),
        ["confirmed", "edited", "proposed"]
    );
    assert_eq!(log[0].action, create("edited"));
    assert_eq!(log[2].action, create("original"));
    assert!(log[0].result_id.is_some());
}

#[test]
fn rejecting_and_clearing_history_preserve_pending_proposals_and_business_data() {
    let db = database();
    let rejected = propose(&db, create("never create"));
    let pending = propose(&db, create("review later"));
    Suggestion::reject(&db, rejected.id, 1).expect("rejected");
    assert_eq!(
        Suggestion::confirm(&db, rejected.id, 1, true)
            .expect_err("rejected")
            .code(),
        ApiCode::Conflict
    );
    assert!(Todo::list(&db, None).expect("tasks").is_empty());
    OperationLog::clear(&db).expect("cleared");
    assert!(OperationLog::list(&db, None).expect("log").is_empty());
    assert_eq!(Suggestion::pending(&db).expect("pending")[0].id, pending.id);
    Suggestion::confirm(&db, pending.id, 1, true).expect("still reviewable");
    OperationLog::clear(&db).expect("cleared again");
    assert_eq!(Todo::list(&db, None).expect("tasks").len(), 1);
}

#[test]
fn completion_detects_manual_edits_even_without_a_timestamp_change() {
    let db = database();
    let todo = Todo::add(&db, "old title").expect("task");
    let proposal = propose(&db, AiAction::CompleteTodo { todo_id: todo.id });
    repository::execute(
        &db,
        "UPDATE todos SET title = 'new title' WHERE id = ?1",
        [todo.id],
    )
    .expect("manual edit in same second");
    assert_eq!(
        Suggestion::confirm(&db, proposal.id, 1, true)
            .expect_err("stale target")
            .code(),
        ApiCode::Conflict
    );
    assert!(!Todo::find(&db, todo.id).expect("task").completed);
    Suggestion::edit(&db, proposal.id, 1, proposal.action).expect("review current task");
    Suggestion::confirm(&db, proposal.id, 2, true).expect("confirmed");
    assert!(Todo::find(&db, todo.id).expect("task").completed);
    assert!(
        repository::count(
            &db,
            "SELECT completed_at FROM todos WHERE id = ?1",
            [todo.id]
        )
        .expect("timestamp")
            > 0
    );
}

#[test]
fn tag_actions_update_links_and_cache_and_detect_changed_or_deleted_targets() {
    let db = database();
    let todo = Todo::add(&db, "task").expect("task");
    let tag = Tag::add(&db, "work").expect("tag");
    let proposal = propose(
        &db,
        AiAction::SetTodoTags {
            todo_id: todo.id,
            tag_ids: vec![tag.id, tag.id],
        },
    );
    assert!(Todo::find(&db, todo.id).expect("task").tag_ids.is_empty());
    Suggestion::confirm(&db, proposal.id, 1, true).expect("confirmed");
    assert_eq!(Todo::find(&db, todo.id).expect("task").tag_ids, [tag.id]);
    assert_eq!(
        Tag::for_todo(&db, todo.id).expect("links").as_slice(),
        std::slice::from_ref(&tag)
    );
    let rename = propose(
        &db,
        AiAction::RenameTag {
            tag_id: tag.id,
            name: "personal".into(),
        },
    );
    Tag::rename(&db, tag.id, "changed manually").expect("manual rename");
    assert_eq!(
        Suggestion::confirm(&db, rename.id, 1, true)
            .expect_err("stale tag")
            .code(),
        ApiCode::Conflict
    );
    Suggestion::edit(&db, rename.id, 1, rename.action).expect("new preview");
    Suggestion::confirm(&db, rename.id, 2, true).expect("confirmed rename");
    assert_eq!(Tag::find(&db, tag.id).expect("tag").name, "personal");
    let completion = propose(&db, AiAction::CompleteTodo { todo_id: todo.id });
    Todo::delete(&db, todo.id).expect("manual deletion");
    assert_eq!(
        Suggestion::confirm(&db, completion.id, 1, true)
            .expect_err("missing task")
            .code(),
        ApiCode::NotFound
    );
    Suggestion::reject(&db, completion.id, 1).expect("stale proposal can be rejected");
}

#[test]
fn invalid_batches_and_audit_failure_roll_back_every_write() {
    let db = database();
    let error = Suggestion::propose(
        &db,
        vec![
            Proposal {
                reason: "valid".into(),
                action: create("task"),
                expected_state: None,
            },
            Proposal {
                reason: "invalid".into(),
                action: create("  "),
                expected_state: None,
            },
        ],
    )
    .expect_err("invalid batch");
    assert_eq!(error.code(), ApiCode::InvalidInput);
    assert!(Suggestion::pending(&db).expect("pending").is_empty());
    assert!(OperationLog::list(&db, None).expect("log").is_empty());
    let proposal = propose(&db, create("task"));
    db.connection().expect("connection").execute_batch("CREATE TRIGGER fail_audit BEFORE INSERT ON ai_operation_log WHEN NEW.event = 'confirmed' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;").expect("trigger");
    assert_eq!(
        Suggestion::confirm(&db, proposal.id, 1, true)
            .expect_err("failed log")
            .code(),
        ApiCode::Database
    );
    assert!(Todo::list(&db, None).expect("tasks").is_empty());
    assert_eq!(Suggestion::pending(&db).expect("pending").len(), 1);
    assert_eq!(OperationLog::list(&db, None).expect("log").len(), 1);
}

#[test]
fn reminders_use_alarm_defaults_and_tag_names_remain_unique() {
    let db = database();
    let reminder = propose(
        &db,
        AiAction::CreateAlarm {
            label: "Focus".into(),
            hour: 14,
            minute: 30,
        },
    );
    assert!(Alarm::list(&db).expect("alarms").is_empty());
    Suggestion::confirm(&db, reminder.id, 1, true).expect("confirmed reminder");
    let alarms = Alarm::list(&db).expect("alarms");
    let alarm = &alarms[0];
    assert_eq!(
        (alarm.hour, alarm.minute, alarm.repeat_days, alarm.enabled),
        (14, 30, 0, true)
    );
    let tag = Tag::add(&db, "work").expect("tag");
    let rename = propose(
        &db,
        AiAction::RenameTag {
            tag_id: tag.id,
            name: "home".into(),
        },
    );
    Tag::add(&db, "HOME").expect("name taken after proposal");
    assert_eq!(
        Suggestion::confirm(&db, rename.id, 1, true)
            .expect_err("name conflict")
            .code(),
        ApiCode::Conflict
    );
    assert_eq!(Tag::find(&db, tag.id).expect("tag").name, "work");
}

#[test]
fn proposals_survive_restart_and_log_cursor_keeps_all_entries_reachable() {
    let directory = tempfile::tempdir().expect("directory");
    let path = directory.path().join("assistance.db");
    {
        let db = Db::open(&path).expect("database");
        schema::ensure(&db).expect("schema");
        for _ in 0..26 {
            let proposal = propose(&db, create("task"));
            Suggestion::reject(&db, proposal.id, 1).expect("reject");
        }
        propose(&db, create("persisted"));
    }
    let db = Db::open(&path).expect("reopened");
    schema::ensure(&db).expect("idempotent schema");
    assert_eq!(
        Suggestion::pending(&db).expect("pending")[0].action,
        create("persisted")
    );
    let first = OperationLog::list(&db, None).expect("first page");
    let next = OperationLog::list(&db, Some(first.last().expect("last").id)).expect("second page");
    assert_eq!((first.len(), next.len()), (50, 3));
    assert!(next.iter().all(|entry| entry.id < first[49].id));
}

#[test]
fn simultaneous_confirmations_execute_at_most_once() {
    use std::sync::{Arc, Barrier};
    let directory = tempfile::tempdir().expect("directory");
    let db = Db::open(directory.path().join("concurrent.db")).expect("database");
    schema::ensure(&db).expect("schema");
    let proposal = propose(&db, create("once"));
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let db = db.clone();
            let barrier = barrier.clone();
            let id = proposal.id;
            std::thread::spawn(move || {
                barrier.wait();
                Suggestion::confirm(&db, id, 1, true)
            })
        })
        .collect();
    let successes = handles
        .into_iter()
        .map(|handle| handle.join().expect("worker").is_ok())
        .filter(|ok| *ok)
        .count();
    assert_eq!(successes, 1);
    assert_eq!(Todo::list(&db, None).expect("tasks").len(), 1);
    assert_eq!(
        OperationLog::list(&db, None)
            .expect("log")
            .iter()
            .filter(|entry| entry.event == "confirmed")
            .count(),
        1
    );
}
