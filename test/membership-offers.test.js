const test = require('node:test');
const assert = require('node:assert/strict');
const { activeMembershipOffers } = require('../services/membershipOffers');
const now = Date.parse('2026-10-21T10:00:00Z');
const campaign = () => ({ id: 'jumeirah-autumn', approved: true, evidenceReference: 'internal-review-42',
    startsAt: '2026-10-21T09:00:00Z', endsAt: '2026-10-21T11:00:00Z',
    title: { ar: 'عرض جميرا', en: 'Jumeirah offer' }, terms: { ar: 'فنادق وتواريخ مختارة', en: 'Selected hotels and dates' },
    maxSavingPercent: 30, comparisonBasis: 'Same room, dates, meals and cancellation terms; reviewed comparison',
    supplierPrice: 100, evidenceDocument: 'private-document-path' });
test('public campaigns require approval, evidence and current validity', () => {
    const row = campaign();
    for (const change of [{approved:false}, {evidenceReference:''}, {startsAt:'invalid'}, {endsAt:'invalid'},
        {startsAt:'2026-10-22T09:00:00Z'}, {startsAt:'2026-10-21T09:00:00'}, {endsAt:'2026-10-21T10:00:00Z'}, {terms:{en:'Only English'}}, {id:'../../unsafe'}]) {
        assert.deepEqual(activeMembershipOffers([{...row,...change}], now), []);
    }
    assert.equal(activeMembershipOffers([row], Date.parse(row.startsAt)).length, 1);
    assert.equal(activeMembershipOffers([row], Date.parse(row.endsAt)).length, 0);
});
test('public campaign response excludes internal evidence and prices; discounts require comparison basis', () => {
    const result = activeMembershipOffers([campaign()], now)[0];
    assert.equal(result.maxSavingPercent, 30);
    for (const key of ['supplierPrice','evidenceDocument','evidenceReference','comparisonBasis','approved']) assert.equal(key in result, false);
    for (const change of [{comparisonBasis:''}, {maxSavingPercent:101}, {maxSavingPercent:-30}, {maxSavingPercent:'30'}]) {
        assert.equal('maxSavingPercent' in activeMembershipOffers([{...campaign(),...change}], now)[0], false);
    }
    assert.equal(activeMembershipOffers(Array.from({length:20},campaign),now).length,6);
});
test('no approved campaigns means no discount or scarcity claims', () => {
    assert.deepEqual(activeMembershipOffers(), []);
    assert.deepEqual(activeMembershipOffers(null,now), []);
});
test('marketing feed is public while application access retains role enforcement', async () => {
    const express = require('express');
    const { createMembershipRouters } = require('../services/membershipRoutes');
    const app = express(); let authChecks = 0;
    const routers = createMembershipRouters({service:{},sessions:{},auth:{requireRole:()=>(_req,res)=>{authChecks++;res.status(401).end();}},UserModel:{},Application:{},Document:{},Audit:{},Notice:{}});
    app.use('/api/membership',routers.customer);
    const server = app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    try {
        const base = `http://127.0.0.1:${server.address().port}/api/membership`;
        const response = await fetch(base+'/offers');
        assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
        const data = await response.json();assert.deepEqual(data.offers,[]);assert.ok(Number.isFinite(Date.parse(data.checkedAt)));
        assert.equal(authChecks,0);
        assert.equal((await fetch(base+'/application',{method:'PUT'})).status,401);assert.equal(authChecks,1);
    } finally { await new Promise(resolve=>server.close(resolve)); }
});
