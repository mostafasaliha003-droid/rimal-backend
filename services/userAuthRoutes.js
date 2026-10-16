const crypto = require('node:crypto');
const express = require('express');

function emailAddress(value) {
    if (typeof value !== 'string' || value.length > 254) return null;
    const normalized = value.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function publicUser(user) {
    return {
        name: user.name,
        email: user.email,
        points: Number.isSafeInteger(user.points) && user.points >= 0 ? user.points : 0,
        ...(typeof user.phone === 'string' && user.phone ? { phone: user.phone } : {}),
        savedCards: Array.isArray(user.savedCards) ? user.savedCards.map(card => ({
            ...(card?._id ? { _id: String(card._id) } : {}),
            cardHolder: typeof card?.cardHolder === 'string' ? card.cardHolder : '',
            maskedNumber: typeof card?.maskedNumber === 'string' ? card.maskedNumber : ''
        })) : []
    };
}

function publicBooking(booking) {
    const fields = [
        'bookingReference', 'supplierReference', 'hotelConfirmationNumber', 'supplierStatus',
        'provider', 'customerName', 'hotelName', 'roomType', 'boardType', 'price', 'priceCurrency',
        'checkInDate', 'checkOutDate', 'paymentMethod', 'supplierPaymentType', 'status',
        'cancellationPolicy', 'confirmedAt', 'freeCancelDeadline', 'refundType', 'createdAt'
    ];
    return Object.fromEntries(fields.filter(field => booking?.[field] !== undefined)
        .map(field => [field, booking[field]]));
}

function createUserAuthRouter({
    UserModel,
    BookingModel,
    sessions,
    auth,
    verificationCodes = new Map(),
    sendVerificationEmail,
    hashPassword,
    comparePassword,
    now = () => Date.now(),
    randomCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'),
    authLimiter = (_req, _res, next) => next()
} = {}) {
    if (!UserModel || typeof UserModel.findOne !== 'function' || typeof UserModel.prototype?.save !== 'function'
        || !BookingModel || typeof BookingModel.find !== 'function'
        || !sessions || typeof sessions.create !== 'function' || !auth || typeof auth.requireRole !== 'function'
        || !(verificationCodes instanceof Map) || typeof sendVerificationEmail !== 'function'
        || typeof hashPassword !== 'function' || typeof comparePassword !== 'function'
        || typeof now !== 'function' || typeof randomCode !== 'function') {
        throw new TypeError('user_auth_route_dependencies_invalid');
    }

    const router = express.Router();

    router.post('/register-send-code', authLimiter, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
        const email = emailAddress(body.email);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
        if (!email) return res.status(400).json({ success: false, error: 'INVALID_EMAIL' });
        if (name.length < 2 || name.length > 160) return res.status(400).json({ success: false, error: 'INVALID_NAME' });
        if (password.length < 10 || password.length > 256) {
            return res.status(400).json({ success: false, error: 'INVALID_PASSWORD' });
        }
        if (phone.length > 40 || /[\u0000-\u001f\u007f]/.test(phone)) {
            return res.status(400).json({ success: false, error: 'INVALID_PHONE' });
        }

        try {
            if (await UserModel.findOne({ email }).select('_id').lean()) {
                return res.status(409).json({ success: false, error: 'EMAIL_ALREADY_REGISTERED' });
            }
            const code = randomCode();
            if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw fail('verification_unavailable', 503);
            const pending = {
                name,
                email,
                phone,
                password: await hashPassword(password),
                codeHash: crypto.createHash('sha256').update(code).digest('hex'),
                attempts: 0,
                expires: Number(now()) + 10 * 60 * 1000
            };
            verificationCodes.set(email, pending);
            let sent = false;
            try { sent = await sendVerificationEmail(email, code); } catch { sent = false; }
            if (!sent) {
                if (verificationCodes.get(email) === pending) verificationCodes.delete(email);
                return res.status(503).json({ success: false, error: 'VERIFICATION_EMAIL_UNAVAILABLE' });
            }
            return res.status(200).json({ success: true, message: 'verification_code_sent' });
        } catch (error) {
            return res.status(503).json({ success: false, error: 'registration_unavailable' });
        }
    });

    router.post('/verify-and-register', authLimiter, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
        const email = emailAddress(body.email);
        const code = typeof body.code === 'string' ? body.code : '';
        if (!email || !/^\d{6}$/.test(code)) {
            return res.status(400).json({ success: false, error: 'INVALID_VERIFICATION_CODE' });
        }
        const pending = verificationCodes.get(email);
        if (!pending) return res.status(400).json({ success: false, error: 'INVALID_VERIFICATION_CODE' });
        if (pending.expires <= Number(now()) || pending.attempts >= 5) {
            verificationCodes.delete(email);
            return res.status(400).json({ success: false, error: 'INVALID_VERIFICATION_CODE' });
        }
        pending.attempts += 1;
        const supplied = crypto.createHash('sha256').update(code).digest();
        const expected = Buffer.from(pending.codeHash, 'hex');
        if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
            if (pending.attempts >= 5) verificationCodes.delete(email);
            return res.status(400).json({ success: false, error: 'INVALID_VERIFICATION_CODE' });
        }

        try {
            if (verificationCodes.get(email) !== pending) {
                return res.status(409).json({ success: false, error: 'registration_conflict' });
            }
            const user = new UserModel({
                name: pending.name,
                email: pending.email,
                password: pending.password,
                phone: pending.phone,
                points: 500
            });
            await user.save();
            const session = await sessions.create({ subject: String(user._id), email: user.email, role: 'user' });
            if (verificationCodes.get(email) === pending) verificationCodes.delete(email);
            return res.status(201).json({ success: true, user: publicUser(user), access_token: session.token });
        } catch (error) {
            if (error?.code === 11000) {
                verificationCodes.delete(email);
                return res.status(409).json({ success: false, error: 'EMAIL_ALREADY_REGISTERED' });
            }
            return res.status(503).json({ success: false, error: 'registration_unavailable' });
        }
    });

    router.post('/login', authLimiter, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
        const email = emailAddress(body.email);
        const password = typeof body.password === 'string' ? body.password : '';
        if (!email || !password || password.length > 256) {
            return res.status(401).json({ success: false, error: 'invalid_credentials' });
        }
        try {
            const user = await UserModel.findOne({ email }).select('+password').exec();
            const storedPassword = typeof user?.password === 'string' && /^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(user.password)
                ? user.password : '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid';
            const passwordMatches = await comparePassword(password, storedPassword);
            if (!user || !passwordMatches) return res.status(401).json({ success: false, error: 'invalid_credentials' });
            const session = await sessions.create({ subject: String(user._id), email: user.email, role: 'user' });
            return res.status(200).json({ success: true, user: publicUser(user), access_token: session.token });
        } catch {
            return res.status(503).json({ success: false, error: 'authentication_unavailable' });
        }
    });

    router.get('/session', auth.requireRole('user'), async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const user = await UserModel.findOne({ _id: req.auth.subject, email: req.auth.email }).lean();
            if (!user) return res.status(401).json({ success: false, error: 'unauthorized' });
            return res.status(200).json({ success: true, user: publicUser(user) });
        } catch {
            return res.status(503).json({ success: false, error: 'authentication_unavailable' });
        }
    });

    router.post('/logout', auth.requireRole('user'), async (req, res) => {
        try {
            await sessions.revoke(req.authToken);
            return res.status(200).json({ success: true });
        } catch {
            return res.status(503).json({ success: false, error: 'authentication_unavailable' });
        }
    });

    return router;
}

function createUserProfileRouter({ UserModel, BookingModel, auth } = {}) {
    if (!UserModel || typeof UserModel.findOne !== 'function'
        || !BookingModel || typeof BookingModel.find !== 'function'
        || !auth || typeof auth.requireRole !== 'function') {
        throw new TypeError('user_profile_route_dependencies_invalid');
    }
    const router = express.Router();
    router.get('/profile', auth.requireRole('user'), async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            const user = await UserModel.findOne({ _id: req.auth.subject, email: req.auth.email }).lean();
            if (!user) return res.status(401).json({ success: false, error: 'unauthorized' });
            const bookings = await BookingModel.find({ ownerSubject: req.auth.subject, realm: req.auth.realm }).sort({ createdAt: -1 })
                .select('bookingReference supplierReference hotelConfirmationNumber supplierStatus provider customerName hotelName roomType boardType price priceCurrency checkInDate checkOutDate paymentMethod supplierPaymentType status cancellationPolicy confirmedAt freeCancelDeadline refundType createdAt')
                .lean();
            return res.status(200).json({
                success: true,
                profile: publicUser(user),
                bookings: bookings.map(publicBooking)
            });
        } catch {
            return res.status(503).json({ success: false, error: 'profile_unavailable' });
        }
    });
    return router;
}

module.exports = { emailAddress, publicUser, publicBooking, createUserAuthRouter, createUserProfileRouter };