import { describe, expect, it } from 'vitest'
import { normalizeRoute } from './App'

describe('internal application navigation', () => {
  it('accepts only declared application routes', () => {
    expect(normalizeRoute('/models')).toBe('/models')
    expect(normalizeRoute('#/hardware')).toBe('/hardware')
  })

  it('falls back to the overview for unknown or command-like routes', () => {
    expect(normalizeRoute('/not-a-page')).toBe('/')
    expect(normalizeRoute('https://example.invalid')).toBe('/')
    expect(normalizeRoute('javascript:alert(1)')).toBe('/')
  })
})
