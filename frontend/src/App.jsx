import { useEffect, useState } from 'react';
import { createSession, pairing } from './services/api';
import { connect } from './services/websocket';
import { gitBashLaunchCommand } from './services/devLaunch';
import Dashboard from './components/SystemCheckDashboard';

const isDevelopment = import.meta.env.DEV;

export default function App() {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [devLaunchCommand, setDevLaunchCommand] = useState('');

  useEffect(() => {
    if (!session) return undefined;
    return connect(session, setStatus, (detail) => setMessage(detail));
  }, [session]);

  const create = async () => {
    if (creating || session) return;
    setCreating(true); setError(''); setMessage('Creating demo session…');
    try {
      const createdSession = await createSession();
      setSession(createdSession); setStatus(null); setDevLaunchCommand('');
      setMessage('Demo session created. Start the system check when ready.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to create the demo session.'); setMessage('');
    } finally { setCreating(false); }
  };

  const requestPairing = async () => pairing(session.session_id, session.frontend_token);

  const start = async () => {
    if (!session || launching) return;
    setLaunching(true); setError(''); setDevLaunchCommand('');
    try {
      const pair = await requestPairing();
      window.location.href = `systemchecker://start?code=${encodeURIComponent(pair.code)}`;
      setMessage('Launch requested. Confirm the browser prompt; the server will confirm the native connection.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to launch system check.');
    } finally { setLaunching(false); }
  };

  const createDevFallback = async () => {
    if (!session || launching) return;
    setLaunching(true); setError('');
    try {
      const pair = await requestPairing();
      setDevLaunchCommand(gitBashLaunchCommand(pair.code));
      setMessage('Development pairing code generated. Copy and run the Git Bash command within two minutes.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to create development launch command.');
    } finally { setLaunching(false); }
  };

  const copyDevCommand = async () => {
    try { await navigator.clipboard.writeText(devLaunchCommand); setMessage('Git Bash command copied.'); }
    catch { setError('Unable to copy automatically. Select the command and copy it manually.'); }
  };

  return <main>
    <h1>System Check POC</h1>
    <p>Live Windows monitoring through a secure native WebSocket connection.</p>
    {!session && <button onClick={create} disabled={creating}>{creating ? 'Creating Demo Interview…' : 'Create Demo Interview'}</button>}
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {session && <>
      <p>Demo session ID</p><code>{session.session_id}</code>
      <button onClick={start} disabled={launching}>{launching ? 'Starting System Check…' : 'Start System Check'}</button>
      <button onClick={start} disabled={launching}>Retry launch</button>
      {isDevelopment && <button onClick={createDevFallback} disabled={launching}>Generate Git Bash Fallback</button>}
      {isDevelopment && devLaunchCommand && <section className="dev-launch">
        <h2>Development: launch native checker from Git Bash</h2>
        <p>This one-time pairing code expires shortly. It is not included in production builds.</p>
        <code>{devLaunchCommand}</code>
        <button onClick={copyDevCommand}>Copy Git Bash Command</button>
      </section>}
      <Dashboard status={status} />
      <aside>Native checker not installed? Install the packaged Windows installer, then retry. Browsers cannot reliably detect a missing custom protocol handler.</aside>
    </>}
  </main>;
}
