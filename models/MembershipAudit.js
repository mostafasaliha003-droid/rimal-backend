const mongoose=require('mongoose');
const schema=new mongoose.Schema({applicationId:String,realm:String,actor:String,role:String,event:String,kind:String,revision:Number,at:{type:Date,default:Date.now}},{versionKey:false});
schema.index({applicationId:1,realm:1,at:-1});
module.exports=mongoose.models.MembershipAudit||mongoose.model('MembershipAudit',schema);
