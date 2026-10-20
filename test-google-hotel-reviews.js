const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGoogleHotelReviews, selectPlace, reviewPayload } = require('./services/googleHotelReviews');
const hotel = { hid: '9226177', name: 'Hyatt Place Dubai Jumeirah Residences', latitude: '25.24', longitude: '55.27', address: 'Al Mina Road', city: 'Dubai' };
const place = { id: 'ChIJ_fixture_hotel', displayName: { text: hotel.name }, location: { latitude: 25.24, longitude: 55.27 }, types: ['lodging', 'hotel'] };
const details = { ...place, rating: 4.3, userRatingCount: 321,
    googleMapsUri: 'https://maps.google.com/maps?cid=123', googleMapsLinks: { reviewsUri: 'https://www.google.com/maps?cid=123&reviews=1' },
    reviews: [{ rating: 1, text: { text: 'Fixture negative review', languageCode: 'en' }, originalText: { text: 'Fixture original', languageCode: 'es' },
        publishTime: '2026-10-01T12:00:00Z', visitDate: { year: 2026, month: 9 }, googleMapsUri: 'https://www.google.com/maps/reviews/fixture',
        authorAttribution: { displayName: 'Fixture author', uri: 'https://www.google.com/maps/contrib/fixture', photoUri: 'https://lh3.googleusercontent.com/fixture' } }],
    attributions: [{ provider: 'Fixture attribution', providerUri: 'https://www.google.com/maps' }] };
function fixture({ limit = 200, response = details, saved = false, enabled = true } = {}) {
    const supplierIdentity = require('node:crypto').createHash('sha256').update(JSON.stringify([hotel.name, place.location])).digest('hex');
    let calls = [], stored = saved ? { hid: hotel.hid, placeId: place.id, supplierIdentity } : null, writes = [], used = 0;
    const service = createGoogleHotelReviews({
        HotelModel: { findOne: ({hid}) => ({ lean: async () => hid === hotel.hid ? hotel : null }) },
        PlaceModel: { findOne: () => ({ lean: async () => stored }), updateOne: async (filter, update) => { writes.push(update.$set); stored = {...filter,...update.$set}; } },
        UsageModel: { updateOne: async () => {}, findOneAndUpdate: async (_filter, _update) => used < limit ? {count:++used} : null },
        env: { GOOGLE_REVIEWS_ENABLED: String(enabled), GOOGLE_PLACES_API_KEY: 'fixture-server-key', GOOGLE_PLACES_DAILY_REQUEST_LIMIT: String(limit) },
        fetchImpl: async (url, options) => { calls.push({url,options}); return {ok:true,json:async()=>url.includes('searchText')?{places:[place]}:response}; }
    });
    return {service,calls,writes};
}
test('Google content is disabled until configured and never calls the provider without opt-in', async()=>{
    const f=fixture({enabled:false});assert.deepEqual(await f.service.load(hotel.hid,'en'),{status:'unavailable'});assert.equal(f.calls.length,0);
});
test('matching requires hotel name, room-building qualifiers, location and an unambiguous lodging identity',()=>{
    assert.equal(selectPlace(hotel,[place]).id,place.id);
    assert.equal(selectPlace(hotel,[{...place,id:'ChIJ_wrong',displayName:{text:'Hyatt Place Dubai Jumeirah'}}]),null);
    assert.equal(selectPlace(hotel,[{...place,location:{latitude:26,longitude:55}}]),null);
    assert.equal(selectPlace(hotel,[{...place,types:['restaurant']}]),null);
    assert.equal(selectPlace(hotel,[place,{...place,id:'ChIJ_second'}]),null);
    assert.equal(selectPlace({...hotel,latitude:''},[place]),null);
});
test('real-source DTO retains negative reviews, attribution, original language, visit date and direct review links',async()=>{
    const f=fixture();const result=await f.service.load(hotel.hid,'ar');
    assert.equal(result.status,'ready');assert.equal(result.rating,4.3);assert.equal(result.count,321);
    assert.equal(result.reviews[0].rating,1);assert.equal(result.reviews[0].author.name,'Fixture author');
    assert.equal(result.reviews[0].originalLanguage,'es');assert.deepEqual(result.reviews[0].visitDate,{year:2026,month:9});
    assert.equal(result.url,details.googleMapsLinks.reviewsUri);assert.equal(result.reviews[0].url,details.reviews[0].googleMapsUri);
    assert.deepEqual(Object.keys(f.writes[0]).sort(),['placeId','supplierIdentity','verifiedAt']);
    assert(f.calls[1].url.endsWith('?languageCode=ar'));
    assert(f.calls.every(c=>!c.url.includes('fixture-server-key')));
    assert(f.calls[1].options.headers['X-Goog-FieldMask'].includes('reviews'));
    assert(!f.calls[1].options.headers['X-Goog-FieldMask'].includes('*'));
});
test('only simultaneous requests share a response; completed Google ratings are not cached or persisted',async()=>{
    const f=fixture();await Promise.all([f.service.load(hotel.hid,'en'),f.service.load(hotel.hid,'en')]);
    assert.equal(f.calls.length,2);await f.service.load(hotel.hid,'en');assert.equal(f.calls.length,3);assert.equal(f.writes.length,1);
});
test('shared daily budget prevents additional billed provider calls',async()=>{
    const f=fixture({limit:1});assert.equal((await f.service.load(hotel.hid,'en')).status,'limited');assert.equal(f.calls.length,1);
    await f.service.load(hotel.hid,'en');assert.equal(f.calls.length,1);
});
test('saved place must still return the correct identity and location before any rating is published',async()=>{
    for(const response of [{...details,id:'ChIJ_other'},{...details,location:{latitude:26,longitude:56}}]){
        const f=fixture({saved:true,response});const result=await f.service.load(hotel.hid,'en');assert.equal(result.status,'unmatched');assert.equal(result.rating,undefined);
    }
});
test('malformed external URLs and absent rating counts do not become trusted source links or invented ratings',()=>{
    const result=reviewPayload({id:'fixture',rating:null,userRatingCount:null,googleMapsUri:'javascript:alert(1)',reviews:[{rating:99,text:{text:'<script>fixture</script>'},authorAttribution:{uri:'https://evil.test/google.com',photoUri:'http://lh3.googleusercontent.com/x'}}]});
    assert.equal(result.rating,null);assert.equal(result.count,null);assert.equal(result.url,'');assert.equal(result.reviews[0].author.url,'');assert.equal(result.reviews[0].author.photo,'');
});
test('reviews route rejects arbitrary hotel IDs and languages, avoids content caching, and reveals no configuration',async()=>{
    const express=require('express');const app=express();const seen=[];
    app.use('/hotels',require('./services/googleHotelReviewRoutes')({reviews:{enabled:()=>false,load:async(...args)=>{seen.push(args);return{status:'unavailable'};}},limiter:(_req,_res,next)=>next()}));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    try{const base=`http://127.0.0.1:${server.address().port}`;
        const availability=await fetch(base+'/hotels/reviews/google/availability');assert.deepEqual(await availability.json(),{enabled:false});
        const response=await fetch(base+'/hotels/9226177/reviews/google?language=ar');assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.deepEqual(await response.json(),{status:'unavailable'});
        assert.equal((await fetch(base+'/hotels/not-a-hotel/reviews/google')).status,400);
        assert.equal((await fetch(base+'/hotels/9226177/reviews/google?language=invalid')).status,400);assert.equal(seen.length,1);
    }finally{await new Promise(resolve=>server.close(resolve));}
});
