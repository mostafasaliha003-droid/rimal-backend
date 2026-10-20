import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomClassification, roomGroupForRate, groupRoomOffers } from './supplierRoomTypes.js';
import { normalizeRoom } from './offers.js';
import { roomImagesForRate } from './hotelImages.js';

const double = {class:3,quality:2,sex:0,bathroom:2,bedding:3,family:0,capacity:2,club:0,bedrooms:0,balcony:0,view:0,floor:0};
const twin = {...double,bedding:4};
const suite = {...double,class:5,bedrooms:1};
const hotel = {hid:9226177,images:['https://example.test/lobby.jpg'],room_groups:[
    {room_group_id:90,name:'Double room (full double bed)',rg_ext:double,images:['https://example.test/double.jpg']},
    {room_group_id:91,name:'Double room (2 single beds)',rg_ext:twin,images:['https://example.test/twin.jpg']},
    {room_group_id:92,name:'One Bedroom Suite',rg_ext:suite,images:['https://example.test/suite.jpg']}
]};

test('ETG rooms without deprecated IDs match photos by every rg_ext field, independent of key order',()=>{
    const reordered=Object.fromEntries(Object.entries(double).reverse());
    assert.equal(roomClassification(double),roomClassification(reordered));
    assert.deepEqual(roomImagesForRate({rg_ext:reordered},hotel),['https://example.test/double.jpg']);
    assert.deepEqual(roomImagesForRate({rg_ext:twin},hotel),['https://example.test/twin.jpg']);
    assert.deepEqual(roomImagesForRate({rg_ext:suite},hotel),['https://example.test/suite.jpg']);
    for(const field of Object.keys(double)) assert.deepEqual(roomImagesForRate({rg_ext:{...double,[field]:99}},hotel),[],field);
});

test('partial, conflicting, ambiguous and same-name matches never borrow another room photograph',()=>{
    const {floor,...partial}=double;
    assert.equal(roomClassification(partial),'');
    assert.deepEqual(roomImagesForRate({room_name:hotel.room_groups[0].name,rg_ext:partial},hotel),[]);
    assert.deepEqual(roomImagesForRate({room_group_id:91,rg_ext:double},hotel),[]);
    assert.equal(roomGroupForRate({rg_ext:double},{room_groups:[hotel.room_groups[0],{...hotel.room_groups[0],room_group_id:999}]}),null);
    assert.deepEqual(roomImagesForRate({id:90},hotel),[],'rate IDs are not room group IDs');
    assert.deepEqual(roomImagesForRate({rg_ext:{...double,floor:1}},hotel),[]);
    assert.deepEqual(roomImagesForRate({},hotel),[],'property photos are not room photos');
    assert.deepEqual(roomImagesForRate({images:['https://example.test/direct.jpg'],rg_ext:partial},hotel),['https://example.test/direct.jpg']);
});

test('supplier labels stay exact and capacity never invents the bed type',()=>{
    const room=normalizeRoom({room_name:'  Superior Twin — City View  ',rg_ext:double,room_data_trans:{bedding_type:'2 single beds'}},hotel,[]);
    assert.equal(room.name,'  Superior Twin — City View  ');
    assert.equal(room.bed,'2 single beds');
    assert.equal(normalizeRoom({room_name:'Double Occupancy',rg_ext:double},hotel,[]).bed,undefined);
});

test('room types keep all meal/cancellation offers while separating beds, names and contracts',()=>{
    const rates=[
        {room_name:'Double room',rg_ext:double,book_hash:'breakfast',meal:'breakfast'},
        {room_name:'Double room',rg_ext:double,book_hash:'no-meal',meal:'nomeal'},
        {room_name:'Double room',rg_ext:twin,book_hash:'twin'},
        {room_name:'Pool view Double room',rg_ext:double,book_hash:'pool'},
        {room_name:'Double room',rg_ext:double,contract_source:'affiliate',book_hash:'affiliate'},
        {room_name:'Unclassified',book_hash:'unknown-1'},
        {room_name:'Unclassified',book_hash:'unknown-2'}
    ];
    const groups=groupRoomOffers(rates.map(r=>normalizeRoom(r,hotel,[])));
    assert.equal(groups.length,6);
    assert.deepEqual(groups[0].rooms.map(r=>r.book_hash),['breakfast','no-meal']);
    assert.equal(groups.flatMap(g=>g.rooms).length,rates.length);
    assert.equal(groups[1].rooms[0].images[0],'https://example.test/twin.jpg');
});
