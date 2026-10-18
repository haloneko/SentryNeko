/** One proposal: edit a draft, save its preview, then explicitly confirm that saved revision. */
import { useState } from "react";
import type { TFunction } from "i18next";

import { useI18n } from "../hooks/useI18n";
import { useAssistanceStore } from "../stores/assistanceStore";
import type { AiAction, AiSuggestion } from "../types/assistance";
import type { Tag } from "../types/tag";
import type { Todo } from "../types/todo";

export function describeAction(
  action: AiAction,
  todos: readonly Todo[],
  tags: readonly Tag[],
  t: TFunction,
): string {
  const todo = (id: number) =>
    `${todos.find((item) => item.id === id)?.title ?? t("ai.task")} (#${id})`;
  const tag = (id: number) =>
    `${tags.find((item) => item.id === id)?.name ?? t("ai.tag")} (#${id})`;
  switch (action.kind) {
    case "createTodo":
      return t("ai.preview.createTodo", { title: action.title });
    case "completeTodo":
      return t("ai.preview.completeTodo", { title: todo(action.todoId) });
    case "setTodoTags":
      return t("ai.preview.setTodoTags", {
        title: todo(action.todoId),
        tags: action.tagIds.map(tag).join(", ") || t("ai.noTags"),
      });
    case "renameTag":
      return t("ai.preview.renameTag", {
        tag: tag(action.tagId),
        name: action.name,
      });
    case "createAlarm":
      return t("ai.preview.createAlarm", {
        label: action.label || t("alarm.untitled"),
        time: `${String(action.hour).padStart(2, "0")}:${String(action.minute).padStart(2, "0")}`,
      });
  }
}

function ActionFields({
  action,
  onChange,
  disabled,
}: {
  action: AiAction;
  onChange: (action: AiAction) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const { todos, tags } = useAssistanceStore();
  return (
    <fieldset className="ai-fields" disabled={disabled}>
      {action.kind === "createTodo" ? (
        <label>
          {t("ai.taskTitle")}
          <input
            maxLength={500}
            required
            value={action.title}
            onChange={(event) =>
              onChange({ ...action, title: event.target.value })
            }
          />
        </label>
      ) : null}
      {action.kind === "completeTodo" || action.kind === "setTodoTags" ? (
        <label>
          {t("ai.task")}
          <select
            value={action.todoId}
            onChange={(event) =>
              onChange({ ...action, todoId: Number(event.target.value) })
            }
          >
            {!todos.some((todo) => todo.id === action.todoId) ? (
              <option value={action.todoId}>#{action.todoId}</option>
            ) : null}
            {todos
              .filter(
                (todo) => action.kind === "setTodoTags" || !todo.completed,
              )
              .map((todo) => (
                <option key={todo.id} value={todo.id}>
                  {todo.title} (#{todo.id})
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {action.kind === "setTodoTags" ? (
        <div className="ai-tag-options">
          <span>{t("ai.tags")}</span>
          {tags.length === 0 ? (
            <span className="muted">{t("ai.noTags")}</span>
          ) : (
            tags.map((tag) => (
              <label key={tag.id}>
                <input
                  type="checkbox"
                  checked={action.tagIds.includes(tag.id)}
                  onChange={(event) =>
                    onChange({
                      ...action,
                      tagIds: event.target.checked
                        ? [...action.tagIds, tag.id]
                        : action.tagIds.filter((id) => id !== tag.id),
                    })
                  }
                />
                {tag.name}
              </label>
            ))
          )}
        </div>
      ) : null}
      {action.kind === "renameTag" ? (
        <>
          <label>
            {t("ai.tag")}
            <select
              value={action.tagId}
              onChange={(event) =>
                onChange({ ...action, tagId: Number(event.target.value) })
              }
            >
              {!tags.some((tag) => tag.id === action.tagId) ? (
                <option value={action.tagId}>#{action.tagId}</option>
              ) : null}
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name} (#{tag.id})
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("ai.tagName")}
            <input
              maxLength={100}
              required
              value={action.name}
              onChange={(event) =>
                onChange({ ...action, name: event.target.value })
              }
            />
          </label>
        </>
      ) : null}
      {action.kind === "createAlarm" ? (
        <>
          <label>
            {t("alarm.label")}
            <input
              maxLength={60}
              value={action.label}
              onChange={(event) =>
                onChange({ ...action, label: event.target.value })
              }
            />
          </label>
          <label>
            {t("alarm.time")}
            <input
              required
              type="time"
              value={`${String(action.hour).padStart(2, "0")}:${String(action.minute).padStart(2, "0")}`}
              onChange={(event) => {
                const [hour, minute] = event.target.value
                  .split(":")
                  .map(Number);
                if (hour !== undefined && minute !== undefined)
                  onChange({ ...action, hour, minute });
              }}
            />
          </label>
          <p className="muted">{t("ai.alarmHint")}</p>
        </>
      ) : null}
    </fieldset>
  );
}

export function AiSuggestionCard({ suggestion }: { suggestion: AiSuggestion }) {
  const { t } = useI18n();
  const { todos, tags, busy, loading, generating, edit, confirm, reject } =
    useAssistanceStore();
  const [draft, setDraft] = useState<AiAction | null>(null);
  const disabled = busy || loading || generating;
  return (
    <article className="card ai-suggestion">
      <div className="ai-heading">
        <strong>{t(`ai.kind.${suggestion.action.kind}`)}</strong>
        <span className="ai-badge">{t("ai.awaiting")}</span>
      </div>
      <p className="ai-reason">{suggestion.reason}</p>
      <p className="ai-preview">
        {describeAction(suggestion.action, todos, tags, t)}
      </p>
      {draft ? (
        <form
          className="ai-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void edit(suggestion, draft).then((saved) => {
              if (saved) setDraft(null);
            });
          }}
        >
          <ActionFields
            action={draft}
            onChange={setDraft}
            disabled={disabled}
          />
          <p className="muted">{t("ai.editHint")}</p>
          <div className="ai-actions">
            <button className="btn" disabled={disabled} type="submit">
              {t("ai.savePreview")}
            </button>
            <button
              className="btn"
              disabled={disabled}
              type="button"
              onClick={() => setDraft(null)}
            >
              {t("ai.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="ai-actions">
          <button
            className="btn ai-confirm"
            disabled={disabled}
            onClick={() => {
              void confirm(suggestion);
            }}
            type="button"
          >
            {t("ai.confirm")}
          </button>
          <button
            className="btn"
            disabled={disabled}
            onClick={() => setDraft(suggestion.action)}
            type="button"
          >
            {t("ai.edit")}
          </button>
          <button
            className="btn"
            disabled={disabled}
            onClick={() => {
              void reject(suggestion);
            }}
            type="button"
          >
            {t("ai.reject")}
          </button>
        </div>
      )}
    </article>
  );
}
