const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const DIRECTORY=path.resolve(__dirname,'../.cache/membership-ocr');
const MODELS=Object.freeze({eng:'18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b',ara:'cfdec92af6c72289984b03dfe5e03d25f7fee591733081aa6f40761f3f5884cf'});
function modelValid(language){try{return crypto.createHash('sha256').update(fs.readFileSync(path.join(DIRECTORY,`${language}.traineddata.gz`))).digest('hex')===MODELS[language];}catch{return false;}}
module.exports={DIRECTORY,MODELS,modelValid};
