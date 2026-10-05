export async function getEnabledServices(db) {
    const result = await db
        .prepare('SELECT * FROM services WHERE enabled = 1 ORDER BY sort_order ASC')
        .all();
    return result.results;
}

export async function getAllServices(db) {
    const result = await db
        .prepare('SELECT * FROM services ORDER BY sort_order ASC')
        .all();
    return result.results;
}

export async function getServiceById(db, id) {
    const result = await db
        .prepare('SELECT * FROM services WHERE id = ?')
        .bind(id)
        .first();
    return result;
}

export async function updateServiceRuntimeState(db, id, fields) {
    const columns = [];
    const values = [];
    for (const key of Object.keys(fields)) {
        columns.push(`${key} = ?`);
        values.push(fields[key]);
    }
    values.push(id);
    await db
        .prepare(`UPDATE services SET ${columns.join(', ')} WHERE id = ?`)
        .bind(...values)
        .run();
}

export async function insertCheck(db, check) {
    await db
        .prepare(
            'INSERT INTO checks (service_id, status, response_time, http_status, checked_at) VALUES (?, ?, ?, ?, ?)'
        )
        .bind(check.serviceId, check.status, check.responseTime, check.httpStatus, check.checkedAt)
        .run();
}

export async function getLatestCheck(db, serviceId) {
    const result = await db
        .prepare('SELECT * FROM checks WHERE service_id = ? ORDER BY checked_at DESC LIMIT 1')
        .bind(serviceId)
        .first();
    return result;
}

export async function getChecksSince(db, serviceId, sinceTimestamp) {
    const result = await db
        .prepare(
            'SELECT * FROM checks WHERE service_id = ? AND checked_at >= ? ORDER BY checked_at ASC'
        )
        .bind(serviceId, sinceTimestamp)
        .all();
    return result.results;
}

export async function computeUptime(db, serviceId, sinceTimestamp) {
    const result = await db
        .prepare(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'operational' THEN 1 ELSE 0 END) AS ok
             FROM checks
             WHERE service_id = ? AND checked_at >= ?`
        )
        .bind(serviceId, sinceTimestamp)
        .first();
    const total = result?.total ?? 0;
    const ok = result?.ok ?? 0;
    if (total === 0) {
        return null;
    }
    return Math.round((ok / total) * 10000) / 100;
}

export async function getUptimeBuckets(db, serviceId, sinceTimestamp, bucketCount) {
    const checks = await getChecksSince(db, serviceId, sinceTimestamp);
    const now = Math.floor(Date.now() / 1000);
    const totalSpan = now - sinceTimestamp;
    const bucketSize = Math.max(1, Math.floor(totalSpan / bucketCount));
    const buckets = [];
    for (let i = 0; i < bucketCount; i += 1) {
        const bucketStart = sinceTimestamp + i * bucketSize;
        const bucketEnd = bucketStart + bucketSize;
        const bucketChecks = checks.filter((c) => c.checked_at >= bucketStart && c.checked_at < bucketEnd);
        buckets.push({
            start: bucketStart,
            end: bucketEnd,
            status: summarizeBucketStatus(bucketChecks)
        });
    }
    return buckets;
}

function summarizeBucketStatus(bucketChecks) {
    if (bucketChecks.length === 0) {
        return 'unknown';
    }
    const priority = { outage: 4, degraded: 3, maintenance: 2, unknown: 1, operational: 0 };
    let worst = 'operational';
    for (const check of bucketChecks) {
        if ((priority[check.status] ?? 0) > (priority[worst] ?? 0)) {
            worst = check.status;
        }
    }
    return worst;
}

export async function createIncident(db, incident) {
    const result = await db
        .prepare(
            'INSERT INTO incidents (service_id, title, description, status, started_at) VALUES (?, ?, ?, ?, ?)'
        )
        .bind(incident.serviceId, incident.title, incident.description, incident.status, incident.startedAt)
        .run();
    return result.meta.last_row_id;
}

export async function getOpenIncident(db, serviceId) {
    const result = await db
        .prepare(
            'SELECT * FROM incidents WHERE service_id = ? AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1'
        )
        .bind(serviceId)
        .first();
    return result;
}

export async function resolveIncident(db, incidentId, resolvedAt) {
    await db
        .prepare('UPDATE incidents SET resolved_at = ?, status = ? WHERE id = ?')
        .bind(resolvedAt, 'resolved', incidentId)
        .run();
}

export async function markIncidentNotified(db, incidentId, field) {
    await db
        .prepare(`UPDATE incidents SET ${field} = 1 WHERE id = ?`)
        .bind(incidentId)
        .run();
}

export async function getIncidents(db, limit = 50) {
    const result = await db
        .prepare('SELECT * FROM incidents ORDER BY started_at DESC LIMIT ?')
        .bind(limit)
        .all();
    return result.results;
}

export async function getIncidentsForService(db, serviceId, limit = 50) {
    const result = await db
        .prepare('SELECT * FROM incidents WHERE service_id = ? ORDER BY started_at DESC LIMIT ?')
        .bind(serviceId, limit)
        .all();
    return result.results;
}

export async function deleteOldChecks(db, beforeTimestamp) {
    const result = await db
        .prepare('DELETE FROM checks WHERE checked_at < ?')
        .bind(beforeTimestamp)
        .run();
    return result.meta.changes;
}
