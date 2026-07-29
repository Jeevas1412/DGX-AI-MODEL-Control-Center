import { describe, expect, it } from 'vitest'
import { localizedModelName, localizedServiceName } from './display-labels'

describe('display labels', () => {
  it('uses product-facing Chinese names without changing model identifiers', () => {
    expect(localizedModelName('Hy-MT2-30B-A3B-FP8')).toBe('混元 MT2 30B-A3B FP8')
    expect(localizedModelName('nvidia-Qwen3.6-35B-A3B-NVFP4')).toBe('千问3.6 35B-A3B NVFP4')
    expect(localizedServiceName('nvfp4', 'qwen3.6-27b-nvfp4')).toBe('千问3.6 27B NVFP4')
  })
})
