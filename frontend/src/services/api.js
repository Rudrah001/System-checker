const base = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000';

async function jsonResponse(response, action) {
  let body;
  try { body = await response.json(); } catch { throw new Error(`${action} returned an invalid response.`); }
  if (!response.ok) throw new Error(body.detail || `${action} failed (${response.status}).`);
  return body;
}

export async function createSession() {
  const response = await fetch(`${base}/api/sessions`, { method: 'POST' });
  const data = await jsonResponse(response, 'Creating the demo session');
  if (typeof data.session_id !== 'string' || typeof data.frontend_token !== 'string') throw new Error('The server did not return a valid session capability.');
  return data;
}
export async function pairing(id, token) {
  const response = await fetch(`${base}/api/sessions/${encodeURIComponent(id)}/pairing?token=${encodeURIComponent(token)}`, { method: 'POST' });
  return jsonResponse(response, 'Creating a pairing code');
}
export const wsUrl = (path) => base.replace(/^http/, 'ws') + path;
