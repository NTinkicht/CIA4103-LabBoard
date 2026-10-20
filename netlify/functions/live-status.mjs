import {configured} from './live-auth.mjs';
export default async function handler(req){
 if(req.method!=='GET')return new Response(null,{status:405});
 return new Response(JSON.stringify({enabled:configured()}),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
