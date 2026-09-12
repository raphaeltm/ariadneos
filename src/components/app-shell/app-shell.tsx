import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  CircleHelp,
  GitBranch,
  MessageCircle,
  Settings,
  Waypoints,
} from "lucide-react";
import type { ReactNode } from "react";

export type AppShellView = "chat" | "graph" | "inspector" | "settings";

export interface AppShellOption {
  detail?: string;
  id: string;
  label: string;
}

interface NavigationItem {
  count?: string;
  icon: LucideIcon;
  id: AppShellView;
  label: string;
}

interface AppShellProps {
  accountMenu: ReactNode;
  activeProjectId: string;
  activeView: AppShellView;
  activeWorkspaceId: string;
  children: ReactNode;
  connectionLabel: string;
  onAbout: () => void;
  onNavigate: (view: AppShellView) => void;
  onProjectChange: (id: string) => void;
  onWorkspaceChange: (id: string) => void;
  primaryAction: ReactNode;
  projectOptions: AppShellOption[];
  sidebarAction: ReactNode;
  workspaceOptions: AppShellOption[];
}

const navigationItems: NavigationItem[] = [
  { icon: Waypoints, id: "graph", label: "Graph canvas" },
  { icon: Activity, id: "inspector", label: "Inspector" },
  { icon: MessageCircle, id: "chat", label: "Agent chat" },
  { icon: Settings, id: "settings", label: "Settings" },
];

export default function AppShell({
  accountMenu,
  activeProjectId,
  activeView,
  activeWorkspaceId,
  children,
  connectionLabel,
  onAbout,
  onNavigate,
  onProjectChange,
  onWorkspaceChange,
  primaryAction,
  projectOptions,
  sidebarAction,
  workspaceOptions,
}: AppShellProps) {
  const activeWorkspace =
    workspaceOptions.find((workspace) => workspace.id === activeWorkspaceId) ??
    workspaceOptions[0];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a aria-label="AriadneOS home" className="brand" href="/">
          <span className="brand-mark">
            A<span />
          </span>
          <span>
            Ariadne<span className="brand-os">OS</span>
          </span>
        </a>
        <label className="workspace switcher">
          <span className="workspace-icon">
            {activeWorkspace?.label.slice(0, 1) ?? "A"}
          </span>
          <span>
            Workspace
            <select
              aria-label="Switch workspace"
              onChange={(event) => onWorkspaceChange(event.target.value)}
              value={activeWorkspaceId}
            >
              {workspaceOptions.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.label}
                </option>
              ))}
            </select>
            <small>{activeWorkspace?.detail ?? "Scoped observations"}</small>
          </span>
          <ChevronDown size={15} />
        </label>
        <div className="nav-caption">APP</div>
        <nav aria-label="App navigation">
          {navigationItems.map((item) => (
            <button
              className={`nav-item ${activeView === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              <item.icon size={18} />
              {item.label}
              {item.count ? (
                <span className="count-pill">{item.count}</span>
              ) : null}
              {activeView === item.id ? <span className="nav-dot" /> : null}
            </button>
          ))}
        </nav>
        <div className="nav-caption workflow-caption">
          PROJECTS <span>{projectOptions.length}</span>
        </div>
        <div className="workflow-links">
          {projectOptions.map((project, index) => (
            <button
              className={`workflow-link ${
                activeProjectId === project.id ? "current" : ""
              }`}
              key={project.id}
              onClick={() => onProjectChange(project.id)}
              type="button"
            >
              <span className={`workflow-dot dot-${index}`} />
              <span>
                {project.label}
                {project.detail ? <small>{project.detail}</small> : null}
              </span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <button className="help-link" onClick={onAbout} type="button">
            <CircleHelp size={17} />
            About this demo
            <ArrowUpRight size={14} />
          </button>
          {sidebarAction}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-scope">
            <div className="breadcrumbs">
              Workspace <span>{activeWorkspace?.label ?? "Demo"}</span>
            </div>
            <label className="project-switcher">
              <GitBranch size={15} />
              <select
                aria-label="Switch project"
                onChange={(event) => onProjectChange(event.target.value)}
                value={activeProjectId}
              >
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.label}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>
          </div>
          <div className="topbar-right">
            <span className="live-label">
              <span className="online-dot" />
              {connectionLabel}
            </span>
            {primaryAction}
            <button
              aria-label="About AriadneOS"
              className="icon-button"
              onClick={onAbout}
              type="button"
            >
              <CircleHelp size={18} />
            </button>
            {accountMenu}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
