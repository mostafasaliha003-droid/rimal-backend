import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotelPolicySections, hotelExtraInformation, policyPlainText } from './hotelPolicies.js';

test('all supplied hotel policies survive display, including unknown fields, zero and false', () => {
    const sections = hotelPolicySections({metapolicy_struct:{
        deposit:[{price:0,currency:'AED',availability:false,extra_rule:{passport_required:true}}],
        future_policy:{future_field:'keep_this_information',note:'Bring your passport'},
        pets:null
    }});
    assert.deepEqual(sections.map(section=>section.title),['Deposits','Future policy','Pets']);
    const rows = sections.flatMap(section=>section.rows);
    assert.deepEqual(rows.map(row=>row.value), ['0 AED','No','Yes','keep this information','Bring your passport','Not specified']);
    assert.ok(rows.some(row=>row.label.includes('Passport required')));
    assert.ok(rows.every(row=>!row.label.includes('_')));
});

test('deposit entries keep their own price, currency and basis together, including percentages',()=>{
    const [section]=hotelPolicySections({metapolicy_struct:{deposit:[
        {availability:'available',currency:'EUR',deposit_type:'unspecified',payment_type:'cash',price:'123',price_unit:'per_room_per_stay',pricing_method:'fixed'},
        {availability:'available',currency:null,deposit_type:'breakage',payment_type:'unspecified',price:'20',price_unit:'per_guest_per_stay',pricing_method:'percent'},
        {availability:'available',currency:'USD',deposit_type:'keys',payment_type:'unspecified',price:'10',price_unit:'per_room_per_stay',pricing_method:'fixed'}
    ]}});
    assert.equal(section.entries.length,3);
    assert.equal(section.entries[0].rows[0].value,'123 EUR · per room per stay · Fixed amount');
    assert.equal(section.entries[1].rows[0].value,'20% · Currency: Not specified · per guest per stay');
    assert.equal(section.entries[2].rows[0].value,'10 USD · per room per stay · Fixed amount');
    assert.ok(section.entries[1].rows.some(row=>row.value==='For damage'));
    assert.ok(section.rows.every(row=>!row.label.includes('Policy 1') && !row.value.includes('_')));
    for(const entry of section.entries) {
        const fields=entry.rows.flatMap(row=>row.fields.map(path=>path.join('.')));
        assert.deepEqual(fields.toSorted(),['availability','currency','deposit_type','payment_type','price','price_unit','pricing_method'].toSorted());
        assert.equal(new Set(fields).size,fields.length,'No duplicated source fields');
    }
});

test('all policy types preserve documented details without inventing payment or availability terms',()=>{
    const source={
        internet:[{internet_type:'wireless',inclusion:'included',price:'0',currency:'AED',price_unit:'per_room_per_stay',work_area:'hotel'}],
        meal:[{meal_type:'breakfast',inclusion:'not_included',price:'12.50',currency:'USD'}],
        children_meal:[{meal_type:'dinner',age_start:0,age_end:7,inclusion:'unspecified',price:'0',currency:'AED'}],
        extra_bed:[{amount:2,inclusion:'not_included',price:'10',currency:'USD',price_unit:'per_guest_per_night'}],
        cot:[{amount:0,inclusion:'included',price:'0',currency:'AED',price_unit:'per_room_per_night'}],
        pets:[{pets_type:'lt_5kg',inclusion:'not_included',price:'50',currency:'USD',price_unit:'per_guest_per_stay'}],
        shuttle:[{shuttle_type:'two_ways',destination_type:'airport_train',inclusion:'not_included',price:'400',currency:'AED'}],
        parking:[{territory_type:'on_side',inclusion:'not_included',price:'67',currency:'USD',price_unit:'per_car_per_night'}],
        children:[{extra_bed:'unavailable',age_start:1,age_end:17,price:'0',currency:'USD'}],
        visa:{visa_support:'support_enable'},
        no_show:{availability:'available',day_period:'before_midday',time:'12:00:00'},
        add_fee:[{fee_type:'luggage_storage',price:'3',currency:'EUR',price_unit:'per_hour'}],
        check_in_check_out:[{check_in_check_out_type:'early_checkin',inclusion:'unspecified',price:null,currency:null}]
    };
    const sections=hotelPolicySections({metapolicy_struct:source});
    assert.equal(sections.length,Object.keys(source).length);
    const values=sections.flatMap(section=>section.rows.map(row=>row.value));
    for(const expected of ['Wi-Fi','Throughout the hotel','Breakfast','0–7 years','Less than 5 kg','Round trip','Airport / train station','On site','Unavailable','Visa support available','AM (before noon)','12:00:00','Luggage storage','Early check-in']) assert.ok(values.includes(expected),expected);
    assert.ok(sections.find(section=>section.key==='no_show').rows.some(row=>row.label==='Time (hotel local time)'));
    assert.doesNotMatch(values.join(' '),/UTC|free|paid on the spot/i);
    // Every populated source leaf occurs once, even when the UI combines fields.
    for(const section of sections) for(const [index,entry] of section.entries.entries()) {
        const original=Array.isArray(source[section.key])?source[section.key][index]:source[section.key];
        assert.deepEqual(entry.rows.flatMap(row=>row.fields.map(path=>path.join('.'))).toSorted(),Object.keys(original).toSorted());
    }
});

test('unknown nested fields and values survive, empty containers omit, and all three languages localize known enums',()=>{
    const source={future_rule:[{price:0,currency:'USD',extra_rule:{passport_required:false,notes:['Bring passport','Keep permit']},empty:{},empty_list:[],type:'brand_new_condition'}],empty_rule:[]};
    const sections=hotelPolicySections({metapolicy_struct:source});
    assert.equal(sections.length,1);
    const rows=sections[0].entries[0].rows;
    assert.deepEqual(rows.flatMap(row=>row.fields.map(path=>path.join('.'))).toSorted(),['price','currency','extra_rule.passport_required','extra_rule.notes.0','extra_rule.notes.1','type'].toSorted());
    assert.ok(rows.some(row=>row.value==='No'));
    assert.ok(rows.some(row=>row.value==='brand new condition'));
    for(const [language,expected] of [['en','Not included in the price'],['ar','غير مشمول في السعر'],['es','No incluido en el precio']]) {
        const [policy]=hotelPolicySections({metapolicy_struct:{internet:[{internet_type:'wireless',inclusion:'not_included',price:'0',currency:'USD',price_unit:'per_room_per_stay'}]}},language);
        assert.ok(policy.rows.some(row=>row.value===expected));
        assert.ok(policy.rows[0].value.includes('0') && policy.rows[0].value.includes('USD'));
    }
    assert.equal(hotelPolicySections({metapolicy_struct:{future_rule:{note:'included'}}})[0].rows[0].value,'included','Unknown free text is not translated as an enum');
});

test('Arabic age ranges and numeric prices use separate LTR isolation while units remain in their own direction',()=>{
    const sections=hotelPolicySections({metapolicy_struct:{
        children:[{age_start:0,age_end:3,price:'20',currency:'USD'}],
        deposit:[{price:'20',currency:'',pricing_method:'percent',price_unit:'per_guest_per_stay'}]
    }},'ar');
    const age=sections[0].rows.find(row=>row.fields.some(path=>path[0]==='age_start'));
    assert.equal(age.value,'0–3 سنوات');
    assert.deepEqual(age.segments,[{text:'0–3',direction:'ltr'},{text:'سنوات',direction:'auto'}]);
    assert.deepEqual(sections[0].rows[0].segments,[{text:'20 USD',direction:'ltr'}]);
    assert.deepEqual(sections[1].rows[0].segments,[{text:'20%',direction:'ltr'},{text:'العملة: غير محدد',direction:'auto'},{text:'لكل ضيف لكل إقامة',direction:'auto'}]);
});

test('cached policy fields remain visible and extra information is safe readable text', () => {
    const hotel = {metapolicy_struct:{},staticData:{
        metapolicy_struct:{visa:{visa_support:true}},
        metapolicy_extra_info:'<p>Passport &amp; visa required.</p><p>Fee: &#50;&#48; AED.<br>Check-in after 14:00.</p><script>hidden()</script>'
    }};
    assert.equal(hotelPolicySections(hotel)[0].rows[0].value,'Yes');
    assert.equal(hotelExtraInformation(hotel),'Passport & visa required.\nFee: 20 AED.\nCheck-in after 14:00.');
    assert.equal(policyPlainText(null),'');
    assert.equal(hotelPolicySections(hotel,'ar')[0].title,'دعم التأشيرة');
});
