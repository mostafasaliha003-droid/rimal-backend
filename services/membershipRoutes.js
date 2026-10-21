const express=require('express');
const {rateLimit}=require('express-rate-limit');
const {bearerToken}=require('./sessionAuthMiddleware');
const {MAX_BYTES}=require('./membershipDocuments');
const uuid=/^[a-f\d-]{36}$/i;
function createMembershipRouters({service,sessions,auth,UserModel,Application=require('../models/MembershipApplication'),Document=require('../models/MembershipDocument'),Audit=require('../models/MembershipAudit'),Notice=require('../models/MembershipNotice'),env=process.env}){
    const customer=express.Router(),staff=express.Router();
    const limit=rateLimit({windowMs:60000,max:40,standardHeaders:true,legacyHeaders:false});
    const writeLimit=rateLimit({windowMs:60000,max:12,standardHeaders:true,legacyHeaders:false});
    const handle=fn=>async(req,res)=>{res.set({'Cache-Control':'no-store',Pragma:'no-cache'});try{await fn(req,res);}catch(e){res.status(e.httpStatus||503).json({error:e.code||'membership_unavailable'});}};
    customer.get('/offers',limit,handle(async(_req,res)=>res.json({offers:require('./membershipOffers').activeMembershipOffers(),checkedAt:new Date().toISOString()})));
    customer.get('/status',limit,handle(async(req,res)=>{
        if(!service.enabled())return res.json({enabled:false});
        const token=bearerToken(req),identity=token?await sessions.resolve(token):null;
        if(!identity||identity.role!=='user')return res.json({enabled:true,authenticated:false,canAccess:false});
        return res.json(await service.status(identity));
    }));
    customer.use(auth.requireRole('user'));
    customer.put('/application',writeLimit,handle(async(req,res)=>res.json({application:await service.saveDraft(req.auth,req.body||{})})));
    customer.put('/application/documents/:kind',writeLimit,express.raw({type:['image/jpeg','image/png'],limit:MAX_BYTES}),handle(async(req,res)=>{
        if(!['passport','eid_front','eid_back'].includes(req.params.kind))return res.status(400).json({error:'invalid_document_kind'});
        return res.json(await service.upload(req.auth,req.params.kind,req.body,req.get('Content-Type')?.split(';')[0]));
    }));
    customer.post('/application/submit',writeLimit,handle(async(req,res)=>res.json({application:await service.submit(req.auth,req.body||{})})));
    const image=async(req,res)=>{
        if(!uuid.test(req.params.reference)||!['passport','eid_front','eid_back'].includes(req.params.kind))return res.status(404).end();
        const file=await service.document(req.auth,req.params.reference,req.params.kind);
        return res.set({'Content-Type':file.mime,'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename="${req.params.kind}.${file.mime==='image/png'?'png':'jpg'}"`}).send(file.buffer);
    };
    customer.get('/applications/:reference/documents/:kind',limit,handle(image));
    customer.use((err,_req,res,_next)=>res.status(err.type==='entity.too.large'?413:400).json({error:err.type==='entity.too.large'?'document_too_large':'invalid_document_image'}));
    staff.use(auth.requireRole('admin'));
    staff.get('/applications',limit,handle(async(req,res)=>{
        const statuses=['draft','submitted','under_review','needs_information','approved','rejected','suspended'];
        const filter={realm:req.auth.realm};if(req.query.status&&req.query.status!=='all'){if(!statuses.includes(req.query.status))return res.status(400).json({error:'invalid_status'});filter.status=req.query.status;}
        const rows=await Application.find(filter).sort({submittedAt:-1,createdAt:-1}).limit(101).lean();
        const users=await UserModel.find({_id:{$in:rows.slice(0,100).map(row=>row.ownerSubject)}}).select('name email phone').lean();
        const byId=new Map(users.map(user=>[String(user._id),user]));
        return res.json({applications:rows.slice(0,100).map(row=>({...service.publicApplication(row),applicant:byId.get(row.ownerSubject)?{name:byId.get(row.ownerSubject).name,email:byId.get(row.ownerSubject).email,phone:byId.get(row.ownerSubject).phone||''}:null})),hasMore:rows.length>100});
    }));
    staff.get('/applications/:reference',limit,handle(async(req,res)=>{
        if(!uuid.test(req.params.reference))return res.status(404).end();
        const row=await Application.findOne({reference:req.params.reference,realm:req.auth.realm}).lean();if(!row)return res.status(404).json({error:'application_not_found'});
        const [user,docs,events]=await Promise.all([UserModel.findById(row.ownerSubject).select('name email phone createdAt').lean(),Document.find({applicationId:String(row._id),realm:req.auth.realm}).select('kind mime size expiresAt updatedAt').lean(),Audit.find({applicationId:String(row._id),realm:req.auth.realm}).sort({at:-1}).limit(50).lean()]);
        const notifications=await Notice.find({applicationId:String(row._id),realm:req.auth.realm}).sort({createdAt:-1}).limit(10).select('event status createdAt sentAt').lean();
        return res.json({application:service.publicApplication(row,docs),applicant:user?{name:user.name,email:user.email,phone:user.phone||'',createdAt:user.createdAt}:null,notifications:notifications.map(n=>({event:n.event,status:n.status,createdAt:n.createdAt,sentAt:n.sentAt})),events:events.map(event=>({event:event.event,kind:event.kind,at:event.at,actor:event.actor,role:event.role}))});
    }));
    staff.post('/applications/:reference/review',writeLimit,handle(async(req,res)=>{
        if(!uuid.test(req.params.reference))return res.status(404).end();
        return res.json({application:await service.review(req.auth,req.params.reference,req.body||{})});
    }));
    staff.get('/applications/:reference/documents/:kind',limit,handle(image));
    return {customer,staff};
}
module.exports={createMembershipRouters};
