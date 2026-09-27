const REFRESH_INTERVAL_MS = 30000;

const webContainer = document.getElementById('webServices');
const botContainer = document.getElementById('botServices');
const overallCard = document.getElementById('overallCard');
const overallIcon = document.getElementById('overallIcon');
const overallTitle = document.getElementById('overallTitle');
const overallSubtitle = document.getElementById('overallSubtitle');
const lastUpdatedEl = document.getElementById('lastUpdated');
const uptimeSummaryEl = document.getElementById('uptimeSummary');
const incidentListEl = document.getElementById('incidentList');
const modalOverlay = document.getElementById('modalOverlay');
const modalContent = document.getElementById('modalContent');

function renderOverall(status) {
    const meta = getOverallMeta(status);
    overallIcon.textContent = meta.icon;
    overallTitle.textContent = meta.title;
    overallSubtitle.textContent = meta.subtitle;
}

function renderServiceCard(service) {
    const meta = getStatusMeta(service.status);
    const card = document.createElement('div');
    card.className = 'service-card';
    card.addEventListener('click', () => openServiceModal(service.id));

    const responseRow = service.category === 'bot' && service.responseTime === null
        ? ''
        : `<div class="meta-row"><span>Response</span><span>${service.responseTime !== null ? service.responseTime + ' ms' : '-'}</span></div>`;

    card.innerHTML = `
        <div class="service-card-top">
            <div class="service-name">${escapeHtml(service.name)}</div>
            <div class="service-dot">${meta.dot}</div>
        </div>
        <div class="service-description">${escapeHtml(service.description || '')}</div>
        <div class="service-status-label ${meta.className}">${meta.label}</div>
        <div class="service-meta">
            ${responseRow}
            <div class="meta-row"><span>HTTP Status</span><span>${service.httpStatus ?? '-'}</span></div>
            <div class="meta-row"><span>Last checked</span><span>${formatTime(service.lastChecked)}</span></div>
            <div class="meta-row uptime-row"><span>24h uptime</span><span>${formatUptimeValue(service.uptime24h)}</span></div>
        </div>
    `;
    return card;
}

function renderServices(services) {
    webContainer.innerHTML = '';
    botContainer.innerHTML = '';
    for (const service of services) {
        const card = renderServiceCard(service);
        if (service.category === 'bot') {
            botContainer.appendChild(card);
        } else {
            webContainer.appendChild(card);
        }
    }
}

function renderUptimeSummary(uptimeOverall) {
    uptimeSummaryEl.innerHTML = '';
    const periods = [
        { key: '24h', label: '24 Hours' },
        { key: '7d', label: '7 Days' },
        { key: '30d', label: '30 Days' }
    ];
    for (const period of periods) {
        const value = uptimeOverall ? uptimeOverall[period.key] : null;
        const percent = value === null || value === undefined ? 0 : value;
        const row = document.createElement('div');
        row.className = 'uptime-row-full';
        row.innerHTML = `
            <div class="uptime-row-header">
                <strong>${period.label}</strong>
                <span>${formatUptimeValue(value)}</span>
            </div>
            <div class="uptime-bar-track">
                <div style="width:${percent}%; background: var(--green); border-radius: 6px;"></div>
            </div>
        `;
        uptimeSummaryEl.appendChild(row);
    }
}

function renderIncidents(incidents, servicesById) {
    incidentListEl.innerHTML = '';
    if (!incidents || incidents.length === 0) {
        incidentListEl.innerHTML = '<div class="empty-state">障害履歴はありません</div>';
        return;
    }
    for (const incident of incidents) {
        const service = servicesById[incident.service_id];
        const serviceName = service ? service.name : incident.service_id;
        const resolved = Boolean(incident.resolved_at);
        const badgeClass = resolved ? 'badge-resolved' : 'badge-investigating';
        const badgeText = resolved ? 'Resolved' : 'Investigating';
        const dot = resolved ? '🟢' : '🔴';

        const card = document.createElement('div');
        card.className = 'incident-card';
        card.innerHTML = `
            <div class="incident-card-title">
                <span>${dot}</span>
                <span>${escapeHtml(serviceName)}</span>
                <span class="incident-badge ${badgeClass}">${badgeText}</span>
            </div>
            <div class="incident-card-desc">${escapeHtml(incident.title)}</div>
            <div class="incident-meta">
                <span>Started: ${formatDateTime(incident.started_at)}</span>
                <span>${resolved ? 'Resolved: ' + formatDateTime(incident.resolved_at) : ''}</span>
                <span>Duration: ${formatDuration(incident.started_at, incident.resolved_at)}</span>
            </div>
        `;
        incidentListEl.appendChild(card);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function openServiceModal(id) {
    modalOverlay.classList.add('open');
    modalContent.innerHTML = '<div class="empty-state">読み込み中...</div>';
    try {
        const detail = await fetchServiceDetail(id);
        const meta = getStatusMeta(detail.status);
        let barsHtml = '';
        if (detail.bars24h) {
            barsHtml = detail.bars24h
                .map((bucket) => `<div class="uptime-block" title="${formatDateTime(bucket.start)}" style="background:${uptimeBarColor(bucket.status)}"></div>`)
                .join('');
        }
        modalContent.innerHTML = `
            <span class="modal-close" id="modalCloseBtn">✕ close</span>
            <h3>${escapeHtml(detail.name)}</h3>
            <div class="modal-sub">${escapeHtml(detail.description || '')}</div>
            <div class="modal-row"><span>Status</span><span class="${meta.className}">${meta.label}</span></div>
            <div class="modal-row"><span>Response Time</span><span>${detail.responseTime !== null ? detail.responseTime + ' ms' : '-'}</span></div>
            <div class="modal-row"><span>HTTP Status</span><span>${detail.httpStatus ?? '-'}</span></div>
            <div class="modal-row"><span>Last checked</span><span>${formatDateTime(detail.lastChecked)}</span></div>
            <div class="modal-row"><span>24h uptime</span><span>${formatUptimeValue(detail.uptime?.['24h'])}</span></div>
            <div class="modal-row"><span>7d uptime</span><span>${formatUptimeValue(detail.uptime?.['7d'])}</span></div>
            <div class="modal-row"><span>30d uptime</span><span>${formatUptimeValue(detail.uptime?.['30d'])}</span></div>
            <div style="margin-top:14px;">
                <div class="uptime-row-header" style="margin-bottom:8px;"><strong>過去24時間</strong><span></span></div>
                <div class="uptime-bar-track">${barsHtml}</div>
            </div>
        `;
        document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    } catch (error) {
        modalContent.innerHTML = `
            <span class="modal-close" id="modalCloseBtn">✕ close</span>
            <div class="empty-state">詳細情報を取得できませんでした</div>
        `;
        document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    }
}

function closeModal() {
    modalOverlay.classList.remove('open');
}

modalOverlay.addEventListener('click', (event) => {
    if (event.target === modalOverlay) {
        closeModal();
    }
});

async function loadStatus() {
    try {
        const data = await fetchStatus();
        renderOverall(data.overall);
        renderServices(data.services);
        renderUptimeSummary(data.uptimeOverall);
        lastUpdatedEl.textContent = `Last updated: ${formatTime(data.updatedAt)}`;

        const servicesById = {};
        for (const service of data.services) {
            servicesById[service.id] = service;
        }

        const incidentData = await fetchIncidents();
        renderIncidents(incidentData.incidents, servicesById);
    } catch (error) {
        overallTitle.textContent = 'Unable to load status';
        overallSubtitle.textContent = 'ステータス情報を取得できませんでした';
        overallIcon.textContent = '⚪';
        console.log('Failed to load status', error.message);
    }
}

loadStatus();
setInterval(loadStatus, REFRESH_INTERVAL_MS);
