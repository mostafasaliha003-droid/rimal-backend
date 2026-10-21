const mongoose=require('mongoose');
const schema=new mongoose.Schema({
    applicationId:{type:String,required:true},ownerSubject:{type:String,required:true},realm:{type:String,required:true},
    kind:{type:String,enum:['passport','eid_front','eid_back'],required:true},mime:String,size:Number,
    iv:{type:Buffer,select:false},tag:{type:Buffer,select:false},ciphertext:{type:Buffer,select:false},
    digest:{type:String,select:false},expiresAt:Date
},{timestamps:true});
schema.index({applicationId:1,realm:1,kind:1},{unique:true});
schema.index({expiresAt:1},{expireAfterSeconds:0});
module.exports=mongoose.models.MembershipDocument||mongoose.model('MembershipDocument',schema);
