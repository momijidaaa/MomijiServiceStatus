const STATUS_META = {
    operational: { label: 'Operational', dot: '🟢', className: 'status-operational' },
    degraded: { label: 'Degraded', dot: '🟡', className: 'status-degraded' },
    outage: { label: 'Outage', dot: '🔴', className: 'status-outage' },
    maintenance: { label: 'Maintenance', dot: '🔵', className: 'status-maintenance' },
    unknown: { label: 'Unknown', dot: '⚪', className: 'status-unknown' }
};

const OVERALL_META = {
    operational: {
        icon: '🟢',
        title: 'All Systems Operational',
        subtitle: 'すべてのサービスが正常に稼働しています'
    },
    degraded: {
        icon: '🟡',
        title: 'Some Systems Degraded',
        subtitle: '一部のサービスで問題が発生しています'
    },
    outage: {
        icon: '🔴',
        title: 'System Outage',
        subtitle: 'サービス障害が発生しています'
    },
    maintenance: {
        icon: '🔵',
        title: 'Maintenance',
        subtitle: 'メンテナンス中のサービスがあります'
    },
    unknown: {
        icon: '⚪',
        title: 'Status Unknown',
        subtitle: '現在の状態を取得できませんでした'
    }
};

function getStatusMeta(status) {
    return STATUS_META[status] || STATUS_META.unknown;
}

function getOverallMeta(status) {
    return OVERALL_META[status] || OVERALL_META.unknown;
}

function formatTime(unixSeconds) {
    if (!unixSeconds) {
        return '--:--:--';
    }
    const date = new Date(unixSeconds * 1000);
    return date.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

function formatDateTime(unixSeconds) {
    if (!unixSeconds) {
        return '-';
    }
    const date = new Date(unixSeconds * 1000);
    return date.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

function formatDuration(startSeconds, endSeconds) {
    if (!endSeconds) {
        return '進行中';
    }
    const diff = endSeconds - startSeconds;
    if (diff < 60) {
        return `${diff} seconds`;
    }
    const minutes = Math.round(diff / 60);
    if (minutes < 60) {
        return `${minutes} minutes`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}

function formatUptimeValue(value) {
    if (value === null || value === undefined) {
        return 'N/A';
    }
    return `${value.toFixed(2)}%`;
}

function uptimeBarColor(status) {
    const meta = getStatusMeta(status);
    if (meta.className === 'status-operational') return 'var(--green)';
    if (meta.className === 'status-degraded') return 'var(--yellow)';
    if (meta.className === 'status-outage') return 'var(--red)';
    if (meta.className === 'status-maintenance') return 'var(--blue)';
    return 'var(--border)';
}
