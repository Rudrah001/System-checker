import test from 'node:test';
import assert from 'node:assert/strict';
import { gitBashLaunchCommand } from './devLaunch.js';

test('Git Bash command embeds the supplied pairing code, not a session id', () => {
  const pairingCode = 'actual_pairing_code_123456';
  const command = gitBashLaunchCommand(pairingCode);
  assert.match(command, /cd \/c\/Projects\/system-check-poc/);
  assert.match(command, new RegExp(`code=${pairingCode}`));
  assert.doesNotMatch(command, /session_id/);
});
test('Git Bash command rejects invalid pairing values', () => assert.throws(() => gitBashLaunchCommand('short'), /valid pairing code/));
