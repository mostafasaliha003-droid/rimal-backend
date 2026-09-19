require('dotenv').config();
const mongoose = require('mongoose');

// ==========================================
// 1. تعريف نموذج الفندق في قاعدة البيانات (Schema)
// ==========================================
const hotelSchema = new mongoose.Schema({
    hotelId: { type: String, required: true, unique: true }, // كود الفندق من Tripstick
    name: String,
    address: String,
    city: String,
    countryCode: String,
    stars: String,
    latitude: String,
    longitude: String,
    image: String,
    provider: { type: String, default: 'dubailink' }
});

// تجنب تعريف الموديل مرتين إذا كان موجوداً
const Hotel = mongoose.models.Hotel || mongoose.model('Hotel', hotelSchema);

// ==========================================
// 2. إعدادات الاتصال والبيانات
// ==========================================
const CONTENT_URL = process.env.DUBAILINK_CONTENT_URL || 'https://content-api.tripstickconnect.com';
const USER = process.env.DUBAILINK_USER;
const PASS = process.env.DUBAILINK_PASS;
const MONGO_URI = process.env.MONGO_URI;

// ==========================================
// 3. الدالة الرئيسية للمزامنة
// ==========================================
const syncDubaiHotels = async () => {
    try {
        if (!MONGO_URI) throw new Error("MONGO_URI is missing in environment variables!");

        console.log('🔗 Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB successfully.');

        // تشفير بيانات الدخول بنظام Base64
        const auth = Buffer.from(`${USER}:${PASS}`).toString('base64');
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${auth}`
        };

        // كود وجهة دبي كما هو مذكور في توثيق Tripstick
        const payload = {
            destination: 678516887551164416,
            limit: 500 // جلب 500 فندق كدفعة أولى
        };

        console.log(`🌐 Fetching hotels from Content API: ${CONTENT_URL}/hotels`);
        
        // تجاوز التدقيق المحلي على شهادات الأمان (كما فعلنا في Render)
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

        const response = await fetch(`${CONTENT_URL}/hotels`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || `API Error ${response.status}`);
        }

        const hotels = data.hotels || [];
        console.log(`📦 Received ${hotels.length} hotels for Dubai. Saving to database...`);

        let savedCount = 0;
        
        // 🔄 إدخال أو تحديث البيانات في MongoDB (Upsert)
        for (const h of hotels) {
            await Hotel.findOneAndUpdate(
                { hotelId: h.code.toString() }, // البحث بواسطة كود الفندق
                {
                    name: h.hotel_name,
                    address: h.address,
                    city: h.city_name,
                    countryCode: h.country_code,
                    stars: h.star_rating,
                    latitude: h.latitude,
                    longitude: h.longitude,
                    image: h.image,
                    provider: 'dubailink'
                },
                { upsert: true, new: true } // تحديث إذا وجد، أو إنشاء جديد
            );
            savedCount++;
        }

        console.log(`🎉 Success! Synchronized ${savedCount} hotels in Dubai.`);
        
        // إغلاق الاتصال بعد الانتهاء
        await mongoose.connection.close();
        process.exit(0);

    } catch (error) {
        console.error('❌ Sync Error:', error.message);
        process.exit(1);
    }
};

// تشغيل السكربت
syncDubaiHotels();
