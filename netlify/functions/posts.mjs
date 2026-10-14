import { getStore } from "@netlify/blobs";
import { savePost, getPosts, toCSV } from "./board-core.mjs";

const common = {"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...common,"Content-Type":"application/json; charset=utf-8"}});}
function error(status,message){return json({error:message},status);}

export default async function handler(request) {
  if (!["GET","POST"].includes(request.method)) return error(405,"Method not allowed.");
  try {
    const store=getStore("cia4103-week07-board-v1");
    if (request.method==="POST") {
      if (Number(request.headers.get("content-length")||0)>9000) return error(413,"Submission too large.");
      if (!request.headers.get("content-type")?.includes("application/json")) return error(415,"Use application/json.");
      let input;
      try {input=JSON.parse(await request.text());} catch{return error(400,"Invalid JSON.");}
      try {return json({ok:true,...await savePost(store,input)},201);}
      catch(e){if (/^(Invalid|Choose|Please|Your|Remove)/.test(e.message))return error(400,e.message);throw e;}
    }
    const url=new URL(request.url);
    let posts;
    try {posts=await getPosts(store,{part:url.searchParams.get("part")||"all",since:url.searchParams.get("since")||"fourhours",after:url.searchParams.get("after")||""});}
    catch(e){if (/^(Unknown|Invalid cursor)/.test(e.message))return error(400,e.message);throw e;}
    const fmt=url.searchParams.get("format")||"json";
    if (fmt==="csv")return new Response(toCSV(posts),{headers:{...common,"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename=cia4103_labboard.csv"}});
    if(fmt!=="json")return error(400,"Unknown export format.");
    return json({posts,count:posts.length,generatedAt:new Date().toISOString()});
  } catch(e){console.error("CIA4103 board error",e);return error(503,"The board is temporarily unavailable. Please retry.");}
}
