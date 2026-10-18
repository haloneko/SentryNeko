import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  HashRouter,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { AlarmRinging } from "./components/AlarmRinging";
import { I18nProvider } from "./components/I18nProvider";
import { TitleBar } from "./components/TitleBar";
import { ToastHost } from "./components/ToastHost";
import { NavIcon } from "./components/ui/NavIcon";
import { useI18n } from "./hooks/useI18n";
import { usePageZoom } from "./hooks/usePageZoom";
import { BACKEND_EVENTS, useTauriEvent } from "./hooks/useTauriEvent";
import { AlarmsPage } from "./pages/AlarmsPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { Dashboard } from "./pages/Dashboard";
import { EventsPage } from "./pages/EventsPage";
import { HeatmapPage } from "./pages/HeatmapPage";
import { PomodoroPage } from "./pages/PomodoroPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TodosPage } from "./pages/Todos";
import { useAppEventStore } from "./stores/appEventStore";
import { usePomodoroStore } from "./stores/pomodoroStore";
import { useTodoStore } from "./stores/todoStore";
import { useSidebarLayoutStore } from "./stores/sidebarLayoutStore";
import type { AppEvent } from "./types/appEvent";
import { SIDEBAR_PANELS, SIDEBAR_PANEL_IDS } from "./types/sidebar";

/**
 * All routes stay registered even when their navigation entries are hidden. This keeps links
 * from widgets and tray actions working independently of the sidebar layout.
 */
const PANEL_PAGES = {
  dashboard: Dashboard,
  todos: TodosPage,
  pomodoro: PomodoroPage,
  heatmap: HeatmapPage,
  alarms: AlarmsPage,
  events: EventsPage,
  analytics: AnalyticsPage,
};

const SETTINGS_ENTRY = { path: "/settings", label: "nav.settings", icon: "settings" } as const;

const PAGES = [
  ...SIDEBAR_PANEL_IDS.map((id) => ({ ...SIDEBAR_PANELS[id], Page: PANEL_PAGES[id] })),
  { ...SETTINGS_ENTRY, Page: SettingsPage },
] as const;

/** Where the collapsed flag lives; it is chrome, so it never travels to `config.json`. */
const SIDEBAR_STORAGE_KEY = "sentryneko.sidebarCollapsed";

/**
 * Window width at or below which the rail folds on its own. An open rail costs 236px, and the pages
 * start to crowd once that leaves them under ~790px, so the window gives up the labels instead of
 * the room.
 */
const AUTO_COLLAPSE_MAX_WIDTH = 1024;

/** Whether the window is too narrow to keep the labelled rail open. */
function isNarrowWindow(): boolean {
  return window.matchMedia(`(max-width: ${AUTO_COLLAPSE_MAX_WIDTH}px)`).matches;
}

/** Reads the collapsed flag, starting expanded when storage is unavailable. */
function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** The floating name of a collapsed entry, anchored in viewport coordinates. */
type NavTooltip = { label: string; left: number; top: number };

/** Window frame shared by every page: brand, navigation and language choice. */
function Shell() {
  const { t, language } = useI18n();
  const recordAppSwitch = useAppEventStore((state) => state.record);
  const loadPomodoro = usePomodoroStore((state) => state.load);
  const startPomodoro = usePomodoroStore((state) => state.start);
  const sidebarLayout = useSidebarLayoutStore((state) => state.layout);
  const visiblePages = [
    ...sidebarLayout
      .filter(({ visible }) => visible)
      .map(({ id }) => ({ ...SIDEBAR_PANELS[id], icon: id })),
    SETTINGS_ENTRY,
  ];
  const navigate = useNavigate();
  const contentRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // Null until the first measurement: the highlight must appear already in place instead of
  // sliding in from the top of the list on mount.
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
  // The user's choice and the window's demand stay apart: widening the window must give the user
  // back whatever they had picked, not an arbitrary default.
  const [preferredCollapsed, setPreferredCollapsed] = useState(readSidebarCollapsed);
  const [narrow, setNarrow] = useState(isNarrowWindow);
  const collapsed = preferredCollapsed || narrow;
  const [tooltip, setTooltip] = useState<NavTooltip | null>(null);

  usePageZoom(contentRef);

  // The shell owns the push, so the live tail keeps growing while another page is mounted.
  useTauriEvent<AppEvent>(BACKEND_EVENTS.appSwitch, recordAppSwitch);
  useTauriEvent<null>(BACKEND_EVENTS.todosChanged, () => {
    void useTodoStore.getState().refresh();
  });

  // The tray only asks; the timer belongs to the store, which outlives the page. The durations are
  // reloaded first so a focus phase honours the settings without visiting the page.
  useTauriEvent<null>(BACKEND_EVENTS.trayStartPomodoro, () => {
    void (async () => {
      await loadPomodoro();
      await startPomodoro();
      navigate("/pomodoro");
    })();
  });

  // Crossing the threshold folds or unfolds the rail on its own; a tooltip left open would then
  // point at a row that has moved, so it is dropped with the same event.
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${AUTO_COLLAPSE_MAX_WIDTH}px)`);
    const sync = () => {
      setNarrow(query.matches);
      setTooltip(null);
    };

    sync();
    query.addEventListener("change", sync);

    return () => query.removeEventListener("change", sync);
  }, []);

  // The sliding highlight is placed from the active link, so no geometry is hard-coded.
  useLayoutEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');

    if (!active) {
      setIndicator(null);
      return;
    }

    const measure = (): void => {
      const next = { top: active.offsetTop, height: active.offsetHeight };

      setIndicator((current) =>
        current && current.top === next.top && current.height === next.height ? current : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(active);
    if (navRef.current) {
      observer.observe(navRef.current);
    }

    return () => observer.disconnect();
  }, [pathname, language, collapsed, sidebarLayout]);

  useEffect(() => { setTooltip(null); }, [sidebarLayout]);

  // Collapsing only changes the shell's own chrome, so the flag stays out of `config.json`. A
  // narrow window owns the rail outright: there is no toggle to reach and no room to give.
  function toggleSidebar() {
    if (narrow) {
      return;
    }

    setPreferredCollapsed((current) => {
      const next = !current;

      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Storage disabled: the rail still narrows, the choice just does not survive a restart.
      }

      return next;
    });
    setTooltip(null);
  }

  // The label is drawn by the shell instead of inside the link: the navigation scrolls, so a label
  // positioned next to an entry would be clipped at the sidebar edge. It is anchored on that edge
  // rather than on the link, because the link stops short of it while the rail is icon-only.
  function showTooltip(label: string, anchor: HTMLElement) {
    if (!collapsed) {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const edge = sidebarRef.current?.getBoundingClientRect().right ?? rect.right;

    setTooltip({ label, left: edge + 8, top: rect.top + rect.height / 2 });
  }

  function hideTooltip() {
    setTooltip(null);
  }

  return (
    <div className="app-shell" data-collapsed={collapsed ? "true" : "false"}>
      <TitleBar />
      <aside
        className="sidebar"
        data-tauri-drag-region="deep"
        id="app-sidebar"
        onScroll={hideTooltip}
        ref={sidebarRef}
      >
        <div className="brand">
          <span className="brand-mark">
            <span aria-hidden="true" className="brand-dot" />
            <span className="brand-name">{t("app.name")}</span>
          </span>
          <p className="brand-tagline">{t("app.tagline")}</p>
        </div>
        <nav className="nav" ref={navRef}>
          {indicator ? (
            <span
              aria-hidden="true"
              className="nav-indicator"
              style={{ height: indicator.height, transform: `translateY(${indicator.top}px)` }}
            />
          ) : null}
          {visiblePages.map(({ path, label, icon }) => (
            <NavLink
              aria-label={t(label)}
              className="nav-link"
              end={path === "/"}
              key={path}
              onBlur={hideTooltip}
              onFocus={(event) => showTooltip(t(label), event.currentTarget)}
              onMouseEnter={(event) => showTooltip(t(label), event.currentTarget)}
              onMouseLeave={hideTooltip}
              to={path}
            >
              <NavIcon name={icon} />
              <span className="nav-label">{t(label)}</span>
            </NavLink>
          ))}
        </nav>
        {narrow ? null : (
          <div className="sidebar-footer">
            <button
              aria-controls="app-sidebar"
              aria-expanded={!collapsed}
              aria-label={t(collapsed ? "nav.expand" : "nav.collapse")}
              className="sidebar-toggle"
              onClick={toggleSidebar}
              onBlur={hideTooltip}
              onFocus={(event) => showTooltip(t("nav.expand"), event.currentTarget)}
              onMouseEnter={(event) => showTooltip(t("nav.expand"), event.currentTarget)}
              onMouseLeave={hideTooltip}
              type="button"
            >
              <svg aria-hidden="true" className="nav-icon" viewBox="0 0 24 24">
                <path d={collapsed ? "M10 6l6 6-6 6" : "M14 6l-6 6 6 6"} />
              </svg>
              <span className="sidebar-toggle-label">{t("nav.collapse")}</span>
            </button>
          </div>
        )}
      </aside>
      {tooltip ? (
        <span
          aria-hidden="true"
          className="nav-tooltip"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          {tooltip.label}
        </span>
      ) : null}
      <main className="content" ref={contentRef}>
        <div className="content-inner">
          <Outlet />
        </div>
      </main>
      <AlarmRinging />
      <ToastHost />
    </div>
  );
}

/**
 * Root component: the i18n provider wraps the router that picks the page. Hash routing keeps
 * reloads working, because the packaged app is served from a single document.
 */
export default function App() {
  return (
    <I18nProvider>
      <HashRouter>
        <Routes>
          <Route element={<Shell />}>
            {PAGES.map(({ path, Page }) => (
              <Route element={<Page />} key={path} path={path} />
            ))}
          </Route>
          <Route element={<Navigate replace to="/" />} path="*" />
        </Routes>
      </HashRouter>
    </I18nProvider>
  );
}
