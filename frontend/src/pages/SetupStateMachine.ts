/**
 * Setup wizard pure state machine — determines next step after an action.
 * Extracted from Setup.tsx so it can be unit-tested without React.
 */

export type Step = 'connection' | 'testing' | 'fingerprint' | 'capabilities' | 'complete'
export type ProfileLoadState = 'ready' | 'unavailable'
export type SetupFailure = 'none' | 'profiles' | 'save' | 'verify'

export interface SetupMachineState {
  step: Step
  error: string | null
  profileId: string | null
  capabilityResult: unknown | null
  profileLoad: ProfileLoadState
  failure: SetupFailure
}

export function transition(
  state: SetupMachineState,
  action: 'profilesLoadFail' | 'profilesLoadRetry' | 'saveProfileOk' | 'saveProfileFail' | 'verifyOk' | 'verifyFail' | 'capabilitiesOk' | 'complete',
  payload?: { profileId?: string; result?: unknown; error?: string },
): SetupMachineState {
  switch (action) {
    case 'profilesLoadFail':
      return { step: 'connection', error: payload?.error ?? '无法读取已有配置', profileId: null, capabilityResult: null, profileLoad: 'unavailable', failure: 'profiles' }
    case 'profilesLoadRetry':
      return initialState()
    case 'saveProfileOk':
      return { step: 'testing', error: null, profileId: payload?.profileId ?? null, capabilityResult: null, profileLoad: 'ready', failure: 'none' }
    case 'saveProfileFail':
      return { ...state, step: 'connection', error: payload?.error ?? '保存失败', profileId: null, capabilityResult: null, profileLoad: 'ready', failure: 'save' }
    case 'verifyOk':
      return { ...state, step: 'capabilities', error: null, capabilityResult: payload?.result ?? null, profileLoad: 'ready', failure: 'none' }
    case 'verifyFail':
      return { ...state, step: 'connection', error: payload?.error ?? '验证失败', capabilityResult: null, profileId: null, profileLoad: 'ready', failure: 'verify' }
    case 'capabilitiesOk':
      return { ...state, step: 'complete', error: null, profileLoad: 'ready', failure: 'none' }
    case 'complete':
      return { ...state, step: 'complete', error: null, profileLoad: 'ready', failure: 'none' }
  }
}

/** Initial state */
export function initialState(): SetupMachineState {
  return { step: 'connection', error: null, profileId: null, capabilityResult: null, profileLoad: 'ready', failure: 'none' }
}
