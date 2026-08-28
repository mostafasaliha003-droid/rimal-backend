const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const path = require('path');

const stripe = require('stripe')('sk_test_51U9NrgF2L2Zp7ynOmT46T8dRcAwW8gScf5OtOU23wE4NZSAVF4ZUlspuB1WI62aqMzblavLr6zHfW3HaDAx2hhZx00IC95noxG');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

// رابط الاتصال بقاعدة البيانات مع تصحيح الرمز في كلمة المرور
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://mostafasaliha003_db_user:Rimal2026%40@rimalbookingdb.vln37gw.mongodb.net/rimal_db?retryWrites=true&w=majority&appName=RimalBookingDB';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ تم الاتصال بنجاح بقاعدة بيانات MongoDB Atlas الدائمة'))
  .catch(err => console.error('❌ خطأ في الاتصال بـ MongoDB:', err));

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    phone: String,
    points: { type: Number, default: 500 },
    createdAt: { type: Date, default: Date.now }
});

const hotelSchema = new mongoose.Schema({
    name: { type: String, required: true },
    city: { type: String, required: true, index: true },
    address: String,
    phone: String,
    priceAED: { type: Number, required: true, index: true },
    starRating: { type: Number, default: 4 },
    basePoints: { type: Number, default: 50 },
    img: String,
    policyType: { type: String, enum: ['full', 'penalty', 'none'], default: 'full' },
    policyText: String,
    funnyPolicy: String
});

const bookingSchema = new mongoose.Schema({
    bookingReference: { type: String, required: true, unique: true },
    email: { type: String, required: true, index: true },
    customerName: String,
    hotelName: String,
    price: Number,
    paymentMethod: String,
    policyType: String,
    policyText: String,
    paymentIntentId: String,
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Hotel = mongoose.model('Hotel', hotelSchema);
const Booking = mongoose.model('Booking', bookingSchema);

let verificationCodes = {};

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: 'management@remaltourismllc.com', pass: 'dkvnseslexedcefd' }
});

app.get('/api/hotels/advanced-search', async (req, res) => {
    try {
        let { destination, maxPrice, stars, freeCancellation } = req.query;
        let query = {};

        if (destination && destination.trim() !== '') {
            query.$or = [
                { name: { $regex: destination, $options: 'i' } },
                { city: { $regex: destination, $options: 'i' } }
            ];
        }
        if (maxPrice) {
            query.priceAED = { $lte: Number(maxPrice) };
        }
        if (stars) {
            let starsArray = Array.isArray(stars) ? stars.map(Number) : [Number(stars)];
            query.starRating = { $in: starsArray };
        }
        if (freeCancellation === 'true') {
            query.policyType = 'full';
        }

        let hotels = await Hotel.find(query).sort({ priceAED: 1 });
        
        if (hotels.length === 0 && !destination) {
            hotels = [
                { name: "فندق النخيل ديار", city: "دبي", address: "ميناء سعيد، دبي", phone: "+97145550005", priceAED: 450, starRating: 4, basePoints: 50, img: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=600&q=80", policyType: "full", policyText: "استرداد كامل للأموال 100% في حال الإلغاء." },
                { name: "فندق الرمال الملكي", city: "دبي", address: "شارع بني ياس، دبي", phone: "+97142122222", priceAED: 890, starRating: 5, basePoints: 350, img: "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=600&q=80", policyType: "penalty", policyText: "سياسة جزائية: خصم 20% عند الإلغاء." }
            ];
        }

        res.json({ success: true, count: hotels.length, hotels });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/bookings', async (req, res) => {
    try {
        let { hotelName, customerName, email, phone, paymentMethod, price, policyType, policyText } = req.body;
        email = (email || '').toLowerCase().trim();
        const bookingReference = 'RIMAL-' + Math.floor(100000 + Math.random() * 900000);
        
        const newBooking = new Booking({ bookingReference, hotelName, customerName, email, phone, paymentMethod, price, policyType, policyText });
        await newBooking.save();

        res.status(201).json({ success: true, message: 'تم التثبيت', bookingReference });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => { console.log(`🚀 السيرفر يعمل على المنفذ ${PORT} ومربوط بقاعدة بيانات MongoDB الدائمة`); });
