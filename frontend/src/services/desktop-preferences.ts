import { useCallback, useEffect, useState } from 'react'
import type { Locale } from '../i18n/LanguageContext'

export type Theme = 'dark' | 'light'

export interface DesktopPreferences {
  language: Locale
  theme: Theme
  keepRunningWhenWindowClosed: boolean
  remoteReadOnlySessionEnabled: boolean
  remoteControlSessionEnabled: boolean
}

export interface DesktopRuntimeState {
  channel: 'desktop'
  environment: 'development' | 'test' | 'staging' | 'production'
  platform: string
  keepRunningWhenWindowClosed: boolean
  remoteReadOnlySessionEnabled: boolean
  remoteControlSessionEnabled: boolean
  backend: 'running' | 'stopped'
  shortcutSupport: string
}

export interface ShortcutState {
  status: 'idle' | 'loading' | 'created' | 'unsupported' | 'denied' | 'failed'
  message: string
}

function hasDesktopIpc(): boolean {
  return typeof window !== 'undefined' && typeof window.dgxDesktop?.getPreferences === 'function'
}

export function useDesktopPreferences() {
  const [prefs, setPrefs] = useState<DesktopPreferences>({ language: 'zh-CN', theme: 'dark', keepRunningWhenWindowClosed: false, remoteReadOnlySessionEnabled: false, remoteControlSessionEnabled: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [available, setAvailable] = useState(false)

  const applyTheme = useCallback((theme: Theme) => {
    const root = document.documentElement
    root.classList.toggle('light', theme === 'light')
    root.dataset.theme = theme
    root.style.colorScheme = theme
  }, [])

  const load = useCallback(async () => {
    if (!hasDesktopIpc()) {
      setAvailable(false)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const p = await window.dgxDesktop!.getPreferences()
      setPrefs({ language: p.language, theme: p.theme, keepRunningWhenWindowClosed: p.keepRunningWhenWindowClosed, remoteReadOnlySessionEnabled: p.remoteReadOnlySessionEnabled, remoteControlSessionEnabled: p.remoteControlSessionEnabled })
      setAvailable(true)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法读取桌面偏好')
      setAvailable(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Keep the document palette in sync both after the desktop preference store
  // is loaded and after a user changes it in Settings.
  useEffect(() => { applyTheme(prefs.theme) }, [applyTheme, prefs.theme])

  const update = useCallback(async (patch: Partial<DesktopPreferences>) => {
    if (!hasDesktopIpc()) return setError('桌面运行时不可用')
    try {
      const p = await window.dgxDesktop!.updatePreferences(patch)
      setPrefs({ language: p.language, theme: p.theme, keepRunningWhenWindowClosed: p.keepRunningWhenWindowClosed, remoteReadOnlySessionEnabled: p.remoteReadOnlySessionEnabled, remoteControlSessionEnabled: p.remoteControlSessionEnabled })
      setError(null)
      return p
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新偏好失败')
      throw err
    }
  }, [])

  return { prefs, loading, error, available, update, applyTheme, reload: load }
}

export function useDesktopRuntime() {
  const [runtime, setRuntime] = useState<DesktopRuntimeState | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!hasDesktopIpc()) { setLoading(false); return }
    window.dgxDesktop!.getRuntimeState().then(
      (r) => { setRuntime(r); setLoading(false) },
      () => setLoading(false),
    )
  }, [])

  return { runtime, loading, available: hasDesktopIpc() && runtime !== null }
}
