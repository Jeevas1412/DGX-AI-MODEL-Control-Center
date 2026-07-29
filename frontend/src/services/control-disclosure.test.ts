import { describe, expect, it } from 'vitest'
import { controlDisclosure, planExpiryLabel } from './control-disclosure'

describe('control disclosure', () => {
  it('states that each planned service action has not executed yet', () => {
    for (const action of ['warmup', 'restart', 'stop'] as const) {
      const disclosure = controlDisclosure(action)
      expect(disclosure.executionNote).toContain('尚未')
      expect(disclosure.impact).toContain('确认后')
    }
  })

  it('distinguishes the impact of stop from a warmup', () => {
    expect(controlDisclosure('stop').impact).toContain('释放')
    expect(controlDisclosure('warmup').impact).toContain('加载')
  })

  it('formats an expiry as a user-facing clock time', () => {
    expect(planExpiryLabel('2026-07-28T12:34:56.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })
})
