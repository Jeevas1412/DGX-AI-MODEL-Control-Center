import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteDesktopStatusProvider, parseRemoteDesktopStatus, readOnlyRemoteDesktopScript } from '../src/remote-desktop-status.mjs';

test('remote desktop read-only probe contains no mutation or credential commands', () => {
  const script = readOnlyRemoteDesktopScript();
  assert.match(script, /gnome-remote-desktop\.service/);
  assert.match(script, /sport = :3389/);
  assert.doesNotMatch(script, /sudo|grdctl\s+.*(?:enable|disable|set-|clear-|start|stop)|useradd|passwd|firewall|ufw|iptables/i);
});

test('remote desktop status parses an existing service as external without claiming product control', () => {
  const value = parseRemoteDesktopStatus(JSON.stringify({ supported: true, service: 'active', listener: 'listening' }), { checkedAt: '2026-07-27T08:00:00.000Z' });
  assert.deepEqual(value, {
    state: 'externally-managed', checkedAt: '2026-07-27T08:00:00.000Z', service: 'active', listener: 'listening', nla: 'unknown', management: 'external',
    nextStep: '检测到已运行的 GNOME 远程桌面。当前按外部管理处理，不会改写账户、凭据、TLS 或服务配置。',
  });
});

test('remote desktop status refuses invalid response and binds the provider to the verified SSH target', async () => {
  await assert.rejects(async () => parseRemoteDesktopStatus('not-json'), /invalid JSON/);
  let input;
  const provider = createRemoteDesktopStatusProvider({
    sshTargetProvider: async () => 'dgx-verified',
    execute: async (value) => { input = value; return JSON.stringify({ supported: true, service: 'inactive', listener: 'not-listening' }); },
    now: () => new Date('2026-07-27T08:01:00.000Z'),
  });
  const value = await provider();
  assert.equal(input.sshTarget, 'dgx-verified');
  assert.equal(input.timeoutMs, 15_000);
  assert.equal(value.state, 'requires-admin-bootstrap');
  assert.equal(value.management, 'not-configured');
});
