import { checkService, resolveServiceState } from './monitor.js';
import {
    getEnabledServices,
    getAllServices,
    getServiceById,
    updateServiceRuntimeState,
    insertCheck,
    computeUptime,
    createIncident,
    getOpenIncident,
    resolveIncident,
    markIncidentNotified,
    getIncidents,
    getIncidentsForService,
    deleteOldChecks,
    getUptimeBuckets
} from './database.js';
import { sendOutageNotification, sendRecoveryNotification } from './notify.js';

function jsonResponse(data, status, origin) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin || '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    });
}

function nowUnix() {
    return Math.floor(Date.now() / 1000);
}

async function withEdgeCache(request, ctx, ttlSeconds, handler) {
    const cache = caches.default;
    const cacheKey = new Request(request.url, request);
    const cached = await cache.match(cacheKey);
    if (cached) {
        return cached;
    }
    const response = await handler();
    if (response.status === 200) {
        const cacheable = new Response(response.body, response);
        cacheable.headers.set('Cache-Control', `public, max-age=${ttlSeconds}`);
        ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));
        return cacheable;
    }
    return response;
}

function computeOverallStatus(services) {
    const statuses = services.map((service) => service.status);
    if (statuses.includes('outage')) {
        return 'outage';
    }
    if (statuses.includes('degraded')) {
        return 'degraded';
    }
    if (statuses.includes('maintenance')) {
        return 'maintenance';
    }
    if (statuses.every((status) => status === 'operational')) {
        return 'operational';
    }
    return 'unknown';
}

function buildServiceSummary(service) {
    return {
        id: service.id,
        name: service.name,
        category: service.category,
        description: service.description,
        status: service.current_status,
        maintenance: Boolean(service.maintenance),
        maintenanceMessage: service.maintenance_message || null,
        responseTime: service.last_response_time,
        httpStatus: service.last_http_status,
        lastChecked: service.last_checked_at,
        uptime24h: service.uptime_24h,
        uptime7d: service.uptime_7d,
        uptime30d: service.uptime_30d
    };
}

function averageUptime(values) {
    const valid = values.filter((v) => v !== null && v !== undefined);
    if (valid.length === 0) {
        return null;
    }
    const sum = valid.reduce((acc, v) => acc + v, 0);
    return Math.round((sum / valid.length) * 100) / 100;
}

async function handleStatusAll(db, origin) {
    const services = await getAllServices(db);
    const summaries = services.map((service) => buildServiceSummary(service));
    const overall = computeOverallStatus(summaries);
    return jsonResponse(
        {
            overall,
            updatedAt: nowUnix(),
            services: summaries,
            uptimeOverall: {
                '24h': averageUptime(summaries.map((s) => s.uptime24h)),
                '7d': averageUptime(summaries.map((s) => s.uptime7d)),
                '30d': averageUptime(summaries.map((s) => s.uptime30d))
            }
        },
        200,
        origin
    );
}

async function handleStatusOne(db, id, origin) {
    const service = await getServiceById(db, id);
    if (!service) {
        return jsonResponse({ error: 'not_found' }, 404, origin);
    }
    const summary = buildServiceSummary(service);
    const now = nowUnix();
    const incidents = await getIncidentsForService(db, id, 20);
    const bars24h = await getUptimeBuckets(db, id, now - 24 * 3600, 48);
    return jsonResponse(
        {
            ...summary,
            uptime: {
                '24h': summary.uptime24h,
                '7d': summary.uptime7d,
                '30d': summary.uptime30d
            },
            bars24h,
            incidents
        },
        200,
        origin
    );
}

async function handleIncidents(db, origin) {
    const incidents = await getIncidents(db, 100);
    return jsonResponse({ incidents }, 200, origin);
}

async function handleUptime(db, id, period, origin) {
    const service = await getServiceById(db, id);
    if (!service) {
        return jsonResponse({ error: 'not_found' }, 404, origin);
    }
    const cachedField = { '24h': 'uptime_24h', '7d': 'uptime_7d', '30d': 'uptime_30d' }[period];
    if (!cachedField) {
        return jsonResponse({ error: 'invalid_period' }, 400, origin);
    }
    return jsonResponse({ id, period, uptime: service[cachedField] }, 200, origin);
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const origin = env.ALLOWED_ORIGIN || '*';

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': origin,
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            });
        }

        try {
            if (url.pathname === '/api/status' && request.method === 'GET') {
                return await withEdgeCache(request, ctx, 10, () => handleStatusAll(env.DB, origin));
            }

            const statusMatch = url.pathname.match(/^\/api\/status\/([a-zA-Z0-9_-]+)$/);
            if (statusMatch && request.method === 'GET') {
                return await withEdgeCache(request, ctx, 10, () => handleStatusOne(env.DB, statusMatch[1], origin));
            }

            if (url.pathname === '/api/incidents' && request.method === 'GET') {
                return await withEdgeCache(request, ctx, 15, () => handleIncidents(env.DB, origin));
            }

            const uptimeMatch = url.pathname.match(/^\/api\/uptime\/([a-zA-Z0-9_-]+)$/);
            if (uptimeMatch && request.method === 'GET') {
                const period = url.searchParams.get('period') || '24h';
                return await withEdgeCache(request, ctx, 15, () => handleUptime(env.DB, uptimeMatch[1], period, origin));
            }

            return jsonResponse({ error: 'not_found' }, 404, origin);
        } catch (error) {
            console.log('Request error', error.message);
            return jsonResponse({ error: 'internal_error' }, 500, origin);
        }
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil(runMonitoringCycle(env));
    }
};

async function runMonitoringCycle(env) {
    const db = env.DB;
    const timeoutMs = Number(env.CHECK_TIMEOUT_MS || 10000);
    const services = await getEnabledServices(db);

    for (const service of services) {
        try {
            await processService(db, env, service, timeoutMs);
        } catch (error) {
            console.log('Monitoring error for', service.id, error.message);
        }
    }

    const retentionDays = Number(env.DATA_RETENTION_DAYS || 60);
    const cutoff = nowUnix() - retentionDays * 24 * 3600;
    const deleted = await deleteOldChecks(db, cutoff);
    if (deleted > 0) {
        console.log('Deleted old checks', deleted);
    }
}

const STATS_7D_30D_INTERVAL_SECONDS = 3600;

async function processService(db, env, service, timeoutMs) {
    const { httpStatus, responseTime, rawStatus } = await checkService(service, timeoutMs);
    const checkedAt = nowUnix();

    const { finalStatus, consecutiveFailures, consecutiveSuccesses } = resolveServiceState(
        service,
        rawStatus
    );

    await insertCheck(db, {
        serviceId: service.id,
        status: finalStatus,
        responseTime,
        httpStatus,
        checkedAt
    });

    const uptime24h = await computeUptime(db, service.id, checkedAt - 24 * 3600);

    const shouldRefreshLongWindow =
        !service.stats_updated_at || checkedAt - service.stats_updated_at >= STATS_7D_30D_INTERVAL_SECONDS;

    const updateFields = {
        current_status: finalStatus,
        consecutive_failures: consecutiveFailures,
        consecutive_successes: consecutiveSuccesses,
        last_response_time: responseTime,
        last_http_status: httpStatus,
        last_checked_at: checkedAt,
        uptime_24h: uptime24h
    };

    if (shouldRefreshLongWindow) {
        updateFields.uptime_7d = await computeUptime(db, service.id, checkedAt - 7 * 24 * 3600);
        updateFields.uptime_30d = await computeUptime(db, service.id, checkedAt - 30 * 24 * 3600);
        updateFields.stats_updated_at = checkedAt;
    }

    await updateServiceRuntimeState(db, service.id, updateFields);

    console.log(service.id, 'raw:', rawStatus, 'final:', finalStatus, 'responseTime:', responseTime);

    await handleIncidentTransition(db, env, service, finalStatus, checkedAt);
}

async function handleIncidentTransition(db, env, service, finalStatus, checkedAt) {
    const isFailureStatus = finalStatus === 'outage';
    const openIncident = await getOpenIncident(db, service.id);

    if (isFailureStatus && !openIncident) {
        const incidentId = await createIncident(db, {
            serviceId: service.id,
            title: `${service.name} is unavailable`,
            description: 'Automatically detected by monitoring.',
            status: 'investigating',
            startedAt: checkedAt
        });
        await sendOutageNotification(env.DISCORD_WEBHOOK_URL, service, checkedAt);
        await markIncidentNotified(db, incidentId, 'notified_start');
        return;
    }

    if (!isFailureStatus && finalStatus === 'operational' && openIncident) {
        await resolveIncident(db, openIncident.id, checkedAt);
        if (!openIncident.notified_resolve) {
            await sendRecoveryNotification(env.DISCORD_WEBHOOK_URL, service, openIncident.started_at, checkedAt);
            await markIncidentNotified(db, openIncident.id, 'notified_resolve');
        }
    }
}
