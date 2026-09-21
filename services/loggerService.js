// services/loggerService.js

/**
 * 🚀 خدمة السجلات السحابية المتوافقة مع Render
 * تعتمد على طباعة السجلات لتلتقطها لوحة تحكم Render تلقائياً دون استهلاك مساحة التخزين المؤقتة.
 */

const formatMessage = (level, icon, message, data) => {
    const timestamp = new Date().toISOString();
    const dataString = Object.keys(data).length ? `\n   📦 Data: ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level}] ${icon} ${message}${dataString}`;
};

module.exports = {
    info: (message, data = {}) => {
        console.log(formatMessage('INFO', 'ℹ️', message, data));
    },
    
    error: (message, data = {}) => {
        console.error(formatMessage('ERROR', '❌', message, data));
    },
    
    warn: (message, data = {}) => {
        console.warn(formatMessage('WARN', '⚠️', message, data));
    }
};
