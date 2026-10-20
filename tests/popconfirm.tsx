import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { I18nProvider } from "../src/components/I18nProvider";
import { ActionIcon } from "../src/components/ui/ActionIcon";
import { Popconfirm } from "../src/components/ui/Popconfirm";
import i18n from "../src/i18n";
import "../src/styles/app.css";

const params = new URLSearchParams(window.location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "dark";
void i18n.changeLanguage(params.get("language") ?? "en-US");

function Fixture() {
  const [actions, setActions] = useState<readonly string[]>([]);
  const record = (name: string) => (): void => setActions((current) => [...current, name]);

  return (
    <div className="test-page">
      <Popconfirm onConfirm={record("default")}>
        <button type="button">Default copy</button>
      </Popconfirm>

      <Popconfirm
        cancelText="Keep it"
        confirmText="Delete it"
        content="The task and its history are removed."
        onConfirm={record("custom")}
        title="Delete this task?"
      >
        <button type="button">Custom copy</button>
      </Popconfirm>

      <Popconfirm onConfirm={record("watched")}>
        <button onClick={record("trigger")} type="button">Watched trigger</button>
      </Popconfirm>

      <Popconfirm onConfirm={record("blocked")}>
        <button onClick={(event) => event.preventDefault()} type="button">Blocked trigger</button>
      </Popconfirm>

      <Popconfirm
        confirmText="Remove it"
        danger
        icon={<ActionIcon name="delete" />}
        onConfirm={record("titled")}
        title="Remove the saved filter?"
      >
        <button type="button">Title only</button>
      </Popconfirm>

      <div className="test-middle">
        <Popconfirm onConfirm={record("middle")}>
          <button type="button">Middle copy</button>
        </Popconfirm>
      </div>

      <div className="test-right">
        <Popconfirm
          confirmText="Remove it"
          danger
          onConfirm={record("right")}
          title="Remove the saved filter?"
        >
          <button type="button">Right copy</button>
        </Popconfirm>
      </div>

      <div className="test-bottom">
        <Popconfirm onConfirm={record("bottom")}>
          <button type="button">Bottom copy</button>
        </Popconfirm>
      </div>

      <output data-testid="actions">{JSON.stringify(actions)}</output>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <I18nProvider>
        <Fixture />
      </I18nProvider>
    </StrictMode>,
  );
}
