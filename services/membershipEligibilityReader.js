// Eligibility uses written document fields only. OCR is not document authenticity verification.
const {spawn}=require('node:child_process');
const countries=require('../shared/ratehawkResidencies.json');
const gccNationality={ARE:'ae',SAU:'sa',KWT:'kw',QAT:'qa',BHR:'bh',OMN:'om'};
const clean=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').toLowerCase().replace(/[^a-z\u0621-\u064a0-9]+/g,' ').trim();
function sameName(account,written){const parts=clean(account).split(' ').filter(Boolean),document=new Set(clean(written).split(' '));return parts.length>=2&&parts.every(part=>document.has(part));}
const checkDigit=value=>String([...value].reduce((sum,char,i)=>sum+(char==='<'?0:/\d/.test(char)?Number(char):char.charCodeAt(0)-55)*[7,3,1][i%3],0)%10);
function mrzDate(value,{expiry=false,now=new Date()}={}){
    if(!/^\d{6}$/.test(value))return null;
    let year=2000+Number(value.slice(0,2));if(!expiry&&year>now.getUTCFullYear())year-=100;
    const month=Number(value.slice(2,4)),day=Number(value.slice(4,6)),date=new Date(Date.UTC(year,month-1,day));
    return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date:null;
}
function passportEvidence(result,application,user,now=new Date()){
    const candidates=result.lines.filter(line=>line.confidence>=90).map(line=>line.text.replace(/\s/g,'').toUpperCase());
    const first=candidates.find(line=>/^P<[A-Z<]{3}[A-Z<]{39}$/.test(line));
    const second=candidates.find(line=>/^[A-Z0-9<]{9}\d[A-Z<]{3}\d{6}\d[MF<]\d{6}\d[A-Z0-9<]{14}[\d<]\d$/.test(line));
    if(!first||!second)return {eligible:false,reason:'passport_fields_unclear'};
    if(checkDigit(second.slice(0,9))!==second[9]||checkDigit(second.slice(13,19))!==second[19]||checkDigit(second.slice(21,27))!==second[27]||checkDigit(second.slice(28,42))!==(second[42]==='<'?'0':second[42])||checkDigit(second.slice(0,10)+second.slice(13,20)+second.slice(21,43))!==second[43])return {eligible:false,reason:'passport_checks_need_review'};
    const nationality=gccNationality[second.slice(10,13)],expiry=mrzDate(second.slice(21,27),{expiry:true,now}),birth=mrzDate(second.slice(13,19),{now});
    const today=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
    if(!nationality||nationality!==application.nationality||!expiry||expiry<today||expiry.getUTCFullYear()>now.getUTCFullYear()+15||!birth||birth>now||!sameName(user.name,first.slice(5).replace(/</g,' ')))return {eligible:false,reason:'passport_match_needs_review'};
    return {eligible:true,reason:'gcc_passport_fields_match'};
}
function field(result,pattern){
    const lines=result.lines||[];
    for(let i=0;i<lines.length;i++){
        if(lines[i].confidence<90)continue;
        const match=pattern.exec(lines[i].text);if(!match)continue;
        const own=lines[i].text.slice(match.index+match[0].length).replace(/^\s*[:：-]?\s*/,'').trim();
        if(own)return own;
        if(lines[i+1]?.confidence>=90)return lines[i+1].text.trim();
    }
    return '';
}
function professionalEvidence(front,back,application,user,now=new Date()){
    const id=result=>result.lines.filter(line=>line.confidence>=90).flatMap(line=>line.text.match(/784[\s-]?\d{4}[\s-]?\d{7}[\s-]?\d/g)||[]).map(value=>value.replace(/\D/g,''));
    const frontIds=id(front),backIds=id(back);
    if(!frontIds.some(value=>backIds.includes(value)))return {eligible:false,reason:'id_sides_need_review'};
    const name=field(front,/\bName\b\s*:?|الاسم\s*:?/i);
    const nationality=field(front,/\bNationality\b\s*:?|الجنسي[ةه]\s*:?/i);
    const expiryText=field(front,/(?:\bExpiry Date\b|\bExpiration Date\b|تاريخ الانتهاء)\s*:?/i);
    const occupation=field(back,/(?:\bOccupation\b|\bProfession\b|المهن[ةه])\s*:?/i);
    const dateMatch=expiryText.match(/\b(\d{2})[\/.-](\d{2})[\/.-](\d{4})\b/);
    const expiry=dateMatch?new Date(Date.UTC(Number(dateMatch[3]),Number(dateMatch[2])-1,Number(dateMatch[1]))):null;
    if(!expiry||expiry.getUTCDate()!==Number(dateMatch[1])||expiry.getUTCMonth()!==Number(dateMatch[2])-1||expiry<new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())))return {eligible:false,reason:'id_expiry_needs_review'};
    if(!sameName(user.name,name)||!countries.includes(application.nationality)||Object.values(gccNationality).includes(application.nationality))return {eligible:false,reason:'id_identity_needs_review'};
    const names=['en','ar'].map(language=>new Intl.DisplayNames([language],{type:'region'}).of(application.nationality.toUpperCase()));
    if(!names.some(value=>clean(nationality)===clean(value)))return {eligible:false,reason:'id_nationality_needs_review'};
    // A free-text occupation may be submitted, but eligibility for "other" is
    // decided by staff. Matching the applicant's text alone never grants access.
    if(application.profession==='other')return {eligible:false,reason:'id_other_occupation_needs_review'};
    const professions={doctor:/\b(?:doctor|physician)\b|طبيب|دكتور/,engineer:/\bengineer\b|مهندس/,nurse:/\bnurse\b|ممرض/,manager:/\bmanager\b|مدير/,supervisor:/\bsupervisor\b|مشرف/,administrative:/\b(?:administrator|administrative)\b|اداري/,
        student:/\bstudent\b|(?:^| )(?:طالب|طالبه)(?: |$)/,
        teacher:/\b(?:teacher|schoolteacher|educator)\b|(?:^| )(?:مدرس|مدرسه|معلم|معلمه)(?: |$)/,
        lecturer:/\blecturer\b|(?:^| )(?:محاضر|محاضره)(?: |$)/,
        professor:/\bprofessor\b|(?:^| )استاذ(?:ه)? جامعي(?:ه)?(?: |$)/,
        investor:/\binvestor\b|(?:^| )(?:مستثمر|مستثمره)(?: |$)/,
        partner:/\bpartner\b|(?:^| )(?:شريك|شريكه)(?: |$)/,
        accountant:/\baccountant\b|(?:^| )(?:محاسب|محاسبه)(?: |$)/,
        lawyer:/\b(?:lawyer|advocate|attorney)\b|(?:^| )(?:محام|محامي|محاميه)(?: |$)/};
    if(!professions[application.profession]?.test(clean(occupation))||!clean(application.professionTitle)||clean(application.professionTitle)!==clean(occupation))return {eligible:false,reason:'id_occupation_needs_review'};
    return {eligible:true,reason:'uae_professional_fields_match'};
}
function parseTsv(tsv){
    const lines=new Map();
    for(const row of String(tsv).split(/\r?\n/).slice(1)){
        const fields=row.split('\t');if(fields.length<12||fields[0]!=='5'||!fields[11].trim())continue;
        const confidence=Number(fields[10]);if(!Number.isFinite(confidence)||confidence<0)continue;
        const key=fields.slice(1,5).join(':'),line=lines.get(key)||{words:[],confidences:[]};line.words.push(fields.slice(11).join('\t'));line.confidences.push(confidence);lines.set(key,line);
    }
    return {lines:[...lines.values()].map(line=>({text:line.words.join(' '),confidence:Math.min(...line.confidences)}))};
}
function createLocalDocumentReader({env=process.env,spawnProcess=spawn}={}){
    if(env.MEMBERSHIP_OCR_ENGINE==='wasm')return require('./membershipWasmReader').createWasmDocumentReader({env,parseTsv});
    const configured=()=>env.MEMBERSHIP_OCR_ENABLED==='true'&&typeof env.MEMBERSHIP_TESSERACT_PATH==='string'&&env.MEMBERSHIP_TESSERACT_PATH.length>0;
    const read=buffer=>new Promise((resolve,reject)=>{
        if(!configured())return reject(Error('document_reader_unavailable'));
        // Fixed arguments; applicant data is never used in a command or file path.
        const child=spawnProcess(env.MEMBERSHIP_TESSERACT_PATH,['stdin','stdout','-l','ara+eng','--psm','6','tsv'],{shell:false,windowsHide:true,stdio:['pipe','pipe','ignore']});
        let output='',done=false;
        const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
        const timer=setTimeout(()=>{child.kill();finish(Error('document_reader_timeout'));},60000);timer.unref?.();
        child.on('error',()=>finish(Error('document_reader_unavailable')));
        child.stdout.setEncoding('utf8');
        child.stdout.on('data',chunk=>{output+=chunk.toString('utf8');if(Buffer.byteLength(output)>1024*1024){child.kill();finish(Error('document_reader_output_limit'));}});
        child.stdin.on('error',()=>{});child.stdin.end(buffer);
        child.on('close',code=>{if(code===0)finish(null,parseTsv(output));else finish(Error('document_reader_unavailable'));});
    });
    return {configured,read};
}
module.exports={createLocalDocumentReader,parseTsv,passportEvidence,professionalEvidence,checkDigit,sameName};
