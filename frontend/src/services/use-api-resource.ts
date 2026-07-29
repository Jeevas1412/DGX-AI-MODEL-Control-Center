import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReadResult } from './api-client'

export interface ApiResourceState<T> extends ReadResult<T | undefined> {
  isLoading: boolean
  refresh: () => Promise<void>
}

/** A reusable read-only data hook with manual refresh and a five-second default polling interval. */
export function useApiResource<T>(load: () => Promise<ReadResult<T>>, intervalMs = 5_000): ApiResourceState<T> {
  const [state, setState] = useState<ApiResourceState<T>>({ data: undefined, stale: false, updatedAt: '', isLoading: true, refresh: async () => undefined })
  const requestSequence = useRef(0)
  const refresh = useCallback(async () => {
    const sequence = requestSequence.current + 1
    requestSequence.current = sequence
    setState((current) => ({ ...current, isLoading: current.data === undefined }))
    const result = await load()
    // Polling and manual refresh may overlap. Only the most recently started
    // request is allowed to update visible state, so an older slow response
    // cannot overwrite newer verified data.
    if (requestSequence.current !== sequence) return
    setState((current) => ({ ...result, isLoading: false, refresh: current.refresh }))
  }, [load])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs, refresh])

  return { ...state, refresh }
}
