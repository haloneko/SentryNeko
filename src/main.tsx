import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { loadColorMode } from "./stores/colorModeStore";
import { loadLanguage } from "./stores/i18nStore";
import { loadSidebarLayout } from "./stores/sidebarLayoutStore";
import "./styles/app.css";

async function render(): Promise<void> {
  // The chosen language and appearance live in `config.json`, the sidebar arrangement in the
  // settings table; resolving them before the first paint keeps the interface from flashing the
  // defaults.
  await Promise.all([loadLanguage(), loadColorMode(), loadSidebarLayout()]);

  const container = document.getElementById("root");

  if (!container) {
    return;
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void render();
