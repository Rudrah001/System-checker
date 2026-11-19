import { useEffect, useRef, useState } from 'react';
import { createSession, pairing, systemCheckerInstallerUrl } from './services/api';
import { connect } from './services/websocket';
import { gitBashLaunchCommand } from './services/devLaunch';
import { useBrowserMonitorCheck } from './services/browserMonitorCheck';
import Dashboard from './components/SystemCheckDashboard';
import BrowserMonitorPanel from './components/BrowserMonitorPanel';

const isDevelopment = import.meta.env.DEV;
const CONNECTION_TIMEOUT_MS = 12_000;

export default function App() {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [awaitingConnection, setAwaitingConnection] = useState(false);
  const [devLaunchCommand, setDevLaunchCommand] = useState('');
  const connectionTimeout = useRef(null);
  const browserMonitor = useBrowserMonitorCheck();

  const clearConnectionTimeout = () => {
    window.clearTimeout(connectionTimeout.current);
    connectionTimeout.current = null;
  };

  useEffect(() => {
    if (!session) return undefined;
    return connect(session, setStatus, (detail) => setMessage(detail));
  }, [session]);

  useEffect(() => {
    if (status?.native_connection === 'CONNECTED' && awaitingConnection) {
      clearConnectionTimeout();
      setAwaitingConnection(false);
      setError('');
      setMessage('System Checker connected. Receiving live results.');
    }
  }, [status, awaitingConnection]);

  useEffect(() => () => clearConnectionTimeout(), []);

  const create = async () => {
    if (creating || session) return;
    setCreating(true); setError(''); setMessage('Creating demo session...');
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
    clearConnectionTimeout();
    setLaunching(true); setError(''); setDevLaunchCommand(''); setAwaitingConnection(false);
    try {
      const pair = await requestPairing();
      window.location.href = `systemchecker://start?code=${encodeURIComponent(pair.code)}`;
      setMessage('Launch requested. Approve the browser prompt; waiting for the server to confirm the native connection.');
      setAwaitingConnection(true);
      connectionTimeout.current = window.setTimeout(() => {
        setAwaitingConnection(false);
        setError('System Checker did not connect. If it is not installed, download and install it first. Otherwise, approve the browser prompt and retry.');
      }, CONNECTION_TIMEOUT_MS);
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
    <section className="installer-download">
      <h2>Need the Windows System Checker?</h2>
      <a className="download-button" href={systemCheckerInstallerUrl()}>Download System Checker for Windows</a>
      <ol>
        <li>Open the downloaded <code>SystemCheckerSetup.exe</code>.</li>
        <li>Complete the Windows installation once.</li>
        <li>Return here, click Start System Check, and approve the browser prompt if shown.</li>
      </ol>
    </section>
    {!session && <button onClick={create} disabled={creating}>{creating ? 'Creating Demo Interview...' : 'Create Demo Interview'}</button>}
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {session && <>
      <p>Demo session ID</p><code>{session.session_id}</code>
      <div className="check-actions">
        <button onClick={browserMonitor.check}>Check Monitors in Browser</button>
        <button onClick={start} disabled={launching}>{launching ? 'Starting System Check...' : 'Start System Check (Native)'}</button>
        <button onClick={start} disabled={launching}>Retry Native Launch</button>
      </div>
      {awaitingConnection && <p role="status">Waiting for authenticated native connection...</p>}
      {isDevelopment && <button onClick={createDevFallback} disabled={launching}>Generate Git Bash Fallback</button>}
      {isDevelopment && devLaunchCommand && <section className="dev-launch">
        <h2>Development: launch native checker from Git Bash</h2>
        <p>This one-time pairing code expires shortly. It is not included in production builds.</p>
        <code>{devLaunchCommand}</code>
        <button onClick={copyDevCommand}>Copy Git Bash Command</button>
      </section>}
      <BrowserMonitorPanel support={browserMonitor.support} result={browserMonitor.result} />
      <Dashboard status={status} />
      <aside>Browsers cannot reliably detect whether a custom-protocol application is installed. If no connection appears, download/install the checker, approve the prompt, and retry.</aside>
    </>}
  </main>;
}
