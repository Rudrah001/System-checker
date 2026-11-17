import { wsUrl } from './api';
export function connect(session, onStatus, onError) {
  let stopped = false, ws, retry = 500, retryTimer;
  const open = () => {
    try { ws = new WebSocket(wsUrl(`/ws/interview/${encodeURIComponent(session.session_id)}?token=${encodeURIComponent(session.frontend_token)}`)); }
    catch (error) { onError?.(`Unable to start live updates: ${error.message}`); return; }
    ws.onmessage = (event) => { try { const message = JSON.parse(event.data); if (message.type === 'status') onStatus(message.data); } catch { onError?.('Received an invalid live-status message.'); } };
    ws.onerror = () => onError?.('Live status connection unavailable. Retrying…');
    ws.onclose = () => { if (!stopped) retryTimer = window.setTimeout(open, retry = Math.min(retry * 2, 5000)); };
    ws.onopen = () => { retry = 500; };
  };
  open();
  return () => { stopped = true; window.clearTimeout(retryTimer); ws?.close(); };
}
