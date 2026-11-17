// This module is used only by the Vite development branch in App.jsx.
export function gitBashLaunchCommand(pairingCode) {
  if (typeof pairingCode !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(pairingCode)) throw new Error('A valid pairing code is required.');
  return `cd /c/Projects/system-check-poc && export PYTHONPATH="$PWD" && python -m native_checker.main 'systemchecker://start?code=${pairingCode}'`;
}
