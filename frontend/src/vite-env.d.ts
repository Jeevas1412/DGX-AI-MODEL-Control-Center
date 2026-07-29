/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_MOCK_DATA?: 'true' | 'false'
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  dgxDesktop?: {
    getPreferences: () => Promise<{ language: 'zh-CN' | 'en-US'; theme: 'dark' | 'light'; keepRunningWhenWindowClosed: boolean; remoteReadOnlySessionEnabled: boolean; remoteControlSessionEnabled: boolean }>
    updatePreferences: (patch: Partial<{ language: 'zh-CN' | 'en-US'; theme: 'dark' | 'light'; keepRunningWhenWindowClosed: boolean; remoteReadOnlySessionEnabled: boolean; remoteControlSessionEnabled: boolean }>) => Promise<{ language: 'zh-CN' | 'en-US'; theme: 'dark' | 'light'; keepRunningWhenWindowClosed: boolean; remoteReadOnlySessionEnabled: boolean; remoteControlSessionEnabled: boolean }>
    getRuntimeState: () => Promise<{ channel: 'desktop'; environment: 'development' | 'test' | 'staging' | 'production'; platform: string; keepRunningWhenWindowClosed: boolean; remoteReadOnlySessionEnabled: boolean; remoteControlSessionEnabled: boolean; backend: 'running' | 'stopped'; shortcutSupport: string }>
    createDesktopShortcut: () => Promise<{ status: 'created' | 'unsupported' | 'failed'; message: string }>
    requestApi: (request: { method: 'GET' | 'POST'; path: string; body?: unknown }) => Promise<{ status: number; payload: unknown }>
  }
}
