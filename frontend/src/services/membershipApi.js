import { API_BASE_URL } from './apiBaseUrl.js';
import { userAccessToken } from './authSession.js';
export function memberHeaders(){const token=userAccessToken();return token?{Authorization:`Bearer ${token}`}:{ };}
export async function membershipRequest(path,{staff=false,method='GET',body,signal}={}){
    const token=staff?sessionStorage.getItem('rimal_admin_access_token'):userAccessToken();
    const response=await fetch(`${API_BASE_URL}${staff?'/v1/admin/membership':'/membership'}${path}`,{
        method,signal:signal||AbortSignal.timeout(25000),cache:'no-store',headers:{...(body instanceof Blob?{'Content-Type':body.type}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{})},
        ...(body!==undefined?{body:body instanceof Blob?body:JSON.stringify(body)}:{})
    });
    const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'membership_unavailable'),{code:data.error,status:response.status});return data;
}
export async function membershipDocument(reference,kind,{staff=false,signal}={}){
    const token=staff?sessionStorage.getItem('rimal_admin_access_token'):userAccessToken();
    const response=await fetch(`${API_BASE_URL}${staff?'/v1/admin/membership':'/membership'}/applications/${encodeURIComponent(reference)}/documents/${kind}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal});
    if(!response.ok||!['image/png','image/jpeg'].includes(response.headers.get('content-type')?.split(';')[0]))throw Error('document_unavailable');
    const blob=await response.blob();if(blob.size>5*1024*1024)throw Error('document_unavailable');return blob;
}
