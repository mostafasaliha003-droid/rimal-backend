const test=require('node:test');const assert=require('node:assert/strict');const {hotelSearchPlan,membershipPresentation,registrationFormReady,normalizeVerificationCode}=require('./foundationContracts.ts');
const criteria={checkin:'2027-02-16',checkout:'2027-02-18',residency:'ae',guests:[{adults:2,children:[]}],currency:'USD',regionId:6053839};
test('regular search target stays unchanged when the independent favorite collection changes',()=>{const favorites=[1];const before=hotelSearchPlan(criteria,'en',null);favorites.push(2);const after=hotelSearchPlan(criteria,'en',null);assert.equal(before.key,after.key);assert.equal(after.criteria.regionId,6053839);assert.equal(after.criteria.hids,undefined);});
test('saved searches request only the current saved IDs and never retain a region target',()=>{const before=hotelSearchPlan(criteria,'en',[1,2]);const after=hotelSearchPlan(criteria,'en',[2]);assert.notEqual(before.key,after.key);assert.deepEqual(after.criteria.hids,[2]);assert.equal(after.criteria.regionId,undefined);assert.equal(hotelSearchPlan(criteria,'en',[]),null);});
test('membership approval preserves signed-in identity while 401 always offers sign-in recovery',()=>{assert.equal(membershipPresentation(403,true),'approval');assert.equal(membershipPresentation(401,true),'signin');assert.equal(membershipPresentation(401,false),'signin');assert.equal(membershipPresentation(403,false),'signin');});
test('registration rejects six-to-nine-character passwords before a request and accepts the ten-character boundary',()=>{for(const length of [6,7,8,9])assert.equal(registrationFormReady('Guest','guest@example.test','a'.repeat(length)),false);assert.equal(registrationFormReady('Guest','guest@example.test','a'.repeat(10)),true);assert.equal(registrationFormReady('','guest@example.test','a'.repeat(10)),false);});
test('verification input accepts ASCII and both Arabic decimal digit sets without dropping leading zeroes',()=>{
  for(const input of ['012345','\u0660\u0661\u0662\u0663\u0664\u0665','\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5','0\u0661\u06f23\u0664\u06f5'])assert.equal(normalizeVerificationCode(input),'012345');
  assert.equal(normalizeVerificationCode('\u0666\u0667\u0668\u0669'),'6789');
  assert.equal(normalizeVerificationCode('\u06f6\u06f7\u06f8\u06f9'),'6789');
});
test('verification input remains editable, removes non-digits and retains at most six digits',()=>{
  assert.equal(normalizeVerificationCode(''),'');
  assert.equal(normalizeVerificationCode('code: \u0660\u0661\u0662-\u06f3\u06f4\u06f5 678'),'012345');
  assert.equal(normalizeVerificationCode('\u0660\u06f1'),'01');
  assert.equal(normalizeVerificationCode('letters only'),'');
  assert.equal(normalizeVerificationCode('0000000'),'000000');
});
