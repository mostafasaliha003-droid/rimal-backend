require('dotenv').config();
const mongoose = require('mongoose');

// ==========================================
// 1. تعريف نموذج الفندق في قاعدة البيانات (Schema)
// ==========================================
const hotelSchema = new mongoose.Schema({
    hotelId: { type: String, required: true, unique: true }, 
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

        const auth = Buffer.from(`${USER}:${PASS}`).toString('base64');
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${auth}`
        };

        console.log(`🌐 Fetching hotels from Content API: ${CONTENT_URL}/hotels`);
        
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

        // 🚨 التعديل 1: إرسال الطلب كنص مباشر لمنع JS من تقريب الرقم الكبير
        const payloadString = '{"destination": 678516887551164416, "limit": 500}';

        let response = await fetch(`${CONTENT_URL}/hotels`, {
            method: 'POST',
            headers: headers,
            body: payloadString
        });

        let data = await response.json();
        let hotels = data.hotels || [];

        // 🚨 التعديل 2: خطة بديلة لو كان الحساب التجريبي لا يحتوي على دبي
        if (hotels.length === 0) {
            console.log(`⚠️ No hotels found for Dubai specific code. Fetching ANY available hotels in your test account...`);
            
            response = await fetch(`${CONTENT_URL}/hotels`, {
                method: 'POST',
                headers: headers,
                body: '{"limit": 500}' // طلب بدون تحديد مدينة
            });
            
            data = await response.json();
            hotels = data.hotels || [];
        }

        if (hotels.length === 0) {
            console.log(`❌ Still 0 hotels. Your Tripstick account might be completely empty in the Content API.`);
            process.exit(0);
        }

        console.log(`📦 Received ${hotels.length} hotels. Saving to database...`);

        let savedCount = 0;
        
        for (const h of hotels) {
            // تجاهل الفنادق التي لا تملك اسم أو كود
            if (!h.code || !h.hotel_name) continue; 

            await Hotel.findOneAndUpdate(
                { hotelId: h.code.toString() }, 
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
                { upsert: true, new: true } 
            );
            savedCount++;
        }

        console.log(`🎉 Success! Synchronized ${savedCount} hotels into MongoDB.`);
        
        await mongoose.connection.close();
        process.exit(0);

    } catch (error) {
        console.error('❌ Sync Error:', error.message);
        process.exit(1);
    }
};

syncDubaiHotels();
