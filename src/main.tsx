import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { loadColorMode } from "./stores/colorModeStore";
import { loadDashboardLayout } from "./stores/dashboardLayoutStore";
import { loadLanguage } from "./stores/i18nStore";
import { loadSidebarLayout } from "./stores/sidebarLayoutStore";
import { loadVersion } from "./stores/versionStore";
import "./styles/app.css";

async function render(): Promise<void> {
  // The chosen language and appearance live in `config.json`, the sidebar and dashboard
  // arrangements in the settings table; resolving them before the first paint keeps the interface
  // from flashing the defaults. The version is resolved with them, so the label never appears first
  // with a fallback number and then changes under the eye.
  await Promise.all([
    loadLanguage(),
    loadColorMode(),
    loadSidebarLayout(),
    loadDashboardLayout(),
    loadVersion(),
  ]);

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
