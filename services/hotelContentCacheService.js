const pending = new Map();
const attempted = new Map();
const { extractHotels, toHotelOperation } = require('../syncFilteredHotels');

async function hydrateHotelContent(values, { HotelModel = require('../models/Hotel'),
    client = require('./ratehawkClient'), budgetMs = 6000 } = {}) {
    const ids = [...new Set(values.map(String).filter(value => /^\d{1,10}$/.test(value)))].slice(0, 500);
    const fresh = ids.filter(id => !pending.has(id) && Date.now() - (attempted.get(id) || 0) > 60000);
    if (fresh.length) {
        for (const id of fresh) attempted.set(id, Date.now());
        while (attempted.size > 1000) attempted.delete(attempted.keys().next().value);
        for (let offset = 0; offset < fresh.length; offset += 100) {
            const batch = fresh.slice(offset, offset + 100);
            const task = Promise.resolve().then(() => client.hotelContentByIds({ language: 'en', hids: batch.map(Number) }))
            .then(async result => {
                if (!result.ok) return [];
                const hotels = extractHotels(result.data).filter(hotel => batch.includes(String(hotel.hid)));
                const operations = hotels.map(toHotelOperation).filter(Boolean);
                if (operations.length) await HotelModel.bulkWrite(operations);
                return operations.map(operation => operation.updateOne.update.$set);
            }).catch(() => []).finally(() => { for (const id of batch) pending.delete(id); });
            for (const id of batch) pending.set(id, task);
        }
    }
    const tasks = [...new Set(ids.map(id => pending.get(id)).filter(Boolean))];
    if (!tasks.length) return [];
    let timer;
    const completed = [];
    const settled = tasks.map(task => task.then(rows => { completed.push(...rows); return rows; }));
    try {
        return await Promise.race([
            Promise.all(settled).then(groups => [...new Map(groups.flat().map(hotel => [String(hotel.hid), hotel])).values()]),
            new Promise(resolve => { timer = setTimeout(() => resolve([...completed]), budgetMs); })
        ]);
    } finally { clearTimeout(timer); }
}
module.exports = { hydrateHotelContent };
