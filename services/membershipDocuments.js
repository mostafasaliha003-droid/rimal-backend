const crypto=require('node:crypto');
const MAX_BYTES=5*1024*1024;
function fail(code,status=400){return Object.assign(new Error(code),{code,httpStatus:status});}
function encryptionKey(env=process.env){
    const value=env.MEMBERSHIP_DOCUMENT_ENCRYPTION_KEY;
    if(typeof value!=='string'||!/^[a-f\d]{64}$/i.test(value)||value===env.PAYMENT_BOOKING_ENCRYPTION_KEY||value===env.AFFILIATE_BOOKING_ENCRYPTION_KEY)throw fail('membership_documents_unavailable',503);
    return Buffer.from(value,'hex');
}
function imageMetadata(buffer,mime){
    if(!Buffer.isBuffer(buffer)||buffer.length<33||buffer.length>MAX_BYTES)throw fail('invalid_document_size');
    let width,height;
    if(mime==='image/png'&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&buffer.toString('ascii',12,16)==='IHDR'){
        let offset=8,idat=false,ended=false;
        if(buffer.readUInt32BE(8)!==13)throw fail('invalid_document_image');
        while(offset+12<=buffer.length){
            const length=buffer.readUInt32BE(offset),type=buffer.toString('ascii',offset+4,offset+8);
            if(length>buffer.length-offset-12)throw fail('invalid_document_image');
            if(type==='IDAT')idat=true;
            offset+=length+12;
            if(type==='IEND'){if(length!==0||offset!==buffer.length)throw fail('invalid_document_image');ended=true;break;}
        }
        if(!idat||!ended)throw fail('invalid_document_image');
        width=buffer.readUInt32BE(16);height=buffer.readUInt32BE(20);
    }else if(mime==='image/jpeg'&&buffer[0]===255&&buffer[1]===216&&buffer[buffer.length-2]===255&&buffer[buffer.length-1]===217){
        let offset=2;
        while(offset+4<buffer.length){
            if(buffer[offset++]!==255)break;
            while(buffer[offset]===255)offset++;
            const marker=buffer[offset++];
            if(marker===217||marker===218)break;
            if(marker===1||(marker>=208&&marker<=215))continue;
            if(offset+2>buffer.length)break;
            const length=buffer.readUInt16BE(offset);
            if(length<2||offset+length>buffer.length)break;
            if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8){height=buffer.readUInt16BE(offset+3);width=buffer.readUInt16BE(offset+5);break;}
            offset+=length;
        }
    }
    if(!width||!height||width>10000||height>10000||width*height>40000000)throw fail('invalid_document_image');
    return {mime,size:buffer.length,width,height};
}
function encryptDocument(buffer,{realm,applicationId,kind},env){
    const digest=crypto.createHash('sha256').update(buffer).digest('hex'),iv=crypto.randomBytes(12);
    const cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(env),iv);
    cipher.setAAD(Buffer.from(`${realm}:${applicationId}:${kind}:${digest}`));
    return {iv,ciphertext:Buffer.concat([cipher.update(buffer),cipher.final()]),tag:cipher.getAuthTag(),digest};
}
function decryptDocument(row,env){
    try{
        const decipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(env),Buffer.from(row.iv));
        decipher.setAAD(Buffer.from(`${row.realm}:${row.applicationId}:${row.kind}:${row.digest}`));decipher.setAuthTag(Buffer.from(row.tag));
        const buffer=Buffer.concat([decipher.update(Buffer.from(row.ciphertext)),decipher.final()]);
        if(crypto.createHash('sha256').update(buffer).digest('hex')!==row.digest)throw Error();
        return buffer;
    }catch{throw fail('document_unavailable',503);}
}
module.exports={MAX_BYTES,encryptionKey,imageMetadata,encryptDocument,decryptDocument,fail};
