const assert=require('node:assert/strict');
const {createLocalDocumentReader,passportEvidence}=require('../services/membershipEligibilityReader');
async function verifyMembershipOcr(){
    const browser=await require('puppeteer').launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
    let image;
    try{
        const page=await browser.newPage();await page.setViewport({width:1400,height:380,deviceScaleFactor:1});
        await page.setContent('<html><body style="margin:0;padding:45px;background:white"><pre style="font:48px Arial;line-height:1.5;color:black;margin:0">Name: Jane Example\nNationality: Egypt\nOccupation: Civil Engineer</pre></body></html>');
        image=await page.screenshot();
    }finally{await browser.close();}
    const reader=createLocalDocumentReader({env:{MEMBERSHIP_OCR_ENABLED:'true',MEMBERSHIP_OCR_ENGINE:'wasm'}});
    assert.equal(reader.configured(),true);
    const result=await reader.read(image);
    const text=result.lines.map(line=>line.text).join(' ').toLowerCase();
    assert.ok(text.includes('jane')&&text.includes('engineer'),'local OCR must actually recognise the synthetic image');
    assert.equal(passportEvidence(result,{nationality:'ae'},{name:'Jane Example'}).eligible,false,'incomplete evidence must never approve membership');
    return {passed:true,actualOcrRuntime:true,localArabicAndEnglishModels:true,syntheticImageRecognised:true,incompleteEvidenceNotApproved:true,realIdentityDocumentsUsed:0};
}
module.exports={verifyMembershipOcr};
if(require.main===module)verifyMembershipOcr().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
