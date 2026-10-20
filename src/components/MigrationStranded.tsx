/**
 * Shown when this build could not open a database.
 *
 * The failed copy changed nothing — the configuration still names the previous build's file, and
 * that file was never touched — so the way forward is that build. The dialog therefore has no
 * dismiss: closing it ends the process, which is the only honest way back.
 */

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { useI18n } from "../hooks/useI18n";
import type { Stranded } from "../types/migration";
import migrationStrandedStyles from "./MigrationStranded.module.css";

export function MigrationStranded({ stranded }: { stranded: Stranded }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function rollBack(): Promise<void> {
    // The configuration still names the old file, so the previous build picks up exactly where it
    // left off. Leaving is the whole of the rollback.
    await invoke("roll_back");
  }

  async function copyPath(): Promise<void> {
    try {
      await navigator.clipboard.writeText(stranded.path);
      setCopied(true);
    } catch {
      // A webview that refuses the clipboard leaves the path on screen to copy by hand.
    }
  }

  return (
    <dialog
      ref={dialog}
      className={migrationStrandedStyles.stranded}
      aria-labelledby="stranded-title"
      // Escape closes a dialog by default; here there is nothing to close back into.
      onCancel={(event) => event.preventDefault()}
    >
      <div className={migrationStrandedStyles.strandedLead}>
        <h2 id="stranded-title">{t("migration.title")}</h2>
        <p>{t("migration.body")}</p>
      </div>

      <dl className={migrationStrandedStyles.strandedFacts}>
        <dt>{t("migration.file")}</dt>
        <dd>
          <code>{stranded.path}</code>
          <button type="button" className="btn btn-quiet" onClick={copyPath}>
            {copied ? t("migration.copied") : t("migration.copy")}
          </button>
        </dd>

        <dt>{t("migration.reason")}</dt>
        <dd>{stranded.reason}</dd>
      </dl>

      <p className={migrationStrandedStyles.strandedHint}>{t("migration.hint")}</p>

      <div className={migrationStrandedStyles.strandedActions}>
        <button type="button" className="btn" onClick={rollBack}>
          {t("migration.rollBack")}
        </button>
      </div>
    </dialog>
  );
}
