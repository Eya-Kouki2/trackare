const express = require('express');
const { redisPublisher, redisSubscriber, KIOSK_CHANNEL } = require('../config/redis');
const { setLocalBroadcaster } = require('../utils/broadcaster');
const router = express.Router();

// Store connected SSE clients local to this Node instance
let clients = [];

// Helper: Broadcast an SSE event string directly to local clients
const broadcastLocal = (dataString) => {
    clients.forEach((client) => {
        try {
            client.write(`data: ${dataString}\n\n`);
        } catch (err) {
            console.error('[SSE Error sending to client]', err.message);
        }
    });
};

setLocalBroadcaster(broadcastLocal);

// ── Redis Subscriber: Listen for messages from ANY backend instance ──
redisSubscriber.subscribe(KIOSK_CHANNEL, (err, count) => {
    if (err) {
        console.error(`[Redis] Failed to subscribe to ${KIOSK_CHANNEL}:`, err.message);
    } else {
        console.log(`[Redis] Subscribed to ${KIOSK_CHANNEL} (active channels: ${count})`);
    }
});

redisSubscriber.on('message', (channel, message) => {
    if (channel === KIOSK_CHANNEL) {
        broadcastLocal(message);
    }
});

// 1. SSE Stream Endpoint for React Frontend
router.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial connection success message
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED' })}\n\n`);

    // Add this client to our local instance list
    clients.push(res);

    // Remove client when they disconnect
    req.on('close', () => {
        clients = clients.filter((client) => client !== res);
    });
});

// 2. POST Endpoint for Python triage_kiosk.py (final result)
router.post('/', async (req, res) => {
    const payload = req.body;
    const message = JSON.stringify({ type: 'KIOSK_RESULT', payload });

    try {
        // Publish to Redis so all PM2 instances broadcast to their clients
        await redisPublisher.publish(KIOSK_CHANNEL, message);
    } catch (err) {
        console.error('[Redis Publish Error /api/result]:', err.message);
        // Fallback to local broadcast if Redis is unreachable
        broadcastLocal(message);
    }

    res.status(200).json({ success: true, message: 'Result broadcasted successfully' });
});

// 3. POST /progress — receives live question/answer updates from triage_kiosk.py
router.post('/progress', async (req, res) => {
    const payload = req.body; // { questionIndex, symptom, answer, questionLabel }
    const message = JSON.stringify({ type: 'KIOSK_PROGRESS', payload });

    try {
        // Publish to Redis so all PM2 instances broadcast to their clients
        await redisPublisher.publish(KIOSK_CHANNEL, message);
    } catch (err) {
        console.error('[Redis Publish Error /api/result/progress]:', err.message);
        // Fallback to local broadcast if Redis is unreachable
        broadcastLocal(message);
    }

    res.status(200).json({ success: true });
});

module.exports = router;
