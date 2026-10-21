const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const crypto=require('node:crypto');
const {imageMetadata,encryptDocument,decryptDocument,encryptionKey}=require('./services/membershipDocuments');
const {validateEligibility,requiredDocuments,publicApplication}=require('./services/membershipService');
const {createMembershipAccessGate}=require('./services/membershipAccessGate');
const {createMembershipMailer,mailContent}=require('./services/membershipMail');
const {passportEvidence,professionalEvidence,checkDigit,parseTsv,createLocalDocumentReader}=require('./services/membershipEligibilityReader');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const env={MEMBERSHIP_DOCUMENT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex')};
test('identity documents use independent authenticated encryption bound to owner context',()=>{
    const context={realm:'qa',applicationId:'one',kind:'passport'},cipher=encryptDocument(png,context,env);
    assert.ok(!cipher.ciphertext.equals(png));assert.deepEqual(decryptDocument({...context,...cipher},env),png);
    const {Binary}=require('mongoose').mongo;
    assert.deepEqual(decryptDocument({...context,...cipher,iv:new Binary(cipher.iv),tag:new Binary(cipher.tag),ciphertext:new Binary(cipher.ciphertext)},env),png,'MongoDB lean Binary values must decrypt without exposing the plaintext in storage');
    assert.notDeepEqual(encryptDocument(png,context,env).iv,cipher.iv);
    for(const changed of [{realm:'other'},{applicationId:'two'},{kind:'eid_front'},{tag:Buffer.alloc(16)},{ciphertext:Buffer.alloc(cipher.ciphertext.length)}])assert.throws(()=>decryptDocument({...context,...cipher,...changed},env),/document_unavailable/);
    assert.throws(()=>encryptionKey({}),/unavailable/);
    assert.throws(()=>encryptionKey({...env,PAYMENT_BOOKING_ENCRYPTION_KEY:env.MEMBERSHIP_DOCUMENT_ENCRYPTION_KEY}),/unavailable/);
});
test('document upload rejects active formats, mismatched types, oversized images and invalid dimensions',()=>{
    assert.equal(imageMetadata(png,'image/png').width,1);
    for(const [data,type] of [[png,'image/jpeg'],[Buffer.from('<svg onload="alert(1)"></svg>'),'image/png'],[Buffer.alloc(6*1024*1024),'image/png'],[Buffer.alloc(33),'image/png']])assert.throws(()=>imageMetadata(data,type));
    const huge=Buffer.from(png);huge.writeUInt32BE(50000,16);assert.throws(()=>imageMetadata(huge,'image/png'));
});
test('eligibility is validated independently of browser and requires correct documents',()=>{
    for(const nationality of ['ae','sa','kw','qa','bh','om'])assert.equal(validateEligibility({category:'gcc_citizen',nationality}).nationality,nationality);
    assert.deepEqual(requiredDocuments('uae_professional'),['eid_front','eid_back']);
    assert.throws(()=>validateEligibility({category:'gcc_citizen',nationality:'gb'}));
    assert.throws(()=>validateEligibility({category:'uae_professional',nationality:'zz',profession:'doctor',professionTitle:'Doctor'}));
    assert.throws(()=>validateEligibility({category:'uae_professional',nationality:'eg',profession:'other',professionTitle:'Other'}));
    assert.equal(validateEligibility({category:'uae_professional',nationality:'eg',profession:'engineer',professionTitle:'Civil engineer'}).profession,'engineer');
});
test('public application never exposes internal review, ciphertext or expired documents',()=>{
    const data=publicApplication({reference:'ref',status:'submitted',internalNote:'private',reviewer:'staff',ciphertext:'secret'},[{kind:'passport',ciphertext:'secret',expiresAt:new Date(0)},{kind:'eid_front',mime:'image/png',size:20}]);
    assert.equal(data.documents.length,1);assert.ok(!JSON.stringify(data).includes('secret'));assert.ok(!Object.hasOwn(data,'internalNote'));assert.ok(!Object.hasOwn(data,'reviewer'));
});
test('server gate blocks anonymous and pending inventory; revocation takes effect on next request and servicing stays available',async t=>{
    let status='submitted',unavailable=false;
    const sessions={resolve:async token=>token==='a'.repeat(64)?{role:'user',subject:'user',realm:'qa'}:token==='b'.repeat(64)?{role:'admin'}:null};
    const service={enabled:()=>true,application:async()=>{if(unavailable)throw Error();return {row:{status}};}};
    const app=express();app.use(createMembershipAccessGate({service,sessions}));app.use((_req,res)=>res.json({reached:true}));
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
    const request=(path,token,method='GET')=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:token?{Authorization:`Bearer ${token==='valid'?'a'.repeat(64):token==='admin'?'b'.repeat(64):token}`}:{}});
    assert.equal((await request('/api/v1/hotels/search')).status,401);
    assert.equal((await request('/api/v1/hotels/search','forged')).status,401);
    assert.equal((await request('/api/display-rates','valid')).status,403);
    status='approved';assert.equal((await request('/api/display-rates','valid')).status,200);
    status='suspended';assert.equal((await request('/api/display-rates','valid')).status,403);
    assert.equal((await request('/api/owned/bookings/booking/cancellation','valid','POST')).status,200);
    assert.equal((await request('/api/support/eligibility','valid')).status,200);
    assert.equal((await request('/api/v1/ready')).status,200);
    assert.equal((await request('/api/payment/ziina/webhook/',null,'POST')).status,200);
    assert.equal((await request('/api/v1/admin/membership/applications','admin')).status,200);
    unavailable=true;assert.equal((await request('/api/display-rates','valid')).status,503);
});
test('membership emails escape applicant notes and never include identity attachments or approval claims in OTP',()=>{
    const content=mailContent({name:'<script>',reference:'ref',event:'needs_information',publicNote:'<img onerror=x>',origin:'https://example.test'});
    assert.ok(!content.html.includes('<script>'));assert.ok(!content.html.includes('<img onerror'));assert.ok(content.html.includes('&lt;img'));
    assert.ok(content.text.includes('https://example.test/membership'));assert.equal(content.attachments,undefined);
    assert.match(mailContent({code:'123456',origin:'https://example.test'}).text,/not membership approval/);
});
test('mailer never claims notices without SMTP configuration and scopes every claim to the current realm',async()=>{
    let writes=0;const seen=[];const Notice={updateMany:async filter=>{writes++;seen.push(filter);},findOneAndUpdate:filter=>{writes++;seen.push(filter);return {lean:async()=>null};}};
    await createMembershipMailer({UserModel:{},Application:{},Notice,env:{RIMAL_AUTH_REALM:'qa'}}).flush();assert.equal(writes,0);
    await createMembershipMailer({UserModel:{},Application:{},Notice,env:{RIMAL_AUTH_REALM:'qa',SMTP_USER:'qa@example.test',SMTP_PASSWORD:'fixture'}}).flush();
    assert.equal(writes,2);assert.ok(seen.every(filter=>filter.realm==='qa'));assert.equal(seen[0].status,'sending');assert.equal(seen[1].status,'pending');
});
function passportLines({nationality='ARE',expiry='301231',name='DOE<<JANE'}={}){
    const document='A1234567<',birth='900101',optional='<'.repeat(14);
    const second=document+checkDigit(document)+nationality+birth+checkDigit(birth)+'F'+expiry+checkDigit(expiry)+optional+checkDigit(optional);
    const composite=checkDigit(second.slice(0,10)+second.slice(13,20)+second.slice(21,43));
    return {lines:[{text:'P<ARE'+name.padEnd(39,'<'),confidence:99},{text:second+composite,confidence:99}]};
}
test('automatic eligibility reads written passport fields and valid checksums; uncertain or mismatched evidence always needs review',()=>{
    const app={nationality:'ae'},user={name:'Jane Doe'},now=new Date('2026-10-21');
    assert.equal(passportEvidence(passportLines(),app,user,now).eligible,true);
    assert.equal(passportEvidence(passportLines({nationality:'KWT'}),app,user,now).eligible,false);
    assert.equal(passportEvidence(passportLines({expiry:'200101'}),app,user,now).eligible,false);
    assert.equal(passportEvidence(passportLines(),app,{name:'Different Person'},now).eligible,false);
    const uncertain=passportLines();uncertain.lines[1].confidence=89;assert.equal(passportEvidence(uncertain,app,user,now).eligible,false);
    const tampered=passportLines();tampered.lines[1].text='B'+tampered.lines[1].text.slice(1);assert.equal(passportEvidence(tampered,app,user,now).eligible,false);
});
test('professional eligibility requires matching ID sides, expiry, name, printed nationality and occupation',()=>{
    const result=values=>({lines:values.map(text=>({text,confidence:99}))}),front=result(['ID Number: 784-1990-1234567-1','Name: Jane Doe','Nationality: Egypt','Expiry Date: 31/12/2030']),back=result(['ID Number: 784-1990-1234567-1','Occupation: Civil Engineer']);
    const app={nationality:'eg',profession:'engineer',professionTitle:'Civil Engineer'},user={name:'Jane Doe'},now=new Date('2026-10-21');
    assert.equal(professionalEvidence(front,back,app,user,now).eligible,true);
    assert.equal(professionalEvidence(front,result(['ID Number: 784-1990-1234567-1','Occupation: Engineer']),{...app,professionTitle:'Engineer'},user,now).eligible,true);
    assert.equal(professionalEvidence(front,result(['ID Number: 784-1990-7654321-1','Occupation: Civil Engineer']),app,user,now).eligible,false);
    assert.equal(professionalEvidence(front,back,{...app,profession:'doctor'},user,now).eligible,false);
    assert.equal(professionalEvidence(front,result(['ID Number: 784-1990-1234567-1','Occupation: Engineer']),app,user,now).eligible,false);
    assert.equal(professionalEvidence(front,back,{...app,nationality:'ae'},user,now).eligible,false);
});
test('OCR retains the lowest confidence per field and remains unavailable until explicitly configured',async()=>{
    const data=parseTsv('level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t1\t1\t99\tName:\n5\t1\t1\t1\t1\t2\t0\t0\t1\t1\t40\tJane');
    assert.equal(data.lines[0].confidence,40);
    const reader=createLocalDocumentReader({env:{}});assert.equal(reader.configured(),false);await assert.rejects(reader.read(png),/unavailable/);
});
test('receipt email is preserved after a fast decision and uses the event snapshot rather than a later review note',async()=>{
    let pending=true,sent,delivery;
    const Notice={updateMany:async()=>{},findOneAndUpdate:()=>({lean:async()=>{if(!pending)return null;pending=false;return {_id:'notice',applicationId:'app',ownerSubject:'owner',realm:'qa',event:'submitted',revision:1,publicNote:''};}}),updateOne:async(_filter,update)=>{delivery=update.$set.status;}};
    const mailer=createMembershipMailer({Notice,Application:{findOne:()=>({lean:async()=>({reference:'ref',status:'approved',revision:3,publicNote:'LATER-REVIEW-NOTE'})})},UserModel:{findById:()=>({lean:async()=>({name:'QA Applicant',email:'qa@example.test'})})},env:{RIMAL_AUTH_REALM:'qa',SMTP_USER:'sender@example.test',SMTP_PASSWORD:'fixture',MEMBERSHIP_SITE_URL:'https://example.test'},transporter:{sendMail:async message=>{sent=message;return {accepted:['qa@example.test'],messageId:'fixture'};}}});
    await mailer.flush();assert.equal(delivery,'sent');assert.match(sent.text,/application and documents/);assert.ok(!sent.text.includes('LATER-REVIEW-NOTE'));assert.equal(sent.attachments,undefined);
});
