const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:8787'
    : 'https://api.momijiweb.jp';

async function apiGet(path) {
    const response = await fetch(`${API_BASE_URL}${path}`);
    if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
    }
    return response.json();
}

async function fetchStatus() {
    return apiGet('/api/status');
}

async function fetchServiceDetail(id) {
    return apiGet(`/api/status/${id}`);
}

async function fetchIncidents() {
    return apiGet('/api/incidents');
}

async function fetchUptime(id, period) {
    return apiGet(`/api/uptime/${id}?period=${period}`);
}
