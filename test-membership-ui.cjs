const assert=require('node:assert/strict');
const path=require('node:path');
const puppeteer=require('puppeteer');
async function run(){
    const browser=await puppeteer.launch({headless:true}),base=process.env.REMAL_UI_TEST_BASE||'http://127.0.0.1:5173';
    const reference='12345678-1234-4123-8123-123456789abc',token='a'.repeat(64),admin='b'.repeat(64),user={name:'Membership QA',email:'membership@example.test',phone:'+971500000000'};
    let application=null,loggedIn=false,inventory=0,uploads=0,reviews=0,statusBroken=false,notification=null;
    const errors=[];
    try{
        const page=await browser.newPage();await page.setBypassServiceWorker(true);page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);
        page.on('request',request=>{
            const url=new URL(request.url()),p=url.pathname;
            if(!p.includes('/api/'))return url.origin===base?request.continue():request.abort();
            const headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS'};
            const respond=(data,status=200)=>request.respond({status,headers,contentType:'application/json',body:JSON.stringify(data)});
            if(request.method()==='OPTIONS')return request.respond({status:204,headers});
            const staff=p.includes('/v1/admin/');
            if(p.endsWith('/membership/status'))return respond(statusBroken?{unexpected:true}:{enabled:true,authenticated:loggedIn,canAccess:Boolean(loggedIn&&application?.status==='approved'),user:loggedIn?user:null,application:loggedIn?application:null,notification});
            if(p.endsWith('/auth/login')){loggedIn=true;return respond({user,access_token:token});}
            if(p.endsWith('/auth/logout')){loggedIn=false;return respond({success:true});}
            if(p.endsWith('/v1/admin/session'))return respond({success:true});
            assert.equal(request.headers().authorization,`Bearer ${staff?admin:token}`);
            if(p.endsWith('/membership/application')){const body=JSON.parse(request.postData());application={...body,reference,status:'draft',revision:1,documents:[]};return respond({application});}
            if(p.includes('/application/documents/')){uploads++;application.documents=[{kind:p.split('/').pop(),mime:'image/png',size:68}];return respond({kind:'passport'});}
            if(p.endsWith('/application/submit')){assert.equal(JSON.parse(request.postData()).consent,true);application={...application,status:'submitted',revision:2};notification={status:'sent',event:'submitted'};return respond({application});}
            if(staff&&p.endsWith('/membership/applications'))return respond({applications:[{...application,applicant:user}],hasMore:false});
            if(staff&&p.endsWith(`/applications/${reference}`))return respond({application,applicant:user,events:[],notifications:[]});
            if(staff&&p.endsWith('/review')){const body=JSON.parse(request.postData());assert.equal(body.revision,application.revision);assert.equal(body.documentsVerified,true);reviews++;application={...application,status:'approved',revision:3};return respond({application});}
            if(staff&&p.includes(`/applications/${reference}/documents/`))return request.respond({status:200,headers,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
            inventory++;return respond({hotels:[],rates:{AED:1,USD:.2723},success:true});
        });
        await page.goto(`${base}/hotel/123?lang=en`,{waitUntil:'networkidle0'});
        await page.waitForSelector('.membership-tabs');assert.equal(inventory,0);
        assert.equal(await page.$eval('[data-membership-logo]',image=>image.complete&&image.naturalWidth>0&&new URL(image.src).pathname==='/logo.jpg'),true,'show the actual company logo');
        await page.click('.membership-audience summary');
        assert.equal(await page.$eval('.membership-audience',node=>node.open&&node.innerText.includes('UAE and GCC')),true,'eligibility is available before registration');
        await page.click('.membership-audience summary');
        await page.setViewport({width:1440,height:1000});await page.screenshot({path:path.join(__dirname,'logs/membership-desktop.png'),fullPage:true});
        await page.setViewport({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
        await page.screenshot({path:path.join(__dirname,'logs/membership-mobile.png'),fullPage:true});
        await page.setViewport({width:1440,height:1000});
        await page.goto(`${base}/?lang=ar`,{waitUntil:'networkidle0'});await page.waitForSelector('.membership-tabs');
        assert.equal(await page.$eval('.membership-site',node=>node.dir),'rtl');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
        assert.equal(await page.$eval('[data-membership-logo]',node=>{const rect=node.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth;}),true);
        await page.screenshot({path:path.join(__dirname,'logs/membership-desktop-ar.png'),fullPage:false,captureBeyondViewport:false});
        await page.setViewport({width:390,height:844});await page.screenshot({path:path.join(__dirname,'logs/membership-mobile-ar.png'),fullPage:true});
        await page.setViewport({width:320,height:720});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
        await page.goto(`${base}/hotel/123?lang=en`,{waitUntil:'networkidle0'});await page.waitForSelector('.membership-tabs');await page.setViewport({width:390,height:844});
        await page.type('input[type=email]',user.email);await page.type('input[type=password]','FixturePassword123');
        const click=async selector=>{await page.$eval(selector,n=>n.scrollIntoView({block:'center',behavior:'instant'}));await page.click(selector);};
        await click('.membership-form button[type=submit]');await page.waitForSelector('select[required]');
        await page.select('select[required]','ae');await click('.membership-form button[type=submit]');await page.waitForSelector('input[type=file]');
        // Browser-native File objects exercise the raw image upload request without real identity documents.
        await page.evaluate(()=>{const input=document.querySelector('input[type=file]'),dt=new DataTransfer();dt.items.add(new File([new Uint8Array([137,80,78,71])],'fixture.png',{type:'image/png'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
        await page.waitForFunction(()=>document.querySelector('.membership-upload.uploaded'));
        await click('input[type=checkbox]');await click('.membership-form button[type=submit]');await page.waitForSelector('[data-membership-status=submitted]');assert.equal(uploads,1);assert.equal(inventory,0);
        // Review through the real staff UI with a separately authenticated role.
        await page.evaluate(value=>sessionStorage.setItem('rimal_admin_access_token',value),admin);
        await page.goto(`${base}/membership-admin?lang=en`,{waitUntil:'networkidle0'});await page.waitForSelector('.membership-admin-list button');await click('.membership-admin-list button');await page.waitForSelector('.membership-admin-documents button');
        assert.equal(await page.$eval('.membership-admin-detail',n=>n.innerText.includes('membership@example.test')),true);
        assert.equal(await page.$eval('.membership-admin-actions .membership-primary',n=>n.disabled),true);
        await click('.membership-admin-documents button');await page.waitForSelector('.membership-document-modal img');await page.keyboard.press('Escape');
        await click('.membership-admin-review input[type=checkbox]');await click('.membership-admin-actions .membership-primary');await page.waitForFunction(()=>document.querySelector('.membership-admin-status')?.innerText.includes('approved'));assert.equal(reviews,1);
        await page.goto(`${base}/membership?lang=en`,{waitUntil:'networkidle0'});await page.waitForSelector('[data-membership-status=approved]');assert.equal(inventory,0);
        application.status='suspended';await page.evaluate(()=>window.dispatchEvent(new Event('remal:membership-required')));await page.waitForSelector('[data-membership-status=suspended]');assert.equal(inventory,0);
        statusBroken=true;await page.evaluate(()=>window.dispatchEvent(new Event('remal:membership-required')));await page.waitForSelector('[role=alert]');assert.equal(await page.$('.membership-tabs'),null);assert.equal(inventory,0);
        assert.deepEqual(errors,[]);console.log('PASS: membership UI anonymous gate, mobile layout, applicant upload/submit, protected staff review, approval, revocation and fail-closed outage.');
    }finally{await browser.close();}
}
module.exports={run};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
