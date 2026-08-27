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

app.post('/api/bookings', async (req, res) => {
    try {
        // فحص حالة الاتصال الفعلية لحظة الإرسال
        if (mongoose.connection.readyState !== 1) {
            throw new Error(`انقطع الاتصال بالسحابة بسبب حظر الشبكة المحلية. حالة الاتصال الحالية: ${mongoose.connection.readyState}`);
        }
        
        const newBooking = new Booking(req.body);
        const savedBooking = await newBooking.save({ maxTimeMS: 5000 }); // تقليل وقت الانتظار
        
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

// عدم تشغيل الخادم إلا بعد التأكد التام من استقرار الاتصال بقاعدة البيانات
mongoose.connect(dbURI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
.then(() => {
    console.log('✅ تم الاتصال بقاعدة بيانات سحابة الرمال الدولية بنجاح وباستقرار تام!');
    const PORT = 5000;
    app.listen(PORT, () => console.log(`🚀 الخادم جاهز الآن لاستقبال طلبات الحجز على المنفذ ${PORT}`));
})
.catch(err => {
    console.error('❌ فشل الاتصال الأولي بالسحابة:', err.message);
});