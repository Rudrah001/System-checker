import test from 'node:test';
import assert from 'node:assert/strict';
import { browserMonitorError, browserMonitorSupport, monitorResultFromScreens } from './browserMonitorCheck.js';

test('one screen is PASS and multiple screens are FAIL', () => {
  assert.equal(monitorResultFromScreens([{ label: 'Built-in', width: 1920, height: 1080, isPrimary: true }]).status, 'PASS');
  const result = monitorResultFromScreens([
    { label: 'Built-in', width: 1920, height: 1080, isPrimary: true },
    { label: 'External', width: 2560, height: 1440, isPrimary: false },
  ]);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.screenCount, 2);
  assert.equal(result.screens[1].isPrimary, false);
});

test('empty, unsupported, and denied checks are UNKNOWN-compatible', () => {
  assert.equal(monitorResultFromScreens([]).status, 'UNKNOWN');
  assert.equal(browserMonitorSupport({ isSecureContext: true }).supported, false);
  assert.match(browserMonitorError({ name: 'NotAllowedError' }), /Permission was denied/);
});
