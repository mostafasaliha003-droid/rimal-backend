// Isolated synthetic collections only. Never sends real email or changes bookings.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const mongoose=require('mongoose');
async function verifyMembershipSandbox(env=process.env){
    require('./seed-sandbox').assertSandboxSeedEnvironment(env);
    const connection=await mongoose.createConnection(env.MONGO_URI,{serverSelectionTimeoutMS:15000,connectTimeoutMS:10000}).asPromise();
    const prefix=`membership_qa_${crypto.randomBytes(8).toString('hex')}`,collections=[];
    const model=(name,schema)=>{const collection=`${prefix}_${name.toLowerCase()}`;collections.push(collection);return connection.model(`${name}_${prefix}`,schema,collection);};
    try{
        assert.equal(connection.name,env.PAYMENT_SANDBOX_DATABASE);
        const UserModel=model('User',new mongoose.Schema({name:String,email:String,phone:String,createdAt:Date}));
        const Application=model('Application',require('../models/MembershipApplication').schema.clone());
        const Document=model('Document',require('../models/MembershipDocument').schema.clone());
        const Audit=model('Audit',require('../models/MembershipAudit').schema.clone());
        const Notice=model('Notice',require('../models/MembershipNotice').schema.clone());
        await Promise.all([UserModel,Application,Document,Audit,Notice].map(m=>m.init()));
        const qaEnv={PRIVATE_MEMBERSHIP_ENABLED:'true',RIMAL_AUTH_REALM:prefix,MEMBERSHIP_EXISTING_USERS_BEFORE:'2021-01-01T00:00:00Z',MEMBERSHIP_DOCUMENT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),MEMBERSHIP_SITE_URL:'https://example.test',SMTP_USER:'sender@example.test',SMTP_PASSWORD:'fixture'};
        const service=require('../services/membershipService').createMembershipService({UserModel,Application,Document,Audit,Notice,env:qaEnv});
        const users=await UserModel.create([{name:'Synthetic existing member',email:'legacy@example.test',createdAt:new Date('2020-01-01')},{name:'Synthetic applicant',email:'applicant@example.test',createdAt:new Date('2030-01-01')},{name:'Synthetic professional',email:'professional@example.test',createdAt:new Date('2030-01-01')}]);
        const identity=i=>({subject:String(users[i]._id),email:users[i].email,role:'user',realm:prefix}),admin={subject:'synthetic-reviewer',role:'admin',realm:prefix};
        assert.equal((await service.status(identity(0))).canAccess,true);
        assert.equal((await service.status(identity(0))).application.grandfathered,true);
        assert.equal((await service.status(identity(1))).canAccess,false);
        assert.equal(await Notice.countDocuments({}),0);
        let draft=await service.saveDraft(identity(1),{category:'gcc_citizen',nationality:'ae'});
        await assert.rejects(service.submit(identity(1),{consent:true}),/documents_required/);
        const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
        await service.upload(identity(1),'passport',png,'image/png');
        const raw=await Document.collection.findOne({kind:'passport'});assert.ok(!Buffer.from(raw.ciphertext.buffer).equals(png));
        assert.deepEqual((await service.document(identity(1),draft.reference,'passport')).buffer,png);
        await assert.rejects(service.document(identity(2),draft.reference,'passport'),/document_not_found/);
        await assert.rejects(service.document({...admin,realm:'other'},draft.reference,'passport'),/document_not_found/);
        const submissions=await Promise.allSettled([service.submit(identity(1),{consent:true}),service.submit(identity(1),{consent:true})]);
        assert.ok(submissions.some(result=>result.status==='fulfilled'));
        await service.submit(identity(1),{consent:true});assert.equal(await Notice.countDocuments({event:'submitted'}),1);
        assert.equal((await service.status(identity(1))).canAccess,false);
        let row=(await service.status(identity(1))).application;
        await assert.rejects(service.upload(identity(1),'passport',png,'image/png'),/not_allowed/);
        await assert.rejects(service.review(admin,row.reference,{action:'approve',revision:row.revision}),/manual_verification_required/);
        const decisions=await Promise.allSettled([service.review(admin,row.reference,{action:'approve',revision:row.revision,documentsVerified:true}),service.review(admin,row.reference,{action:'approve',revision:row.revision,documentsVerified:true})]);
        assert.equal(decisions.filter(result=>result.status==='fulfilled').length,1);
        assert.equal(await Notice.countDocuments({event:'approved'}),1);
        row=(await service.status(identity(1))).application;assert.equal(row.status,'approved');
        const doc=await Document.findOne({kind:'passport'}).lean();assert.ok(Math.abs(new Date(doc.expiresAt)-Date.now()-30*86400000)<30000);
        await service.review(admin,row.reference,{action:'suspend',revision:row.revision,publicNote:'Synthetic eligibility recheck'});
        assert.equal((await service.status(identity(1))).canAccess,false);
        const after=await Document.findOne({kind:'passport'}).lean();assert.ok(new Date(after.expiresAt)<=new Date(doc.expiresAt));
        await Document.updateOne({_id:doc._id},{$set:{expiresAt:new Date(0)}});
        await assert.rejects(service.document(identity(1),row.reference,'passport'),/document_not_found/);
        assert.equal((await service.status(identity(1))).application.documents.length,0);
        const indexes=await Document.collection.indexes();assert.ok(indexes.some(index=>index.key.expiresAt===1&&index.expireAfterSeconds===0));
        // A professional application cannot submit with only one Emirates ID side.
        await service.saveDraft(identity(2),{category:'uae_professional',nationality:'eg',profession:'engineer',professionTitle:'Civil engineer'});
        await service.upload(identity(2),'eid_front',png,'image/png');await assert.rejects(service.submit(identity(2),{consent:true}),/documents_required/);
        await service.upload(identity(2),'eid_back',png,'image/png');await assert.rejects(service.submit(identity(2),{consent:false}),/consent_required/);
        await service.submit(identity(2),{consent:true});row=(await service.status(identity(2))).application;
        row=await service.review(admin,row.reference,{action:'request_information',revision:row.revision,publicNote:'Please provide a clearer synthetic ID.'});
        await service.saveDraft(identity(2),{category:'gcc_citizen',nationality:'kw'});assert.equal(await Document.countDocuments({ownerSubject:identity(2).subject}),0);
        qaEnv.MEMBERSHIP_AUTOMATED_REVIEW_ENABLED='true';
        await service.upload(identity(2),'passport',png,'image/png');await service.submit(identity(2),{consent:true});
        const {checkDigit}=require('../services/membershipEligibilityReader');
        const number='A1234567<',birth='900101',expiry='301231',optional='<'.repeat(14);
        const second=number+checkDigit(number)+'KWT'+birth+checkDigit(birth)+'F'+expiry+checkDigit(expiry)+optional+checkDigit(optional);
        const syntheticMrz={lines:[{text:'P<KWT'+'PROFESSIONAL<<SYNTHETIC'.padEnd(39,'<'),confidence:99},{text:second+checkDigit(second.slice(0,10)+second.slice(13,20)+second.slice(21,43)),confidence:99}]};
        const reviewWorker=require('../services/membershipReviewWorker').createMembershipReviewWorker({service,UserModel,Application,env:qaEnv,reader:{configured:()=>true,read:async()=>syntheticMrz}});
        await reviewWorker.flush();assert.equal((await service.status(identity(2))).canAccess,true);assert.equal((await service.status(identity(2))).application.automatedReview.phase,'completed');
        // Outbox uses stub SMTP and isolated collections, never the live transporter.
        let emails=0;
        const mailer=require('../services/membershipMail').createMembershipMailer({UserModel,Application,Notice,env:qaEnv,transporter:{sendMail:async message=>{assert.ok(message.to.endsWith('@example.test'));assert.equal(message.attachments,undefined);emails++;return {messageId:'synthetic-message',accepted:[message.to]};}}});
        for(let batch=0;batch<10&&await Notice.countDocuments({status:'pending'});batch++)await mailer.flush();
        assert.equal(await Notice.countDocuments({status:'pending'}),0);
        const first=emails;await mailer.flush();assert.equal(emails,first);assert.ok(emails>0);
        const pending=await Notice.create({applicationId:String((await Application.findOne({ownerSubject:identity(2).subject}))._id),ownerSubject:identity(2).subject,realm:prefix,revision:100,event:'submitted',status:'pending'});
        const uncertain=require('../services/membershipMail').createMembershipMailer({UserModel,Application,Notice,env:qaEnv,transporter:{sendMail:async()=>{throw Error('synthetic uncertain handoff');}}});
        await uncertain.flush();assert.equal((await Notice.findById(pending._id)).status,'unknown');await uncertain.flush();assert.equal((await Notice.findById(pending._id)).status,'unknown');
        return {passed:true,legacyAccess:true,concurrentSubmission:true,concurrentReview:true,documentEncryption:true,ownerAndRealmIsolation:true,retentionAndTTL:true,professionalDocuments:true,durableOutbox:true,automatedReviewWithSyntheticReader:true,actualOcrRuntimeVerified:false,realEmailsSent:0,realBookingsChanged:0};
    }finally{
        // Drop only the exact randomly generated synthetic collections in this run.
        for(const name of collections){assert.ok(name.startsWith(`${prefix}_`));await connection.dropCollection(name).catch(error=>{if(error.code!==26)throw error;});}
        await connection.close();
    }
}
module.exports={verifyMembershipSandbox};
if(require.main===module)verifyMembershipSandbox().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error('Membership sandbox verification failed:',error.message);process.exitCode=1;});
