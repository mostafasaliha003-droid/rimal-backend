const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRatehawkHotelReviews,normalizeReviews,reviewDate}=require('./services/ratehawkHotelReviews');
const raw=[{id:1,author:'Fixture guest',rating:10,review_plus:'Positive fixture',review_minus:'Negative fixture',created:'2026-10-01 07:07:24.044426+00',room_name:'Supplier room',nights:2,detailed_review:{cleanness:10,location:8}},
    {id:2,author:'Other fixture guest',rating:0,review_minus:'Poor fixture experience',created:'2026-10-02',detailed_review:{cleanness:0,location:null}}];
function fixture({rows=[{hid:9226177,reviews:raw}],env={},delay=false,hotel={provider:'ratehawk'},budgetMs=1000}={}){
    const calls=[],writes=[],saved=new Map();let finish;
    const client={fetchHotelReviews:async(ids,language)=>{calls.push({ids,language});return delay?new Promise(resolve=>{finish=resolve;}):rows;}};
    const service=createRatehawkHotelReviews({HotelModel:{findOne:()=>({lean:async()=>hotel})},CacheModel:{findById:key=>({lean:async()=>saved.get(key)}),updateOne:async(filter,update)=>{writes.push(update.$set);saved.set(filter._id,update.$set);}},client,env,budgetMs});
    return {service,calls,writes,finish:()=>finish(rows)};
}
test('ETG ratings retain their zero-to-ten scale and negative comments; average describes the available sample',()=>{
    const result=normalizeReviews(raw);assert.equal(result.summary.score,5);assert.equal(result.summary.count,2);assert.equal(result.summary.ratedCount,2);
    assert.equal(result.reviews[0].rating,0);assert.equal(result.reviews[0].negative,'Poor fixture experience');assert.equal(result.reviews[1].positive,'Positive fixture');assert.equal(result.reviews[1].negative,'Negative fixture');
    assert.equal(result.summary.categories.find(c=>c.key==='cleanness').score,5);
    assert.equal(result.summary.categories.find(c=>c.key==='location').score,8);
    assert.equal(reviewDate(raw[0].created),'2026-10-01T07:07:24.044Z');assert.equal(reviewDate('not-a-date'),'');
});
test('missing, string and invalid ratings never become zeros or fabricated aggregate values',()=>{
    const result=normalizeReviews([{review_plus:'Text only',rating:null},{review_minus:'No score',rating:'9'},{rating:12},{rating:-1}]);
    assert.equal(result.summary.score,null);assert.equal(result.summary.ratedCount,0);assert.equal(result.summary.count,2);
});
test('exact hotel identity is required and Sandbox requests English with its environment clearly labelled',async()=>{
    const f=fixture();const value=await f.service.load('9226177','ar');assert.equal(value.source,'ratehawk');assert.equal(value.scale,10);assert.equal(value.environment,'sandbox');assert.equal(value.requestedLanguage,'ar');assert.equal(value.resolvedLanguage,'en');assert.equal(value.status,'ready');assert.deepEqual(f.calls,[{ids:[9226177],language:'en'}]);
    const wrong=fixture({rows:[{hid:123,reviews:raw}]});assert.equal((await wrong.service.load('9226177')).status,'unavailable');
});
test('concurrent views share one request and subsequent pagination uses the cached supplier response',async()=>{
    const reviews=Array.from({length:22},(_,index)=>({...raw[0],id:index}));const f=fixture({rows:[{hid:9226177,reviews}]});
    const [a,b]=await Promise.all([f.service.load('9226177','ar'),f.service.load('9226177','ar')]);
    assert.equal(f.calls.length,1);assert.equal(a.total,22);assert.equal(b.reviews.length,10);assert.equal(a.nextOffset,10);
    const page=await f.service.load('9226177','ar',10);assert.equal(page.reviews.length,10);assert.equal(page.reviews[0].id,'10');assert.equal(page.hasMore,true);
    const last=await f.service.load('9226177','ar',20);assert.equal(last.reviews.length,2);assert.equal(last.hasMore,false);assert.equal(f.calls.length,1);assert.equal(f.writes.length,1);
});
test('an empty supplier response is an explicit empty state, not an outage or an invented review',async()=>{
    const f=fixture({rows:[{hid:9226177,reviews:[]}]});const result=await f.service.load('9226177');assert.equal(result.status,'empty');assert.equal(result.summary.score,null);assert.deepEqual(result.reviews,[]);
    assert.equal((await fixture({hotel:null}).service.load('9226177')).status,'not_found');
});
test('interactive waits are bounded while a late provider response can complete without blocking hotel offers',async()=>{
    const f=fixture({delay:true,budgetMs:5});const result=await f.service.load('9226177');assert.equal(result.status,'checking');f.finish();await new Promise(resolve=>setImmediate(resolve));assert.equal((await f.service.load('9226177')).status,'ready');assert.equal(f.calls.length,1);
});
test('production languages and cache keys stay separate from Sandbox content',async()=>{
    const f=fixture({env:{RATEHAWK_BASE_URL:'https://api.ratehawk.com'}});const value=await f.service.load('9226177','es');assert.equal(value.environment,'production');assert.equal(value.resolvedLanguage,'es');assert.equal(f.calls[0].language,'es');
});
test('route validates hotel, language and page input and hides optional Google when unconfigured',async()=>{
    const express=require('express'),app=express();let calls=0;
    app.use('/hotels',require('./services/ratehawkHotelReviewRoutes')({reviews:{load:async()=>{calls++;return{status:'empty',reviews:[]};}},limiter:(_req,_res,next)=>next(),env:{}}));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    try{const base=`http://127.0.0.1:${server.address().port}/hotels`;
        const response=await fetch(base+'/9226177/reviews/ratehawk?language=ar');assert.deepEqual(await response.json(),{status:'empty',reviews:[],googleAvailable:false});assert.match(response.headers.get('cache-control'),/no-store/);
        for(const path of ['/bad/reviews/ratehawk','/9226177/reviews/ratehawk?offset=-1','/9226177/reviews/ratehawk?offset=999','/9226177/reviews/ratehawk?language=ru'])assert.equal((await fetch(base+path)).status,400);
        assert.equal(calls,1);
    }finally{await new Promise(resolve=>server.close(resolve));}
});
test('rating summaries batch uncached hotels in one request, reuse the cache and never invent a score',async()=>{
    const rows=[{hid:1,reviews:raw},{hid:2,reviews:[{review_plus:'Text only',rating:null}]}];
    const f=fixture({rows});
    const first=await f.service.summaries(['1','2','3'],'ar');
    assert.deepEqual(f.calls,[{ids:[1,2,3],language:'en'}]);
    assert.deepEqual(first.summaries,{1:{score:5,count:2},2:null,3:null});assert.equal(first.status,'ready');assert.equal(first.scale,10);
    const again=await f.service.summaries(['1','3'],'ar');assert.equal(f.calls.length,1);assert.deepEqual(again.summaries,{1:{score:5,count:2},3:null});
    const fromLoad=await f.service.load('1','ar');assert.equal(fromLoad.summary.score,5);assert.equal(f.calls.length,1);
});
test('rating summaries answer within the budget and leave slow hotels pending for a later visit',async()=>{
    const f=fixture({delay:true,budgetMs:5,rows:[{hid:7,reviews:raw}]});
    const slow=await f.service.summaries(['7']);assert.equal(slow.status,'partial');assert.deepEqual(slow.pending,['7']);
    f.finish();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
    const later=await f.service.summaries(['7']);assert.deepEqual(later.summaries,{7:{score:5,count:2}});assert.equal(f.calls.length,1);
});
test('summary route validates the hotel list and language',async()=>{
    const express=require('express'),app=express();const seen=[];
    app.use('/hotels',require('./services/ratehawkHotelReviewRoutes')({reviews:{load:async()=>({status:'empty'}),summaries:async(ids,language)=>{seen.push([ids,language]);return{status:'ready',summaries:{}};}},limiter:(_q,_s,next)=>next(),env:{}}));
    const server=app.listen(0);const base='http://127.0.0.1:'+server.address().port;
    try{
        const ok=await fetch(base+'/hotels/reviews/summary?hids=1,2,2&language=ar');assert.equal(ok.status,200);assert.equal((await ok.json()).success,true);assert.deepEqual(seen,[[['1','2'],'ar']]);
        assert.equal((await fetch(base+'/hotels/reviews/summary?hids=x&language=ar')).status,400);
        assert.equal((await fetch(base+'/hotels/reviews/summary?hids=1&language=fr')).status,400);
        assert.equal((await fetch(base+'/hotels/reviews/summary?hids='+Array.from({length:51},(_,i)=>i+1).join(','))).status,400);
    }finally{server.close();}
});
