const {bearerToken}=require('./sessionAuthMiddleware');
const {rateLimit}=require('express-rate-limit');
function publicApi(req){
    const path=req.path.replace(/\/+$/,''),method=req.method;
    if(method==='OPTIONS')return true;
    if(method==='GET'&&['/api/v1/ready','/api/v1/health','/api/v1/health-check'].includes(path))return true;
    if(path.startsWith('/api/auth/')||path.startsWith('/api/membership/'))return true;
    if(method==='POST'&&path==='/api/v1/admin/login')return true;
    if(method==='POST'&&['/api/payment/ziina/webhook','/api/v1/webhooks/ziina-mock','/api/v1/webhooks/ratehawk','/api/v1/webhooks/midoffice'].includes(path))return true;
    // These existing endpoints independently enforce owner identity or a scoped
    // booking capability. Membership changes must not strand an existing payment.
    if(method==='GET'&&/^\/api\/payment\/ziina\/[a-f\d-]+\/status$/.test(path))return true;
    if(method==='GET'&&/^\/api\/v1\/hotels\/checkout\/[a-f\d-]+$/.test(path))return true;
    if(method==='GET'&&/^\/api\/affiliate\/bookings\/[^/]+\/status$/.test(path))return true;
    if(path.startsWith('/api/owned/')||path.startsWith('/api/support/'))return true;
    if(path==='/api/user/profile')return true;
    return false;
}
function createMembershipAccessGate({service,sessions}){
    const limiter=rateLimit({windowMs:60000,max:90,standardHeaders:true,legacyHeaders:false,message:{error:'membership_rate_limited'}});
    const check=async(req,res,next)=>{
        if(!service.enabled()||!req.path.startsWith('/api/')||publicApi(req))return next();
        res.set({'Cache-Control':'no-store',Vary:'Authorization'});
        const token=bearerToken(req);if(!token)return res.status(401).json({error:'membership_authentication_required'});
        try{
            const identity=await sessions.resolve(token);
            if(!identity)return res.status(401).json({error:'membership_authentication_required'});
            if(identity.role==='admin')return next();
            if(identity.role!=='user')return res.status(403).json({error:'membership_approval_required'});
            const {row}=await service.application(identity);
            if(row?.status!=='approved')return res.status(403).json({error:'membership_approval_required'});
            return next();
        }catch{return res.status(503).json({error:'membership_access_unavailable'});}
    };
    return (req,res,next)=>!service.enabled()||!req.path.startsWith('/api/')||publicApi(req)?next():limiter(req,res,()=>void check(req,res,next));
}
module.exports={createMembershipAccessGate,publicApi};
