/**
 * Resolves the one profile that is permitted to back a remote read session.
 * It deliberately has no SSH/HTTP code: callers inject a lazy session factory.
 */
export function createActiveProfileSessionManager({ profileStore, createSession }) {
  if (!profileStore || typeof profileStore.load !== 'function' || typeof createSession !== 'function') {
    throw new Error('Active profile session manager requires a profile store and session factory.');
  }
  let cachedKey = null;
  let cachedSession = null;

  async function activeProfile() {
    const document = await profileStore.load();
    if (!document.activeProfileId) throw new Error('No verified active connection profile is selected.');
    const profile = document.profiles.find((item) => item.id === document.activeProfileId);
    if (!profile || profile.verification?.status !== 'verified') {
      throw new Error('The active connection profile is not verified.');
    }
    return profile;
  }

  async function getSession() {
    const profile = await activeProfile();
    const key = `${profile.id}:${profile.sshAlias}:${profile.verification.verifiedAt}`;
    if (cachedSession && cachedKey === key) return cachedSession;
    cachedSession = await createSession(profile);
    cachedKey = key;
    return cachedSession;
  }

  return Object.freeze({ activeProfile, getSession });
}
