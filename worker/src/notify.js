function formatJstTimestamp(unixSeconds) {
    const date = new Date(unixSeconds * 1000);
    const formatter = new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(date).reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
    }, {});
    return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute} JST`;
}

function formatDuration(seconds) {
    if (seconds < 60) {
        return `${seconds} seconds`;
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${minutes} minutes`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}

export async function sendOutageNotification(webhookUrl, service, startedAt) {
    if (!webhookUrl) {
        return;
    }
    const payload = {
        embeds: [
            {
                title: '🔴 Service Outage',
                description: `**${service.name}**\n\nThe service is currently unavailable.`,
                color: 15548997,
                fields: [
                    {
                        name: 'Started',
                        value: formatJstTimestamp(startedAt)
                    }
                ]
            }
        ]
    };
    await postToDiscord(webhookUrl, payload);
}

export async function sendRecoveryNotification(webhookUrl, service, startedAt, resolvedAt) {
    if (!webhookUrl) {
        return;
    }
    const durationSeconds = resolvedAt - startedAt;
    const payload = {
        embeds: [
            {
                title: '🟢 Service Recovered',
                description: `**${service.name}**\n\nThe service is operational again.`,
                color: 5763719,
                fields: [
                    {
                        name: 'Duration',
                        value: formatDuration(durationSeconds)
                    }
                ]
            }
        ]
    };
    await postToDiscord(webhookUrl, payload);
}

async function postToDiscord(webhookUrl, payload) {
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            console.log('Discord webhook failed', response.status);
        }
    } catch (error) {
        console.log('Discord webhook error', error.message);
    }
}
