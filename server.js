const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const dbURI = "mongodb://mostafasaliha003_db_user:XEpAQOMbx2MA25KB@ac-lh0onrk-shard-00-00.vln37gw.mongodb.net:27017,ac-lh0onrk-shard-00-01.vln37gw.mongodb.net:27017,ac-lh0onrk-shard-00-02.vln37gw.mongodb.net:27017/rimalbookingdb?ssl=true&replicaSet=atlas-wm1iv8-shard-0&authSource=admin&retryWrites=true&w=majority";

const bookingSchema = new mongoose.Schema({
    hotelName: String,
    customerName: String,
    email: String,
    phone: String,
    companions: String,
    paymentMethod: String,
    bookingReference: { type: String, default: () => 'RIMAL-' + Math.floor(100000 + Math.random() * 900000) },
    createdAt: { type: Date, default: Date.now }
});

const Booking = mongoose.model('Booking', bookingSchema);

// استقبال وحفظ الحجوزات الجديدة
app.post('/api/bookings', async (req, res) => {
    try {
        const newBooking = new Booking(req.body);
        const savedBooking = await newBooking.save();
        res.status(201).json({
            success: true,
            message: 'تم حفظ الحجز بنجاح في سحابة شركة الرمال الدولية',
            bookingReference: savedBooking.bookingReference
        });
    } catch (error) {
        console.error('❌ فشل حفظ الحجز:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// استعراض جميع الحجوزات الواردة للوحة التحكم
app.get('/api/bookings', async (req, res) => {
    try {
        const bookings = await Booking.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: bookings });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// حذف حجز محدد من لوحة التحكم
app.delete('/api/bookings/:id', async (req, res) => {
    try {
        await Booking.findByIdAndDelete(req.params.id);
        res.status(200).json({ success: true, message: 'تم حذف الحجز بنجاح' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// الاتصال بقاعدة البيانات وتشغيل الخادم
mongoose.connect(dbURI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4 
})
.then(() => {
    console.log('✅ تم الاتصال بقاعدة بيانات سحابة الرمال الدولية بنجاح وباستقرار تام!');
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`🚀 الخادم جاهز الآن لاستقبال طلبات الحجز على المنفذ ${PORT}`));
})
.catch(err => {
    console.error('❌ فشل الاتصال الأولي بالسحابة:', err.message);
});