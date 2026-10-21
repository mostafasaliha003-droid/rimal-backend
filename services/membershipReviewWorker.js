const crypto=require('node:crypto');
const {createLocalDocumentReader,passportEvidence,professionalEvidence}=require('./membershipEligibilityReader');
function createMembershipReviewWorker({service,UserModel,Application=require('../models/MembershipApplication'),env=process.env,reader=createLocalDocumentReader({env})}){
    const realm=env.RIMAL_AUTH_REALM;
    let stopped=false,current=null;
    async function phase(row,lease,value){
        const result=await Application.updateOne({_id:row._id,realm,status:'under_review','automatedReview.lease':lease},{$set:{'automatedReview.phase':value,'automatedReview.updatedAt':new Date()}});
        if(result.modifiedCount!==1)throw Error('review_interrupted');
    }
    async function flush(){
        if(stopped||env.MEMBERSHIP_AUTOMATED_REVIEW_ENABLED!=='true'||!realm||!reader.configured())return;
        // An interrupted review returns to staff; the UI never invents progress.
        await Application.updateMany({realm,status:{$in:['submitted','under_review']},'automatedReview.leaseUntil':{$lt:new Date()},'automatedReview.phase':{$nin:['completed','needs_review']}},{$set:{'automatedReview.phase':'needs_review','automatedReview.reason':'review_interrupted','automatedReview.updatedAt':new Date()}});
        const lease=crypto.randomUUID(),candidate=await Application.findOneAndUpdate({realm,status:'submitted','automatedReview.phase':'queued'},{$set:{'automatedReview.lease':lease,'automatedReview.leaseUntil':new Date(Date.now()+180000),'automatedReview.phase':'starting','automatedReview.updatedAt':new Date()}},{new:true,sort:{submittedAt:1}}).lean();
        if(!candidate)return;
        const reviewer={subject:'membership-eligibility-reader',role:'admin',realm};
        let row=candidate;
        try{
            await service.review(reviewer,row.reference,{action:'start_review',revision:row.revision});
            row=await Application.findOne({_id:row._id,realm,'automatedReview.lease':lease,status:'under_review'}).lean();if(!row)return;
            const user=await UserModel.findById(row.ownerSubject).lean();if(!user)throw Error('account_unavailable');
            let evidence;
            if(row.category==='gcc_citizen'){
                await phase(row,lease,'reading_passport');const image=await service.document(reviewer,row.reference,'passport');
                const result=await reader.read(image.buffer,{documentKind:'passport'});await phase(row,lease,'matching');evidence=passportEvidence(result,row,user);
            }else if(row.category==='uae_professional'){
                await phase(row,lease,'reading_id_front');const front=await service.document(reviewer,row.reference,'eid_front');const first=await reader.read(front.buffer);
                await phase(row,lease,'reading_id_back');const back=await service.document(reviewer,row.reference,'eid_back');const second=await reader.read(back.buffer);
                await phase(row,lease,'matching');evidence=professionalEvidence(first,second,row,user);
            }else throw Error('category_needs_review');
            if(!evidence.eligible){await phase(row,lease,'needs_review');await Application.updateOne({_id:row._id,realm,'automatedReview.lease':lease},{$set:{'automatedReview.reason':evidence.reason}});return;}
            // Recheck the lease and revision. A staff decision always wins a race.
            const latest=await Application.findOne({_id:row._id,realm,status:'under_review',revision:row.revision,'automatedReview.lease':lease,'automatedReview.leaseUntil':{$gt:new Date()}}).lean();if(!latest)return;
            await service.review(reviewer,row.reference,{action:'approve',revision:latest.revision,documentsVerified:true});
            await Application.updateOne({_id:row._id,realm,status:'approved','automatedReview.lease':lease},{$set:{'automatedReview.phase':'completed','automatedReview.reason':evidence.reason,'automatedReview.updatedAt':new Date()}});
        }catch{
            await Application.updateOne({_id:candidate._id,realm,status:{$in:['submitted','under_review']},'automatedReview.lease':lease},{$set:{'automatedReview.phase':'needs_review','automatedReview.reason':'reading_needs_review','automatedReview.updatedAt':new Date()}});
        }
    }
    function start(){stopped=false;const tick=()=>{if(stopped||current)return;current=flush().catch(()=>{}).finally(()=>{current=null;});};tick();const timer=setInterval(tick,4000);timer.unref?.();return async()=>{stopped=true;clearInterval(timer);await current;};}
    return {flush,start};
}
module.exports={createMembershipReviewWorker};
