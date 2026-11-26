const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');

/*
 * Crash reports from the Mkhadda app, kept on our own server (no third-party tracker). A report is
 * scrubbed before it is stored: e-mail addresses, long numbers (phones, cards, references) and
 * tokens are replaced, so nothing identifies a guest. Reports with the same fingerprint and app
 * version are counted, not duplicated, and expire after 30 days.
 */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const scrub = value => String(value ?? '')
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b[a-f\d]{24,}\b/gi, '[token]')
    .replace(/\b[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\b/gi, '[id]')
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[number]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const text = (value, limit) => typeof value === 'string' ? scrub(value).slice(0, limit) : '';

function createAppErrorRouters({ AppError = require('../models/AppError'), requireAdmin, now = Date.now,
    limiter = rateLimit({ windowMs: 60000, max: 20, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'rate_limited' } }) } = {}) {
    const app = express.Router(), desk = express.Router();
    app.post('/errors', limiter, express.json({ limit: '16kb' }), async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
        const message = text(body.message, 500);
        if (!message) return res.status(400).json({ success: false, error: 'invalid_report' });
        const stack = text(body.stack, 4000);
        const version = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(body.version || '') ? body.version : 'unknown';
        const platform = ['android', 'ios', 'web'].includes(body.platform) ? body.platform : 'unknown';
        const route = typeof body.route === 'string' && /^\/[A-Za-z0-9/_\-[\]]{0,120}$/.test(body.route) ? body.route.replace(/\/[A-Za-z0-9_-]{12,}/g, '/[id]') : '';
        const fingerprint = crypto.createHash('sha256').update([message.replace(/\d+/g, '#'), stack.split('\n').slice(0, 3).join('\n')].join('|')).digest('hex').slice(0, 32);
        const at = new Date(now());
        try {
            await AppError.updateOne({ _id: `${fingerprint}:${version}` }, {
                $setOnInsert: { fingerprint, version, platform, message, stack, firstSeen: at },
                $set: { lastSeen: at, route, fatal: body.fatal === true, expiresAt: new Date(at.getTime() + TTL_MS) },
                $inc: { count: 1 }
            }, { upsert: true });
            return res.status(202).json({ success: true });
        } catch {
            return res.status(503).json({ success: false, error: 'report_unavailable' });
        }
    });
    desk.get('/errors', requireAdmin, async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        try {
            const rows = await AppError.find({}).sort({ lastSeen: -1 }).limit(100).lean();
            return res.json({ success: true, errors: rows.map(row => ({ id: row._id, version: row.version, platform: row.platform, route: row.route || '',
                fatal: row.fatal === true, message: row.message, stack: row.stack || '', count: row.count || 0, firstSeen: row.firstSeen, lastSeen: row.lastSeen })) });
        } catch {
            return res.status(503).json({ success: false, error: 'desk_unavailable' });
        }
    });
    return { app, desk };
}

module.exports = { createAppErrorRouters, scrub };
