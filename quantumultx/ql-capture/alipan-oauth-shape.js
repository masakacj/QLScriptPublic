/* Aliyun miniapp exact observed open OAuth exchange: schema only.
 * NEVER transmit body/credential values. Capture request and response key NAMES.
 */
'use strict';
const P='qlcap_v1_',ENDPOINT='https://open.aliyundrive.com/idp/oauth/access_token';
const GATE='https://qlcap.781751.xyz:58443', APP='wxf86f0a56fa23241f';
function p(k){return $prefs.valueForKey(P+k)||'';}
function s(k,v){$prefs.setValueForKey(String(v),P+k);}
function done(){$done({});}
function fields(raw){
 if(raw==null)return [];
 const text=String(raw);
 if(text.length>80000)return [];
 const out=[],seen=new Set();
 function add(key){
  if(typeof key==='string' && /^[A-Za-z_][A-Za-z0-9_.-]{0,55}$/.test(key) &&
     !seen.has(key)&&out.length<40){seen.add(key);out.push(key);}
 }
 try{
  const obj=JSON.parse(text);
  if(obj&&typeof obj==='object'&&!Array.isArray(obj)){
   for(const key of Object.keys(obj).slice(0,40))add(key);
  }
 }catch(_){
  // URL-encoded request parameters, names only. Values never leave this function.
  if(text.startsWith('{')||text.startsWith('['))return [];
  for(const part of text.split('&').slice(0,40)){
   const encoded=part.split('=')[0];
   try{add(decodeURIComponent(encoded.replace(/\+/g,' ')));}catch(_){}
  }
 }
 return out;
}
function header(h,n){
 const k=Object.keys(h||{}).find(x=>x.toLowerCase()===n);
 return k?String(h[k]):'';
}
function main(){
 if(p('armed')==='0'||p('alipan_schema_armed')==='0')return done();
 const req=(typeof $request!=='undefined'&&$request)||{};
 const res=(typeof $response!=='undefined'&&$response)||null;
 if(String(req.url||'').split(/[?#]/)[0]!==ENDPOINT||String(req.method||'').toUpperCase()!=='POST')return done();
 const referer=header(req.headers,'referer');
 if(!new RegExp('servicewechat\\.com/'+APP+'/','i').test(referer))return done();
 const host=p('url').replace(/\/+$/,''),token=p('token');
 if(host!==GATE||token.length<32)return done();
 const stage=res?'response_body':'request_body';
 const now=Date.now(),key=stage==='request_body'?'request':'response';
 const day=new Date(now).toISOString().slice(0,10);
 if(p('alipan_schema_day')!==day){
  s('alipan_schema_day',day);
  s('alipan_schema_start',now);
  s('alipan_schema_seen','');
 }
 if(now-(Number(p('alipan_schema_start'))||now)>30*60*1000)return done();
 const body=key==='request'?req.body:res.body;
 const keys=fields(body);
 s('alipan_schema_hit_at',new Date(now).toISOString());
 s('alipan_schema_last_keys_count',keys.length);
 const fp=key+':'+keys.join(',');
 if(p('alipan_schema_seen').split('|').includes(fp))return done();
 const payload={v:1,type:'qx_structure_v1',host:'open.aliyundrive.com',
  path:'/idp/oauth/access_token',method:'POST',stage,
  query_keys:[],header_keys:[],body_keys:keys,body_length:null,
  status:res?Number(res.statusCode||0)||null:null,
  wx_appid:APP,wx_appid_source:'referer'};
 let ended=false;
 function exit(ok){
  if(ended)return;ended=true;
  s('alipan_schema_last_result',ok?'uploaded':'upload_failed');
  if(ok)s('alipan_schema_seen',p('alipan_schema_seen')+'|'+fp);
  done();
 }
 const t=setTimeout(()=>exit(false),2500);
 try{
  $task.fetch({url:GATE+'/trace/v1/ingest',method:'POST',opts:{policy:'direct'},
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(payload)})
   .then(r=>{clearTimeout(t);exit(Number(r.statusCode||r.status||0)===200)})
   .catch(()=>{clearTimeout(t);exit(false)});
 }catch(_){clearTimeout(t);exit(false)}
}
try{main()}catch(_){done();}
