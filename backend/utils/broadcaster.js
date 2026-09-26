const { redisPublisher, KIOSK_CHANNEL } = require('../config/redis');

let localBroadcaster = null;

const setLocalBroadcaster = (fn) => {
    localBroadcaster = fn;
};

// Function to publish event to Redis (which distributes to all SSE subscribers)
const broadcastEvent = async (type, payload) => {
    const message = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
    try {
        if (redisPublisher && redisPublisher.status === 'ready') {
            await redisPublisher.publish(KIOSK_CHANNEL, message);
        } else if (localBroadcaster) {
            localBroadcaster(message);
        } else {
            console.log(`[Broadcaster fallback] ${type}`, payload);
        }
    } catch (err) {
        console.error(`[Broadcaster Error ${type}]:`, err.message);
        if (localBroadcaster) {
            localBroadcaster(message);
        }
    }
};

module.exports = {
    broadcastEvent,
    setLocalBroadcaster,
};

