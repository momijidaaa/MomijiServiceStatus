export function classifyRawStatus(httpStatus, responseTime, thresholds) {
    const degradedMs = thresholds.degradedMs;
    const outageMs = thresholds.outageMs;

    if (httpStatus === null) {
        return 'outage';
    }
    if (httpStatus >= 200 && httpStatus <= 299) {
        if (responseTime >= outageMs) {
            return 'outage';
        }
        if (responseTime >= degradedMs) {
            return 'degraded';
        }
        return 'operational';
    }
    if (httpStatus >= 300 && httpStatus <= 399) {
        return 'degraded';
    }
    if (httpStatus >= 400 && httpStatus <= 599) {
        return 'outage';
    }
    return 'unknown';
}

export async function checkService(service, timeoutMs) {
    if (!service.url) {
        return {
            httpStatus: null,
            responseTime: null,
            rawStatus: 'unknown'
        };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();

    try {
        const response = await fetch(service.url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'MomijiStatus-Monitor/1.0'
            }
        });
        const end = Date.now();
        clearTimeout(timer);
        const responseTime = end - start;
        const httpStatus = response.status;
        const rawStatus = classifyRawStatus(httpStatus, responseTime, {
            degradedMs: service.threshold_degraded_ms,
            outageMs: service.threshold_outage_ms
        });
        return { httpStatus, responseTime, rawStatus };
    } catch (error) {
        clearTimeout(timer);
        const end = Date.now();
        const responseTime = end - start;
        return { httpStatus: null, responseTime, rawStatus: 'outage' };
    }
}

export function resolveServiceState(service, rawStatus) {
    if (service.maintenance) {
        return {
            finalStatus: 'maintenance',
            consecutiveFailures: 0,
            consecutiveSuccesses: 0
        };
    }

    let failures = service.consecutive_failures || 0;
    let successes = service.consecutive_successes || 0;
    let finalStatus = service.current_status || 'unknown';

    if (rawStatus === 'operational') {
        successes += 1;
        failures = 0;
        if (successes >= 2 || finalStatus === 'operational' || finalStatus === 'unknown') {
            finalStatus = 'operational';
        }
    } else {
        failures += 1;
        successes = 0;
        if (failures === 1) {
            if (finalStatus === 'unknown') {
                finalStatus = rawStatus;
            }
        } else if (failures === 2) {
            finalStatus = 'degraded';
        } else {
            finalStatus = 'outage';
        }
    }

    return {
        finalStatus,
        consecutiveFailures: failures,
        consecutiveSuccesses: successes
    };
}
