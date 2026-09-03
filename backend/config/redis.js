const Redis = require('ioredis');
const dotenv = require('dotenv');

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const KIOSK_CHANNEL = 'kiosk:events';

// Create publisher and subscriber clients
const redisPublisher = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
        const delay = Math.min(times * 100, 3000);
        return delay;
    },
    lazyConnect: false,
});

const redisSubscriber = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
        const delay = Math.min(times * 100, 3000);
        return delay;
    },
    lazyConnect: false,
});

redisPublisher.on('connect', () => {
    console.log('[Redis] Publisher connected successfully');
});

redisSubscriber.on('connect', () => {
    console.log('[Redis] Subscriber connected successfully');
});

redisPublisher.on('error', (err) => {
    console.error('[Redis Publisher Error]', err.message);
});

redisSubscriber.on('error', (err) => {
    console.error('[Redis Subscriber Error]', err.message);
});

module.exports = {
    redisPublisher,
    redisSubscriber,
    KIOSK_CHANNEL,
};
