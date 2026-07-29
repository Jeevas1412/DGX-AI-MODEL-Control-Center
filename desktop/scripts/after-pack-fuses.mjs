import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';
import { join } from 'node:path';

/** Applies production-only Electron hardening after electron-builder packs app.asar. */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const executable = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await flipFuses(executable, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    // Application code, renderer assets and backend source are all packaged
    // into app.asar, so Electron must reject a replacement app outside it.
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    // The current packaged renderer still uses file://. Keep its required
    // privileges until a tested custom protocol replaces it.
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
  });
}
