// Data sync via the GitHub Contents API — the workout log lives as a JSON file
// in this same repository. Token is a fine-grained PAT stored only on-device.

const OWNER = 'FabianB88';
const REPO = 'Fitnessapp';
const PATH = 'data/log.json';
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;

const TOKEN_KEY = 'five5x5.token';
let knownSha = null;

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t.trim());
  else localStorage.removeItem(TOKEN_KEY);
}

function headers() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${getToken()}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function b64encode(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export async function fetchRemote() {
  const res = await fetch(`${API}?t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
  if (res.status === 404) { knownSha = null; return null; }
  if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
  const json = await res.json();
  knownSha = json.sha;
  return JSON.parse(b64decode(json.content));
}

export async function pushRemote(data, retry = true) {
  const body = {
    message: `Log update ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    content: b64encode(JSON.stringify(data, null, 2)),
  };
  if (knownSha) body.sha = knownSha;
  const res = await fetch(API, { method: 'PUT', headers: headers(), body: JSON.stringify(body) });
  if ((res.status === 409 || res.status === 422) && retry) {
    // Stale sha — refresh it and retry once.
    await fetchRemote();
    return pushRemote(data, false);
  }
  if (!res.ok) throw new Error(`GitHub write failed (${res.status})`);
  const json = await res.json();
  knownSha = json.content.sha;
}
