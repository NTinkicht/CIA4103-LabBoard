import {getStore} from '@netlify/blobs';
import sharp from 'sharp';
import {randomUUID} from 'node:crypto';
import {validatePost,makeRecord,listPosts,makeCSV} from './board-core.mjs';
const STORE='cia4103-week09-smart-lab-board-v2';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});
const error=(status,msg)=>json({error:msg},status);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function handler(req){
 if(!['GET','POST'].includes(req.method))return error(405,'Method not allowed.');
 try{
  const store=getStore(STORE);
  if(req.method==='GET'){
   const url=new URL(req.url),id=url.searchParams.get('image');
   if(id!==null){
    if(!uuid.test(id))return error(400,'Invalid screenshot ID.');
    const data=await store.get('img/'+id,{type:'arrayBuffer',consistency:'strong'});
    if(!data)return error(404,'Screenshot not found.');
    return new Response(data,{headers:{...headers,'Content-Type':'image/webp','Content-Security-Policy':"default-src 'none'; sandbox"}});
   }
   let posts;try{posts=await listPosts(store,{part:url.searchParams.get('part')||'all',range:url.searchParams.get('range')||'4h'});}
   catch(e){return error(400,e.message);}
   if(url.searchParams.get('format')==='csv')return new Response(makeCSV(posts),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="cia4103-lab09-board.csv"'}});
   return json({posts,count:posts.length,updated:new Date().toISOString()});
  }
  if(Number(req.headers.get('content-length')||0)>3900000)return error(413,'Submission too large.');
  if(!req.headers.get('content-type')?.includes('application/json'))return error(415,'Use JSON.');
  const raw=await req.text();if(raw.length>3900000)return error(413,'Submission too large.');
  let payload;try{payload=JSON.parse(raw);}catch{return error(400,'Invalid JSON.');}
  let clean;try{clean=validatePost(payload);}catch(e){return error(400,e.message);}
  let imageId=null;
  if(clean.image){
   const bytes=Buffer.from(clean.image.base64,'base64');
   if(bytes.length>2000000||bytes.length<30)return error(400,'Screenshot must be under 2 MB.');
   let converted;try{
    const image=sharp(bytes,{limitInputPixels:12000000,failOn:'error'});
    const info=await image.metadata();
    if(!['png','jpeg','webp'].includes(info.format))return error(400,'Only genuine PNG, JPG and WebP screenshots are allowed.');
    converted=await image.rotate().resize({width:1600,height:1200,fit:'inside',withoutEnlargement:true}).webp({quality:75}).toBuffer();
   }catch{return error(400,'Screenshot could not be processed.');}
   if(converted.length>1500000)return error(413,'Compressed screenshot is too large.');
   imageId=randomUUID();await store.set('img/'+imageId,new Blob([converted],{type:'image/webp'}));
  }
  const post=makeRecord(clean,imageId);await store.setJSON('post/'+post.submittedAt+'/'+post.id,post);
  return json({ok:true,id:post.id,checks:post.diagnostics},201);
 }catch(e){console.error('CIA4103 lab board',e);return error(503,'The board is temporarily unavailable. Please retry.');}
}
