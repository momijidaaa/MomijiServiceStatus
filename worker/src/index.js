import { checkService, resolveServiceState } from './monitor.js';
import {
    getEnabledServices,
    getAllServices,
    getServiceById,
    updateServiceRuntimeState,
    insertCheck,
    getLatestCheck,
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

async function buildServiceSummary(db, service) {
    const latestCheck = await getLatestCheck(db, service.id);
    const now = nowUnix();
    const uptime24h = await computeUptime(db, service.id, now - 24 * 3600);
    return {
        id: service.id,
        name: service.name,
        category: service.category,
        description: service.description,
        status: service.current_status,
        maintenance: Boolean(service.maintenance),
        maintenanceMessage: service.maintenance_message || null,
        responseTime: latestCheck ? latestCheck.response_time : null,
        httpStatus: latestCheck ? latestCheck.http_status : null,
        lastChecked: latestCheck ? latestCheck.checked_at : null,
        uptime24h
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
    const summaries = await Promise.all(services.map((service) => buildServiceSummary(db, service)));
    const overall = computeOverallStatus(summaries);
    const now = nowUnix();
    const uptime7dValues = await Promise.all(
        services.map((service) => computeUptime(db, service.id, now - 7 * 24 * 3600))
    );
    const uptime30dValues = await Promise.all(
        services.map((service) => computeUptime(db, service.id, now - 30 * 24 * 3600))
    );
    return jsonResponse(
        {
            overall,
            updatedAt: now,
            services: summaries,
            uptimeOverall: {
                '24h': averageUptime(summaries.map((s) => s.uptime24h)),
                '7d': averageUptime(uptime7dValues),
                '30d': averageUptime(uptime30dValues)
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
    const summary = await buildServiceSummary(db, service);
    const now = nowUnix();
    const uptime24h = await computeUptime(db, id, now - 24 * 3600);
    const uptime7d = await computeUptime(db, id, now - 7 * 24 * 3600);
    const uptime30d = await computeUptime(db, id, now - 30 * 24 * 3600);
    const incidents = await getIncidentsForService(db, id, 20);
    const bars24h = await getUptimeBuckets(db, id, now - 24 * 3600, 48);
    return jsonResponse(
        {
            ...summary,
            uptime: {
                '24h': uptime24h,
                '7d': uptime7d,
                '30d': uptime30d
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
    const periodSeconds = { '24h': 24 * 3600, '7d': 7 * 24 * 3600, '30d': 30 * 24 * 3600 };
    const seconds = periodSeconds[period];
    if (!seconds) {
        return jsonResponse({ error: 'invalid_period' }, 400, origin);
    }
    const now = nowUnix();
    const uptime = await computeUptime(db, id, now - seconds);
    return jsonResponse({ id, period, uptime }, 200, origin);
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
                return await handleStatusAll(env.DB, origin);
            }

            const statusMatch = url.pathname.match(/^\/api\/status\/([a-zA-Z0-9_-]+)$/);
            if (statusMatch && request.method === 'GET') {
                return await handleStatusOne(env.DB, statusMatch[1], origin);
            }

            if (url.pathname === '/api/incidents' && request.method === 'GET') {
                return await handleIncidents(env.DB, origin);
            }

            const uptimeMatch = url.pathname.match(/^\/api\/uptime\/([a-zA-Z0-9_-]+)$/);
            if (uptimeMatch && request.method === 'GET') {
                const period = url.searchParams.get('period') || '24h';
                return await handleUptime(env.DB, uptimeMatch[1], period, origin);
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

    await updateServiceRuntimeState(db, service.id, {
        current_status: finalStatus,
        consecutive_failures: consecutiveFailures,
        consecutive_successes: consecutiveSuccesses
    });

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
