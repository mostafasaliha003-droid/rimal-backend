const {DIRECTORY,MODELS,modelValid}=require('./membershipOcrModels');
function createWasmDocumentReader({env=process.env,parseTsv}){
    const ready=env.MEMBERSHIP_OCR_ENABLED==='true'&&Object.keys(MODELS).every(modelValid);
    const configured=()=>ready;
    async function read(buffer,{documentKind}={}){
        if(!configured())throw Error('document_reader_unavailable');
        let worker,expired=false,timer;
        const task=(async()=>{
            const {createWorker}=require('tesseract.js');
            // All code and traineddata are local; only in-memory image bytes reach the worker.
            worker=await createWorker(documentKind==='passport'?['eng']:['eng','ara'],1,{langPath:DIRECTORY,cacheMethod:'none',gzip:true,logger:()=>{},errorHandler:()=>{}},{load_system_dawg:'0',load_freq_dawg:'0'});
            if(expired){await worker.terminate();throw Error('document_reader_timeout');}
            await worker.setParameters({tessedit_pageseg_mode:'6',user_defined_dpi:'300',...(documentKind==='passport'?{tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'}:{})});
            const {data}=await worker.recognize(buffer,{}, {text:false,tsv:true});
            if(typeof data.tsv!=='string'||Buffer.byteLength(data.tsv)>1024*1024)throw Error('document_reader_output_limit');
            return parseTsv(data.tsv);
        })();
        try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('document_reader_timeout'));},60000);timer.unref?.();})]);}
        finally{expired=true;clearTimeout(timer);if(worker)await worker.terminate();}
    }
    return {configured,read};
}
module.exports={createWasmDocumentReader};
