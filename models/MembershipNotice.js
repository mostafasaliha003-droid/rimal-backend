const mongoose=require('mongoose');
const schema=new mongoose.Schema({applicationId:String,ownerSubject:String,realm:String,revision:Number,event:String,publicNote:String,
    status:{type:String,enum:['pending','sending','sent','unknown','failed','superseded'],default:'pending'},claimedAt:Date,sentAt:Date,
    createdAt:{type:Date,default:Date.now}},{versionKey:false});
schema.index({applicationId:1,realm:1,revision:1,event:1},{unique:true});
module.exports=mongoose.models.MembershipNotice||mongoose.model('MembershipNotice',schema);
