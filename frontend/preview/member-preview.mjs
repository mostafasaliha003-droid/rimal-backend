// Local design review only. This server handles every API route before Vite's dev proxy.
import { createServer } from 'vite';
import { createReadStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..');
const origin='http://127.0.0.1:4178',user={name:'Demo Member',email:'demo@example.test',points:0};
const properties=['Palm Cove Retreat','The Courtyard','Cloud House'];
const photos=properties.map((_,i)=>origin+'/sample-photo/'+i+'.jpg');
const rate=(i)=>({room_name:'Courtyard double room',name:'Courtyard double room',meal:'breakfast',amenities:['Wi-Fi','Pool'],book_hash:'demo-room-'+i,offer_context:'sample-offer-'+i,
    payment_options:{payment_types:[{type:'deposit',amount:String(225+i*45),currency_code:'USD',tax_data:{taxes:[{name:'City tax',included_by_supplier:false,amount:'10',currency_code:'AED'}]},cancellation_penalties:{policies:[]}}]}});
const hotels=properties.map((name,i)=>({hid:70001+i,name,stars:4+i%2,city:'Dubai',address:'Demo location · Dubai',latitude:25.141+i*.009,longitude:55.188+i*.014,images:[photos[i]],amenities:['Wi-Fi','Pool'],description:'Sample property for the local design preview.',rates:[rate(i)]}));
const exampleBooking={bookingReference:'DEMO-PILLOW-001',status:'active',supplierStatus:'CONFIRMED',hotelName:properties[0],checkInDate:'2027-02-06',checkOutDate:'2027-02-08',price:225,priceCurrency:'USD'};
const status={enabled:true,authenticated:true,canAccess:true,user,application:{status:'approved',reference:'MEM-DEMO-001'}};
function sample(path,method,body) {
    if(path==='/membership/status') return status;
    if(path==='/auth/session')return {success:true,user};
    if(path==='/user/profile')return {success:true,profile:user,bookings:[exampleBooking]};
    if(path==='/membership/offers')return {offers:[],checkedAt:new Date().toISOString()};
    if(path==='/owned/notifications')return {notifications:[]};
    if(path==='/search/suggest')return {regions:[{id:1,name:'Dubai'}],hotels:hotels.map(h=>({hid:h.hid,name:h.name}))};
    if(path.startsWith('/search/sort/'))return {hotels:hotels.map(h=>h.hid)};
    if(/^\/v1\/hotels\/\d+$/.test(path))return {success:true,hotel:hotels.find(h=>h.hid===Number(path.split('/').at(-1)))};
    if(path.startsWith('/search/rates'))return {success:true,hotels:body?.hids ? hotels.filter(h=>body.hids.includes(h.hid)) : hotels};
    if(path==='/search/hotelpage')return {hotels:[hotels.find(h=>h.hid===Number(body.hid)) || hotels[0]]};
    if(path==='/booking/prebook'){const i=Number(String(body.hash).split('-').at(-1)) || 0;return {status:'ok',bookHash:'demo-room-'+i,prebook_context:'sample-prebook',rate:rate(i)};}
    if(path.endsWith('/availability'))return {enabled:false,available:false};
    if(path.includes('reviews'))return {items:[],reviews:[],status:'unavailable'};
    if(path==='/support/eligibility')return {references:[{reference:exampleBooking.bookingReference,hotelName:properties[0]}]};
    if(path==='/support/conversations' && method==='GET')return {conversations:[]};
    return null;
}
const preview={
    name:'isolated-member-preview',
    transformIndexHtml(){return [{tag:'div',attrs:{style:'padding:5px 12px;text-align:center;color:#2D173A;background:#DFE8C7;font:600 12px system-ui'},children:'معاينة تجريبية · فنادق وأسعار توضيحية · Demo properties and rates',injectTo:'body-prepend'}];},
    configureServer(server){
        server.middlewares.use(async(req,res,next)=>{
            const url=new URL(req.url,origin);
            const image=url.pathname.match(/^\/sample-photo\/([0-2])\.jpg$/);
            if(image){res.setHeader('content-type','image/jpeg');return createReadStream(resolve(here,'assets','demo-photo-'+image[1]+'.jpg')).pipe(res);}
            if(!url.pathname.startsWith('/api/'))return next();
            let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536){res.writeHead(413);return res.end();}}
            let body={};try{body=raw?JSON.parse(raw):{};}catch{}
            const reply=sample(url.pathname.slice(4),req.method,body);
            res.writeHead(reply===null?404:200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Robots-Tag':'noindex'});
            res.end(JSON.stringify(reply ?? {error:'not_available_in_design_preview'}));
        });
    }
};
const server=await createServer({root,cacheDir:resolve(root,'../.cache/pillow-demo-vite'),server:{host:'127.0.0.1',port:4178,strictPort:true},plugins:[preview]});
await server.listen();server.printUrls();
