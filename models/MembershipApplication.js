const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    reference: { type:String, required:true, unique:true },
    ownerSubject: { type:String, required:true }, realm: { type:String, required:true },
    status: { type:String, enum:['draft','submitted','under_review','needs_information','approved','rejected','suspended'], default:'draft', index:true },
    revision: { type:Number, default:0 }, category:String, nationality:String, profession:String, professionTitle:String,
    consentAt:Date, consentVersion:String, submittedAt:Date, reviewedAt:Date, reviewer:String,
    publicNote:{type:String,default:''}, internalNote:{type:String,default:'',select:false},
    grandfathered:{type:Boolean,default:false}, language:{type:String,default:'ar'},
    documentsDeleteAt:Date,
    automatedReview:{phase:{type:String,enum:['queued','starting','reading_passport','reading_id_front','reading_id_back','matching','needs_review','completed']},reason:String,updatedAt:Date,lease:{type:String,select:false},leaseUntil:{type:Date,select:false}}
}, { timestamps:true });
schema.index({ownerSubject:1,realm:1},{unique:true});
module.exports=mongoose.models.MembershipApplication||mongoose.model('MembershipApplication',schema);
