// Web Worker: fetches and parses the large topology JSON off the main thread

const BASE = '/api';

self.onmessage = async () => {
  try {
    self.postMessage({ type: 'status', message: 'Fetching topology data...' });
    const res = await fetch(`${BASE}/network/topology`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);

    self.postMessage({ type: 'status', message: 'Parsing 9 MB of JSON...' });
    const text = await res.text();

    self.postMessage({ type: 'status', message: 'Building node index...' });
    const data = JSON.parse(text);

    self.postMessage({ type: 'done', data });
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err.message || 'Failed to load topology' });
  }
};
