import { describe, expect, it } from 'vitest'
import { localizedModelName, localizedServiceName, modelLoadState } from './display-labels'

describe('display labels', () => {
  it('uses product-facing Chinese names without changing model identifiers', () => {
    expect(localizedModelName('Hy-MT2-30B-A3B-FP8')).toBe('混元 MT2 30B-A3B FP8')
    expect(localizedModelName('nvidia-Qwen3.6-35B-A3B-NVFP4')).toBe('千问3.6 35B-A3B NVFP4')
    expect(localizedServiceName('nvfp4', 'qwen3.6-27b-nvfp4')).toBe('千问3.6 27B NVFP4')
  })

  it('keeps service registration separate from observed model loading', () => {
    expect(modelLoadState(60.4)).toEqual({ label: '已加载', detail: '已检测到模型进程', tone: 'loaded' })
    expect(modelLoadState(null)).toEqual({ label: '未加载', detail: '未检测到模型进程', tone: 'unloaded' })
  })
})
