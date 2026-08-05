import { createServer } from 'node:http';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from './app.mjs';
import { createApplicationCore } from './application-core.mjs';
import { readConfig } from './config.mjs';
import { createBenchmarkHistoryProvider } from './benchmark-history.mjs';
import { createDgxLogProvider, createDgxSnapshotProvider, createSnapshotCache, executeRemoteScript } from './dgx-collector.mjs';
import { createCapabilityDiscovery } from './capability-discovery.mjs';
import { createConnectionProfileStore } from './connection-profile.mjs';
import { createActiveProfileSessionManager } from './profile-session.mjs';
import { createRuntimePaths } from './runtime-paths.mjs';
import { createLocalServiceController } from './local-service-control.mjs';
import { createLegacyCurrentDgxServiceAdapter } from './legacy-adapters/current-dgx-service-adapter.mjs';
import { createOperationLedger } from './operation-ledger.mjs';
import { createVerifiedOperationContextProvider } from './verified-operation-context.mjs';
import { createKnownHostFingerprintLookup } from './ssh-host-key.mjs';
import { createModelCatalog } from './model-catalog.mjs';
import { createModelSearchProvider } from './model-search.mjs';
import { createModelServiceRegistry } from './model-service-registry.mjs';
import { createModelServiceAdapterDiscovery } from './model-service-adapter-discovery.mjs';
import { createTargetSupportProfileProvider } from './target-support-profile-provider.mjs';
import { createModelServiceRegistrar } from './model-service-registration.mjs';
import { createChangeAuditStore } from './change-audit-store.mjs';
import { createNvfp4ParameterAdapter } from './nvfp4-parameter-adapter.mjs';
import { createNvfp4ParameterControl } from './nvfp4-parameter-control.mjs';
import { createRemoteDesktopStatusProvider } from './remote-desktop-status.mjs';
import { createHardwareSnapshotCache, createHardwareSnapshotProvider } from './hardware-collector.mjs';
import { createHardwareHistoryStore } from './hardware-history.mjs';
import { createExternalRuntimeCoordinator } from './external-runtime-coordinator.mjs';
import { createNodeSnapshotProvider } from './node-probe.mjs';

function createPublicAuditWriter(filePath) {
  return async (record) => {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  };
}

export function createApiServer(options = {}) {
  return createServer(createApiHandler(options));
}

export function createConfiguredApplicationCore(config = readConfig(), { runtimePaths = createRuntimePaths() } = {}) {
  const operationLedger = createOperationLedger({ filePath: runtimePaths.operationLedger });
  const profileStore = createConnectionProfileStore({
    filePath: runtimePaths.connectionProfiles,
    canActivate: async () => !await operationLedger.hasBlockingOperation(),
  });
  const benchmarkProvider = createBenchmarkHistoryProvider({
    filePath: runtimePaths.benchmarkHistory,
  });
  const modelCatalog = createModelCatalog({ filePath: runtimePaths.modelCatalog });
  const modelServiceRegistry = createModelServiceRegistry({ filePath: runtimePaths.modelServiceRegistry });
  const changeAuditStore = createChangeAuditStore({ filePath: runtimePaths.changeAudit });
  const hardwareHistoryStore = createHardwareHistoryStore({ filePath: runtimePaths.hardwareHistory });
  // Profile verification is an explicit Setup action, not a monitoring
  // session. Keep remote monitoring disabled by default, but do not make a
  // newly created profile impossible to verify and activate.
  const knownHostFingerprint = createKnownHostFingerprintLookup();
  const profileVerifier = async (profile) => {
    const trustedHostKeyFingerprints = await knownHostFingerprint(profile.sshAlias);
    const result = await createCapabilityDiscovery({ sshTarget: profile.sshAlias })();
    return { ...result, trustedHostKeyFingerprints };
  };
  // The connection lamp is independent of the optional monitoring session.
  // It uses only the selected, verified OpenSSH alias and a fixed no-op probe.
  const sshTargetProvider = async () => {
    const document = await profileStore.load();
    const profile = document.profiles.find((item) => item.id === document.activeProfileId);
    if (!profile || profile.verification?.status !== 'verified') throw new Error('No verified active connection profile is selected.');
    return profile.sshAlias;
  };
  const connectionStatusProvider = async () => {
    const checkedAt = new Date().toISOString();
    try {
      const response = await executeRemoteScript({ sshTarget: await sshTargetProvider(), script: "printf 'dgx-connection-ok\\n'\n", timeoutMs: 12_000 });
      return Object.freeze({ status: response.trim() === 'dgx-connection-ok' ? 'connected' : 'disconnected', checkedAt });
    } catch { return Object.freeze({ status: 'disconnected', checkedAt }); }
  };
  // Like the top-bar connectivity lamp, this status provider is independent
  // of optional monitoring. It performs a fixed, read-only probe only when
  // the user opens or refreshes the Remote Desktop page.
  const remoteDesktopStatusProvider = createRemoteDesktopStatusProvider({ sshTargetProvider });
  if (!config.dgxReadOnlyEnabled) {
    return createApplicationCore({ profileStore, profileVerifier, benchmarkProvider, modelCatalog, modelServiceRegistry, changeAuditStore, connectionStatusProvider, remoteDesktopStatusProvider });
  }
  const createSessionForProfile = async (profile) => Object.freeze({
    snapshotProvider: createSnapshotCache(
      createDgxSnapshotProvider({ sshTarget: profile.sshAlias }),
      { ttlMs: config.dgxSnapshotCacheMs },
    ),
    logProvider: createDgxLogProvider({ sshTarget: profile.sshAlias }),
    capabilityProvider: createCapabilityDiscovery({ sshTarget: profile.sshAlias }),
    modelServiceAdapterDiscovery: createModelServiceAdapterDiscovery({ sshTarget: profile.sshAlias }),
    targetSupportProfileProvider: createTargetSupportProfileProvider({ sshTarget: profile.sshAlias }),
    hardwareSnapshotProvider: createHardwareSnapshotCache(createHardwareSnapshotProvider({ sshTarget: profile.sshAlias })),
  });
  const sessionManager = createActiveProfileSessionManager({
    profileStore,
    createSession: createSessionForProfile,
  });
  const nodeSnapshotProvider = createNodeSnapshotProvider({ profileStore, createSession: createSessionForProfile });
  const snapshotProvider = async () => (await sessionManager.getSession()).snapshotProvider();
  const logProvider = async (...args) => (await sessionManager.getSession()).logProvider(...args);
  const capabilityProvider = async () => (await sessionManager.getSession()).capabilityProvider();
  const modelServiceAdapterDiscovery = async () => (await sessionManager.getSession()).modelServiceAdapterDiscovery();
  const targetSupportProfileProvider = async () => (await sessionManager.getSession()).targetSupportProfileProvider();
  const hardwareSnapshotProvider = async () => (await sessionManager.getSession()).hardwareSnapshotProvider();
  const activeProfileProvider = async () => {
    const document = await profileStore.load();
    return document.profiles.find((item) => item.id === document.activeProfileId) ?? null;
  };
  const modelSearchProvider = createModelSearchProvider({ executeRemote: executeRemoteScript, sshTargetProvider, activeProfileProvider, targetSupportProfileProvider });
  const modelServiceRegistrar = createModelServiceRegistrar({ sshTargetProvider, execute: executeRemoteScript });
  const externalRuntimeCoordinator = createExternalRuntimeCoordinator({ sshTargetProvider });
  const nvfp4ParameterAdapter = createNvfp4ParameterAdapter({ sshTargetProvider });
  const nvfp4ParameterControl = createNvfp4ParameterControl({
    snapshotProvider,
    parameterAdapter: nvfp4ParameterAdapter,
    audit: createPublicAuditWriter(runtimePaths.changeAudit),
  });
  const modelServiceExecutor = async ({ adapterId, action }) => {
    if (!/^adapter-[a-z0-9-]{3,64}$/.test(adapterId) || !['warmup', 'restart', 'stop'].includes(action)) throw new Error('Managed service action is invalid.');
    // Restart uses the same fixed stop-then-start adapter path as warmup.
    // A large model can legitimately take several minutes to load, so a
    // short stop-only timeout would falsely report failure while the remote
    // adapter is still completing the verified restart.
    return executeRemoteScript({ sshTarget: await sshTargetProvider(), timeoutMs: ['warmup', 'restart'].includes(action) ? 1_300_000 : 90_000, script: `exec "$HOME/.dgx-ai-control-center/adapters/${adapterId}/run.sh" ${action}\n` });
  };
  const operationContextProvider = createVerifiedOperationContextProvider({ profileStore, profileVerifier });
  const localControl = config.localControlEnabled
    ? createLocalServiceController({
      snapshotProvider,
      executeRemote: executeRemoteScript,
      sshTargetProvider,
      adapter: createLegacyCurrentDgxServiceAdapter(),
      operationLedger,
      operationContextProvider,
      audit: createPublicAuditWriter(runtimePaths.localServiceControlAudit),
    })
    : null;
  return createApplicationCore({
    snapshotProvider,
    logProvider,
    capabilityProvider,
    profileStore,
    profileVerifier,
    benchmarkProvider,
    modelCatalog,
    modelSearchProvider,
    modelServiceRegistry,
    modelServiceAdapterDiscovery,
    modelServiceRegistrar,
    modelServiceExecutor,
    externalRuntimeCoordinator,
    localControl,
    changeAuditStore,
    nvfp4ParameterAdapter,
    nvfp4ParameterControl,
    connectionStatusProvider,
    remoteDesktopStatusProvider,
    hardwareSnapshotProvider,
    hardwareHistoryStore,
    nodeSnapshotProvider,
  });
}

export function createConfiguredApiServer(config = readConfig(), options = {}) {
  return createApiServer({ core: createConfiguredApplicationCore(config, options), corsOrigins: config.corsOrigins, apiToken: config.apiToken });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = readConfig();
  const server = createConfiguredApiServer(config);
  server.listen(config.port, config.host, () => {
    console.log(`Read-only DGX control API listening on http://${config.host}:${config.port}`);
  });
}
