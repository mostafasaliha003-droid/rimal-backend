const crypto=require('node:crypto');
const {fail,imageMetadata,encryptDocument,decryptDocument,encryptionKey}=require('./membershipDocuments');
const GCC=new Set(['ae','sa','kw','qa','bh','om']);
const PROFESSIONS=new Set(['doctor','engineer','nurse','manager','supervisor','administrative']);
const EDITABLE=new Set(['draft','needs_information']);
const COUNTRIES=new Set(require('../shared/ratehawkResidencies.json'));
const requiredDocuments=category=>category==='gcc_citizen'?['passport']:category==='uae_professional'?['eid_front','eid_back']:[];
function validateEligibility(body){
    const category=body.category,nationality=String(body.nationality||'').toLowerCase(),profession=String(body.profession||''),professionTitle=String(body.professionTitle||'').trim();
    if(!COUNTRIES.has(nationality))throw fail('nationality_required');
    if(category==='gcc_citizen'){if(!GCC.has(nationality))throw fail('invalid_eligibility_category');}
    else if(category==='uae_professional'){if(GCC.has(nationality)||!PROFESSIONS.has(profession)||professionTitle.length<2||professionTitle.length>160)throw fail('profession_required');}
    else throw fail('invalid_eligibility_category');
    return {category,nationality,profession:category==='uae_professional'?profession:'',professionTitle:category==='uae_professional'?professionTitle:''};
}
function publicApplication(row,documents=[]){
    if(!row)return null;
    return {reference:row.reference,status:row.status,revision:row.revision,category:row.category||'',nationality:row.nationality||'',profession:row.profession||'',professionTitle:row.professionTitle||'',
        submittedAt:row.submittedAt||null,reviewedAt:row.reviewedAt||null,updatedAt:row.updatedAt||null,publicNote:row.publicNote||'',grandfathered:row.grandfathered===true,
        documentsDeleteAt:row.documentsDeleteAt||null,automatedReview:row.automatedReview?.phase?{phase:row.automatedReview.phase,updatedAt:row.automatedReview.updatedAt||null}:null,documents:documents.filter(d=>!d.expiresAt||new Date(d.expiresAt)>new Date()).map(d=>({kind:d.kind,size:d.size,mime:d.mime,uploadedAt:d.updatedAt}))};
}
function createMembershipService({UserModel,Application=require('../models/MembershipApplication'),Document=require('../models/MembershipDocument'),Audit=require('../models/MembershipAudit'),Notice=require('../models/MembershipNotice'),env=process.env,transaction}={}){
    const atomic=transaction|| (async work=>{const session=await Application.db.startSession();try{return await session.withTransaction(()=>work(session));}finally{await session.endSession();}});
    const enabled=()=>env.PRIVATE_MEMBERSHIP_ENABLED==='true';
    const scoped=identity=>({ownerSubject:identity.subject,realm:identity.realm});
    const audit=async(row,identity,event,kind,session)=>{const entry={applicationId:String(row._id),realm:row.realm,actor:identity.subject,role:identity.role,event,kind,revision:row.revision};return session?Audit.create([entry],{session}):Audit.create(entry);};
    async function account(identity){const user=await UserModel.findById(identity.subject).lean();if(!user||user.email!==identity.email)throw fail('unauthorized',401);return user;}
    async function application(identity,{create=false}={}){
        const user=await account(identity),scope=scoped(identity);
        let row=await Application.findOne(scope).lean();
        const cutoff=new Date(env.MEMBERSHIP_EXISTING_USERS_BEFORE||'');
        const legacy=Number.isFinite(cutoff.getTime())&&user.createdAt&&new Date(user.createdAt)<=cutoff;
        if(!row&&(create||legacy)){
            try{row=await Application.findOneAndUpdate(scope,{$setOnInsert:{...scope,reference:crypto.randomUUID(),status:legacy?'approved':'draft',revision:0,grandfathered:Boolean(legacy),...(legacy?{reviewedAt:new Date()}:{} )}},{upsert:true,new:true}).lean();}
            catch(error){if(error.code!==11000)throw error;row=await Application.findOne(scope).lean();}
        }
        return {user,row};
    }
    async function status(identity){
        const {user,row}=await application(identity);
        const documents=row?await Document.find({applicationId:String(row._id),realm:identity.realm}).select('kind size mime expiresAt updatedAt').lean():[];
        const notices=row?await Notice.find({applicationId:String(row._id),realm:identity.realm}).sort({createdAt:-1}).limit(1).select('status event').lean():[];
        return {enabled:enabled(),authenticated:true,canAccess:row?.status==='approved',user:{name:user.name,email:user.email,phone:user.phone||''},application:publicApplication(row,documents),notification:notices[0]?{status:notices[0].status,event:notices[0].event}:null};
    }
    async function saveDraft(identity,body){return atomic(async session=>{
        const data=validateEligibility(body),{row}=await application(identity,{create:true});
        if(!EDITABLE.has(row.status))throw fail('application_locked',409);
        const updated=await Application.findOneAndUpdate({_id:row._id,...scoped(identity),status:row.status,revision:row.revision},{$set:{...data,language:['ar','en','es'].includes(body.language)?body.language:'ar'},$inc:{revision:1}},{new:true,session}).lean();
        if(!updated)throw fail('application_changed',409);
        await Document.deleteMany({applicationId:String(row._id),realm:row.realm,kind:{$nin:requiredDocuments(data.category)}},{session});
        await audit(updated,identity,'details_updated',undefined,session);return publicApplication(updated);
    });}
    async function upload(identity,kind,buffer,mime){return atomic(async session=>{
        const {row}=await application(identity);
        if(!row||!EDITABLE.has(row.status)||!requiredDocuments(row.category).includes(kind))throw fail('document_upload_not_allowed',409);
        const metadata=imageMetadata(buffer,mime),applicationId=String(row._id),encrypted=encryptDocument(buffer,{realm:identity.realm,applicationId,kind},env);
        // Optimistic revision claim serializes uploads against submission and review.
        const claim=await Application.findOneAndUpdate({_id:row._id,...scoped(identity),status:row.status,revision:row.revision},{$inc:{revision:1}},{new:true,session}).lean();
        if(!claim)throw fail('application_changed',409);
        await Document.findOneAndUpdate({applicationId,realm:identity.realm,kind},{$set:{ownerSubject:identity.subject,...metadata,...encrypted,expiresAt:new Date(Date.now()+86400000)}},{upsert:true,new:true,session});
        await audit(claim,identity,'document_uploaded',kind,session);return {kind,size:metadata.size,mime};
    });}
    async function submit(identity,body){return atomic(async session=>{
        encryptionKey(env);
        const {row}=await application(identity);
        if(row&&['submitted','under_review','approved'].includes(row.status))return publicApplication(row);
        if(!row||!EDITABLE.has(row.status))throw fail('application_locked',409);
        validateEligibility(row);
        if(body.consent!==true)throw fail('consent_required');
        const docs=await Document.find({applicationId:String(row._id),realm:identity.realm,ownerSubject:identity.subject,$or:[{expiresAt:null},{expiresAt:{$gt:new Date()}}]}).select('kind').session(session).lean();
        if(!requiredDocuments(row.category).every(kind=>docs.some(doc=>doc.kind===kind)))throw fail('documents_required');
        const updated=await Application.findOneAndUpdate({_id:row._id,...scoped(identity),revision:row.revision,status:row.status},{$set:{status:'submitted',submittedAt:new Date(),consentAt:new Date(),consentVersion:'membership-v1',documentsDeleteAt:null,...(env.MEMBERSHIP_AUTOMATED_REVIEW_ENABLED==='true'?{automatedReview:{phase:'queued',updatedAt:new Date()}}:{})},$inc:{revision:1}},{new:true,session}).lean();
        if(!updated)throw fail('application_changed',409);
        await Document.updateMany({applicationId:String(row._id),realm:identity.realm},{$set:{expiresAt:null}},{session});
        await audit(updated,identity,'submitted',undefined,session);await enqueue(updated,'submitted',session);return publicApplication(updated,docs);
    });}
    async function enqueue(row,event,session){await Notice.updateOne({applicationId:String(row._id),realm:row.realm,revision:row.revision,event},{$setOnInsert:{ownerSubject:row.ownerSubject,publicNote:row.publicNote||'',status:'pending',createdAt:new Date()}},{upsert:true,session});}
    async function review(identity,reference,body){return atomic(async session=>{
        if(identity.role!=='admin')throw fail('unauthorized',401);
        const row=await Application.findOne({reference,realm:identity.realm}).lean();if(!row)throw fail('application_not_found',404);
        const actions={start_review:'under_review',request_information:'needs_information',approve:'approved',reject:'rejected',suspend:'suspended'};
        const status=actions[body.action];
        const allowed=body.action==='suspend'?row.status==='approved':body.action==='start_review'?row.status==='submitted':body.action==='request_information'?['submitted','under_review','suspended'].includes(row.status):['submitted','under_review','needs_information'].includes(row.status);
        if(!status||!allowed||body.revision!==row.revision)throw fail('application_changed',409);
        const publicNote=typeof body.publicNote==='string'?body.publicNote.trim():'';
        if(publicNote.length>1000||(['needs_information','rejected','suspended'].includes(status)&&publicNote.length<5))throw fail('review_note_required');
        if(status==='approved'){
            if(body.documentsVerified!==true)throw fail('manual_verification_required');
            const docs=await Document.find({applicationId:String(row._id),realm:row.realm,$or:[{expiresAt:null},{expiresAt:{$gt:new Date()}}]}).select('kind').session(session).lean();
            if(!requiredDocuments(row.category).length||!requiredDocuments(row.category).every(kind=>docs.some(doc=>doc.kind===kind)))throw fail('documents_required');
        }
        const final=['approved','rejected','suspended'].includes(status),deadline=new Date(Date.now()+30*86400000),documentsDeleteAt=final?new Date(Math.min(deadline.getTime(),row.documentsDeleteAt?new Date(row.documentsDeleteAt).getTime():Infinity)):null;
        const updated=await Application.findOneAndUpdate({_id:row._id,realm:identity.realm,status:row.status,revision:row.revision},{$set:{status,publicNote,reviewer:identity.subject,...(final?{reviewedAt:new Date(),documentsDeleteAt}: {})},$inc:{revision:1}},{new:true,session}).lean();
        if(!updated)throw fail('application_changed',409);
        if(final)await Document.updateMany({applicationId:String(row._id),realm:row.realm,$or:[{expiresAt:null},{expiresAt:{$gt:documentsDeleteAt}}]},{$set:{expiresAt:documentsDeleteAt}},{session});
        await audit(updated,identity,status,undefined,session);await enqueue(updated,status,session);return publicApplication(updated);
    });}
    async function document(identity,reference,kind){
        const filter={reference,realm:identity.realm,...(identity.role==='admin'?{}:{ownerSubject:identity.subject})};
        const row=await Application.findOne(filter).lean();if(!row)throw fail('document_not_found',404);
        const doc=await Document.findOne({applicationId:String(row._id),realm:identity.realm,kind,$or:[{expiresAt:null},{expiresAt:{$gt:new Date()}}]}).select('+iv +tag +ciphertext +digest').lean();
        if(!doc)throw fail('document_not_found',404);
        await audit(row,identity,'document_viewed',kind);return {buffer:decryptDocument(doc,env),mime:doc.mime};
    }
    return {enabled,status,application,saveDraft,upload,submit,review,document,enqueue,publicApplication,requiredDocuments};
}
module.exports={createMembershipService,validateEligibility,publicApplication,requiredDocuments,GCC,PROFESSIONS};
