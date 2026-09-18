const fs = require('fs');
const path = require('path');

// التأكد من وجود مجلد لحفظ السجلات في السيرفر
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// الدالة الرئيسية لكتابة الأحداث
function writeLog(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    // تحويل البيانات الإضافية إلى نص مقروء
    const dataString = Object.keys(data).length ? ` | Data: ${JSON.stringify(data)}` : '';
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}${dataString}\n`;
    
    const filePath = path.join(logsDir, 'system.log');
    
    // إضافة الحدث للملف دون مسح الأحداث القديمة
    fs.appendFile(filePath, logEntry, (err) => {
        if (err) console.error("❌ Failed to write to log file:", err);
    });
}

module.exports = {
    info: (message, data) => {
        console.log(`ℹ️ ${message}`); // طباعة على الشاشة
        writeLog('info', message, data); // وحفظ في الملف
    },
    error: (message, data) => {
        console.error(`❌ ${message}`);
        writeLog('error', message, data);
    },
    warn: (message, data) => {
        console.warn(`⚠️ ${message}`);
        writeLog('warn', message, data);
    }
};