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
    assert.deepEqual(rows.map(row=>row.value), ['0','AED','No','Yes','keep this information','Bring your passport','Not specified']);
    assert.ok(rows.some(row=>row.label.includes('Passport required')));
    assert.ok(rows.every(row=>!row.label.includes('_')));
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
