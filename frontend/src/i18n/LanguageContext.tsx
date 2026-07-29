import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { getStrings, type Locale } from './strings'

interface LanguageContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: ReturnType<typeof getStrings>
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocale] = useState<Locale>(initial ?? 'zh-CN')
  const t = useMemo(() => getStrings(locale), [locale])

  const change = useCallback((l: Locale) => {
    setLocale(l)
  }, [])

  return <LanguageContext.Provider value={{ locale, setLocale: change, t }}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}

export type { Locale }
