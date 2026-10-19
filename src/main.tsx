import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { MigrationStranded } from "./components/MigrationStranded";
import { I18nProvider } from "./components/I18nProvider";
import { loadColorMode } from "./stores/colorModeStore";
import { loadDashboardLayout } from "./stores/dashboardLayoutStore";
import { loadLanguage } from "./stores/i18nStore";
import { loadStranded } from "./stores/migrationStore";
import { loadSidebarLayout } from "./stores/sidebarLayoutStore";
import { loadVersion } from "./stores/versionStore";
import "./styles/app.css";

async function render(): Promise<void> {
  // The chosen language and appearance live in `config.json`, the sidebar and dashboard
  // arrangements in the settings table; resolving them before the first paint keeps the interface
  // from flashing the defaults. The version and the database are resolved with them, so the label
  // never appears first with a fallback number and then changes under the eye.
  const [stranded] = await Promise.all([
    loadStranded(),
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
      <I18nProvider>
        {/* A start that found no database has nothing to show but the way back to the previous
            build, so the application itself is not mounted at all. */}
        {stranded ? <MigrationStranded stranded={stranded} /> : <App />}
      </I18nProvider>
    </StrictMode>,
  );
}

void render();
