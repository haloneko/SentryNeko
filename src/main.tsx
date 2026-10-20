import { StrictMode, type ReactNode } from "react";
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

/** Mounts `ui` as the whole interface, language provider included. */
function mount(ui: ReactNode): void {
  const container = document.getElementById("root");

  if (!container) {
    return;
  }

  createRoot(container).render(<StrictMode>
    <I18nProvider>{ui}</I18nProvider>
  </StrictMode>);
}

async function render(): Promise<void> {
  const stranded = await loadStranded();

  if (stranded) {
    await loadLanguage();
    mount(<MigrationStranded stranded={stranded} />);

    return;
  }

  await Promise.all([
    loadLanguage(),
    loadColorMode(),
    loadSidebarLayout(),
    loadDashboardLayout(),
    loadVersion(),
  ]);

  mount(<App />);
}

void render();
