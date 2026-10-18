import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { loadColorMode } from "./stores/colorModeStore";
import { loadFontSettings } from "./stores/fontSettingsStore";
import { loadLanguage } from "./stores/i18nStore";
import { loadTodoDisplayMode } from "./stores/todoDisplayStore";
import "@fontsource-variable/jetbrains-mono";
import "./styles/app.css";

async function render(): Promise<void> {
  // Resolve saved preferences before the first paint to avoid flashing the defaults.
  await Promise.all([loadLanguage(), loadColorMode(), loadTodoDisplayMode(), loadFontSettings()]);

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
