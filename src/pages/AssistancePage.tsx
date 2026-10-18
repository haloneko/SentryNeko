/** Optional local AI assistance and its persistent review history. */
import { useEffect, useState } from "react";

import {
  AiSuggestionCard,
  describeAction,
} from "../components/AiSuggestionCard";
import { useI18n } from "../hooks/useI18n";
import { useAssistanceStore } from "../stores/assistanceStore";

export function AssistancePage() {
  const { t, language } = useI18n();
  const state = useAssistanceStore();
  const { settings, load } = state;
  const [model, setModel] = useState(settings.model);
  const [port, setPort] = useState(String(settings.port));
  const [prompt, setPrompt] = useState("");
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setModel(settings.model);
    setPort(String(settings.port));
  }, [settings.model, settings.port]);
  const validPort =
    Number.isInteger(Number(port)) &&
    Number(port) >= 1 &&
    Number(port) <= 65535;
  const dirty =
    model.trim() !== settings.model || Number(port) !== settings.port;
  const disabled = state.loading || state.busy || state.generating;

  return (
    <>
      <h1>{t("nav.assistance")}</h1>
      <div className="ai-page">
        <p className="muted">{t("ai.intro")}</p>
        <details className="card ai-setup" open={settings.model === ""}>
          <summary>{t("ai.setup")}</summary>
          <p className="muted">{t("ai.setupHint")}</p>
          <form
            className="ai-setup-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (validPort)
                void state.saveSettings({ model, port: Number(port) });
            }}
          >
            <label>
              {t("ai.model")}
              <input
                maxLength={100}
                required
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
            <label>
              {t("ai.port")}
              <input
                type="number"
                min={1}
                max={65535}
                required
                value={port}
                onChange={(event) => setPort(event.target.value)}
              />
            </label>
            <button
              className="btn"
              disabled={
                disabled ||
                state.generating ||
                !validPort ||
                model.trim() === "" ||
                !dirty
              }
              type="submit"
            >
              {t("ai.saveSettings")}
            </button>
          </form>
        </details>
        <form
          className="card ai-request"
          onSubmit={(event) => {
            event.preventDefault();
            void state.generate(prompt);
          }}
        >
          <label htmlFor="ai-request">{t("ai.request")}</label>
          <textarea
            id="ai-request"
            maxLength={2000}
            placeholder={t("ai.requestPlaceholder")}
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <p className="muted">{t("ai.contextHint")}</p>
          <button
            className="btn"
            disabled={
              disabled || state.generating || settings.model === "" || dirty
            }
            type="submit"
          >
            {t(state.generating ? "ai.generating" : "ai.generate")}
          </button>
        </form>
        {state.error ? (
          <p className="error" role="alert">
            {t(`ai.error.${state.error}`)}
          </p>
        ) : null}
        {state.loading ? (
          <p className="muted" role="status">
            {t("ai.loading")}
          </p>
        ) : null}
        {state.generating ? (
          <p className="muted" role="status">
            {t("ai.backgroundHint")}
          </p>
        ) : null}
        <section aria-labelledby="ai-pending-title" className="ai-section">
          <div className="ai-heading">
            <h2 id="ai-pending-title">
              {t("ai.pending", { count: state.suggestions.length })}
            </h2>
            <button
              className="btn"
              disabled={disabled}
              onClick={() => {
                void load();
              }}
              type="button"
            >
              {t("ai.refresh")}
            </button>
          </div>
          {state.suggestions.length === 0 && !state.loading ? (
            <p className="muted" role="status">
              {t(state.generated ? "ai.noSuggestions" : "ai.empty")}
            </p>
          ) : null}
          {state.suggestions.map((suggestion) => (
            <AiSuggestionCard
              key={`${suggestion.id}:${suggestion.revision}`}
              suggestion={suggestion}
            />
          ))}
        </section>
        <section aria-labelledby="ai-log-title" className="ai-section">
          <div className="ai-heading">
            <h2 id="ai-log-title">{t("ai.log")}</h2>
            <button
              className="btn"
              disabled={disabled || state.log.length === 0}
              onClick={() => setClearing(true)}
              type="button"
            >
              {t("ai.clearLog")}
            </button>
          </div>
          {clearing ? (
            <div className="card ai-clear">
              <p>{t("ai.clearHint")}</p>
              <div className="ai-actions">
                <button
                  className="btn"
                  disabled={disabled}
                  type="button"
                  onClick={() => {
                    void state.clearLog().then(() => setClearing(false));
                  }}
                >
                  {t("ai.confirmClear")}
                </button>
                <button
                  className="btn"
                  disabled={disabled}
                  type="button"
                  onClick={() => setClearing(false)}
                >
                  {t("ai.cancel")}
                </button>
              </div>
            </div>
          ) : null}
          {state.log.length === 0 && !state.loading ? (
            <p className="muted">{t("ai.emptyLog")}</p>
          ) : null}
          <ol className="ai-log">
            {state.log.map((entry) => (
              <li key={entry.id}>
                <div className="ai-heading">
                  <strong>
                    {t(`ai.event.${entry.event}`)} · #{entry.suggestionId}
                  </strong>
                  <time
                    dateTime={new Date(entry.createdAt * 1000).toISOString()}
                  >
                    {new Date(entry.createdAt * 1000).toLocaleString(language)}
                  </time>
                </div>
                <p>{describeAction(entry.action, [], [], t)}</p>
                <p className="muted">{entry.reason}</p>
                {entry.resultId !== null ? (
                  <p className="muted">
                    {t("ai.result", { id: entry.resultId })}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
          {state.hasMore ? (
            <button
              className="btn"
              disabled={disabled}
              onClick={() => {
                void state.loadMore();
              }}
              type="button"
            >
              {t("ai.loadMore")}
            </button>
          ) : null}
        </section>
      </div>
    </>
  );
}
