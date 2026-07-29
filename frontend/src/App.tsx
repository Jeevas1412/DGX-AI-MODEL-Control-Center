import { useEffect, useState } from 'react'
import Layout from './components/Layout'
import Overview from './pages/Overview'
import Connection from './pages/Connection'
import Services from './pages/Services'
import Models from './pages/Models'
import Requests from './pages/Requests'
import Logs from './pages/Logs'
import Benchmark from './pages/Benchmark'
import Settings from './pages/Settings'
import Setup from './pages/Setup'
import RemoteDesktop from './pages/RemoteDesktop'
import Hardware from './pages/Hardware'

const routePages = {
  '/': Overview,
  '/connection': Connection,
  '/services': Services,
  '/models': Models,
  '/requests': Requests,
  '/logs': Logs,
  '/benchmark': Benchmark,
  '/settings': Settings,
  '/setup': Setup,
  '/remote-desktop': RemoteDesktop,
  '/hardware': Hardware,
} as const

export type AppRoute = keyof typeof routePages

export function normalizeRoute(value: string): AppRoute {
  const path = value.startsWith('#') ? value.slice(1) : value
  return Object.prototype.hasOwnProperty.call(routePages, path) ? path as AppRoute : '/'
}

function readRoute(): AppRoute {
  return normalizeRoute(window.location.protocol === 'file:' ? window.location.hash || '/' : window.location.pathname || '/')
}

function App() {
  const [route, setRoute] = useState<AppRoute>(readRoute)

  useEffect(() => {
    const syncRoute = () => setRoute(readRoute())
    window.addEventListener('hashchange', syncRoute)
    window.addEventListener('popstate', syncRoute)
    return () => {
      window.removeEventListener('hashchange', syncRoute)
      window.removeEventListener('popstate', syncRoute)
    }
  }, [])

  const navigate = (nextPath: string) => {
    const nextRoute = normalizeRoute(nextPath)
    if (window.location.protocol === 'file:') window.location.hash = nextRoute
    else window.history.pushState({}, '', nextRoute)
    setRoute(nextRoute)
  }

  const Page = routePages[route]
  return <Layout path={route} onNavigate={navigate}><Page /></Layout>
}

export default App
