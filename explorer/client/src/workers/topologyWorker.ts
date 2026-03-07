// Web Worker: fetches and parses the large topology JSON off the main thread

const BASE = '/api';

self.onmessage = async (e) => {
  try {
    const activeOnly = e.data?.activeOnly !== false; // default true
    const url = `${BASE}/network/topology${activeOnly ? '?active_only=true' : ''}`;
    self.postMessage({ type: 'status', message: 'Fetching topology data...' });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API error: ${res.status}`);

    self.postMessage({ type: 'status', message: 'Parsing topology JSON...' });
    const text = await res.text();

    self.postMessage({ type: 'status', message: 'Building node index...' });
    const data = JSON.parse(text);

    self.postMessage({ type: 'done', data });
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err.message || 'Failed to load topology' });
  }
};
