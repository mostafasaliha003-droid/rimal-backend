const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {DIRECTORY,MODELS,modelValid}=require('../services/membershipOcrModels');
async function prepareMembershipOcr(env=process.env){
    if(env.MEMBERSHIP_OCR_ENGINE!=='wasm'||env.MEMBERSHIP_OCR_ENABLED!=='true')return {enabled:false};
    await fs.mkdir(DIRECTORY,{recursive:true});
    for(const language of Object.keys(MODELS)){
        if(modelValid(language))continue;
        const response=await fetch(`https://tessdata.projectnaptha.com/4.0.0_fast/${language}.traineddata.gz`,{signal:AbortSignal.timeout(45000),redirect:'error'});
        if(!response.ok)throw Error('membership_ocr_model_download_failed');
        const buffer=Buffer.from(await response.arrayBuffer());
        if(buffer.length>12*1024*1024||crypto.createHash('sha256').update(buffer).digest('hex')!==MODELS[language])throw Error('membership_ocr_model_integrity_failed');
        const target=path.join(DIRECTORY,`${language}.traineddata.gz`),temp=`${target}.download`;
        await fs.writeFile(temp,buffer);await fs.rename(temp,target);
    }
    return {enabled:true,languages:Object.keys(MODELS),verified:true};
}
module.exports={prepareMembershipOcr};
if(require.main===module)prepareMembershipOcr().then(result=>console.log('Membership OCR models:',JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
