import React, { useCallback, type ReactNode } from 'react';
import { api, type DgxConnectionStatus } from '../services/api';
import { useApiResource } from '../services/use-api-resource';
import { useLanguage } from '../i18n/LanguageContext';
import './Layout.css';

const navItemPaths: { id: string; path: string; icon: string }[] = [
  { id: 'overview', path: '/', icon: '📊' },
  { id: 'connection', path: '/connection', icon: '🔌' },
  { id: 'remoteDesktop', path: '/remote-desktop', icon: '🖥️' },
  { id: 'services', path: '/services', icon: '🖥' },
  { id: 'models', path: '/models', icon: '🤖' },
  { id: 'requests', path: '/requests', icon: '📋' },
  { id: 'logs', path: '/logs', icon: '📝' },
  { id: 'benchmark', path: '/benchmark', icon: '⚡' },
  { id: 'settings', path: '/settings', icon: '⚙️' },
];
navItemPaths.splice(2, 0, { id: 'hardware', path: '/hardware', icon: '▣' });

type LayoutProps = {
  path: string;
  onNavigate: (path: string) => void;
  children: ReactNode;
};

export default function Layout({ path, onNavigate, children }: LayoutProps) {
  const { t, locale } = useLanguage();
  const loadHealth = useCallback(() => api.getHealthState(), []);
  const loadDgxConnection = useCallback(() => api.getDgxConnectionStatusState(), []);
  const health = useApiResource(loadHealth, 15_000);
  const dgxConnection = useApiResource<DgxConnectionStatus>(loadDgxConnection, 10_000);
  const healthStatus = health.data?.status;
  const isHealthy = healthStatus === 'healthy' || healthStatus === 'ok';
  const statusClass = health.isLoading ? 'checking' : health.stale ? 'offline' : isHealthy ? 'online' : healthStatus === 'degraded' ? 'degraded' : 'offline';
  const statusLabel = health.isLoading ? t.settings.healthChecking : health.stale ? t.settings.healthStale : isHealthy ? t.settings.healthNormal : healthStatus === 'degraded' ? t.settings.healthDegraded : t.settings.healthUnknown
  const connectionState = dgxConnection.data?.status;
  const connectionClass = dgxConnection.isLoading ? 'checking' : connectionState === 'connected' ? 'online' : connectionState === 'not-configured' ? 'unconfigured' : 'offline';
  const connectionLabel = locale === 'en-US'
    ? (dgxConnection.isLoading ? 'DGX checking' : connectionState === 'connected' ? 'DGX connected' : connectionState === 'not-configured' ? 'DGX not configured' : 'DGX disconnected')
    : (dgxConnection.isLoading ? 'DGX 连接检查中' : connectionState === 'connected' ? 'DGX 已连接' : connectionState === 'not-configured' ? 'DGX 未配置' : 'DGX 已断开');
  const connectionTitle = dgxConnection.data?.checkedAt ? `${connectionLabel} · ${new Date(dgxConnection.data.checkedAt).toLocaleString(locale === 'en-US' ? 'en-US' : 'zh-CN')}` : connectionLabel;

  const navLabel = (id: string) => {
    const labels: Record<string, string> = {
      overview: t.nav.overview, connection: t.nav.connection, hardware: locale === 'en-US' ? 'Hardware' : '硬件监控', services: t.nav.services,
      models: t.nav.models, requests: t.nav.requests, logs: t.nav.logs,
      benchmark: t.nav.performance, settings: t.nav.settings, remoteDesktop: locale === 'en-US' ? 'Remote Desktop' : '远程桌面',
    }
    return labels[id] ?? id
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="logo">DGX AI Control</h1>
        </div>

        <nav className="nav-menu">
          {navItemPaths.map(item => (
            <a
              key={item.id}
              href={window.location.protocol === 'file:' ? `#${item.path}` : item.path}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                onNavigate(item.path);
              }}
              className={`nav-item ${path === item.path ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{navLabel(item.id)}</span>
            </a>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="version">v0.1.0</div>
        </div>
      </aside>

      <div className="main-content">
        <header className="top-bar">
          <div className="top-bar-left">
            <h2 className="page-title">
              {navLabel(navItemPaths.find(n => n.path === path)?.id ?? 'overview')}
            </h2>
          </div>
          <div className="top-bar-right">
            <div className="status-indicator dgx-connection-indicator" title={connectionTitle} aria-live="polite">
              <span className={`status-dot ${connectionClass}`}></span>
              <span>{connectionLabel}</span>
            </div>
            <div className="status-indicator" title={health.data?.timestamp || undefined}>
              <span className={`status-dot ${statusClass}`}></span>
              <span>{statusLabel}</span>
            </div>
            <div className="timestamp">
              {new Date().toLocaleString(locale === 'en-US' ? 'en-US' : 'zh-CN')}
            </div>
          </div>
        </header>

        <main className="content-area">
          {children}
        </main>
      </div>
    </div>
  );
}
