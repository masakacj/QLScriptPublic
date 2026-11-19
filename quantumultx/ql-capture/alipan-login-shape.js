/* Aliyun Drive miniapp: login-related POST/response body FIELD NAMES ONLY.
 * Permitted: 5 first-party domains + confirmed WeChat miniapp Referer.
 * Never send credentials, phones, content values, request body or cookies.
 */
'use strict';
const P='qlcap_v1_', GATE='https://qlcap.781751.xyz:58443';
const APP='wxf86f0a56fa23241f', BUILD='alipan-login-20261119-passport-r2';
const LIMIT_MS=90*60*1000;
const HOSTS=new Set(['auth.aliyundrive.com','open.aliyundrive.com',
 'api.aliyundrive.com','user.aliyundrive.com','member.aliyundrive.com',
 'passport.aliyundrive.com']);
function get(k){return $prefs.valueForKey(P+k)||'';}
function set(k,v){return $prefs.setValueForKey(String(v),P+k);}
function done(){$done({});}
function header(h,name){
 const k=Object.keys(h||{}).find(x=>x.toLowerCase()===name);
 return k?String(h[k]):'';
}
function pathInfo(raw){
 const m=/^https:\/\/([a-z0-9.-]+)(\/[^?#]*)?(?:\?([^#]*))?/i.exec(String(raw||''));
 if(!m)return null;
 const host=m[1].toLowerCase(),full=m[2]||'/';
 if(!HOSTS.has(host))return null;
 // Passport is accepted on the exact observed POST endpoint only.
 if(host==='passport.aliyundrive.com' && full!=='/mini_program/login.do')return null;
 // Other hosts remain restricted to login/auth/identity-related API segments.
 if(host!=='passport.aliyundrive.com' &&
    !/(?:^|\/)(?:auth|oauth|idp|login|signin|account|passport|token|session|phone|mobile|wechat|wx|verify|user)(?:\/|_|$)/i.test(full))return null;
 const path=full.split('/').map(part=>
   part.length>30 || /[0-9a-f]{16,}/i.test(part) || /\d{6,}/.test(part)
    || !/^[A-Za-z0-9_.-]*$/.test(part)?'_id_':part
 ).join('/').slice(0,160);
 if(!/^\/[A-Za-z0-9_./-]*$/.test(path))return null;
 const query=[],seen=new Set();
 for(const pair of String(m[3]||'').split('&').slice(0,25)){
  const k=pair.split('=')[0];
  if(/^[A-Za-z_][A-Za-z0-9_.-]{0,55}$/.test(k)&&!seen.has(k)){
   seen.add(k);query.push(k);
  }
 }
 return {host,path,query};
}
function fieldNames(body){
 if(body==null)return [];
 let raw='';
 if(typeof body==='string')raw=body;
 else if(typeof body==='object'&&!(body instanceof ArrayBuffer)){
  if(!Array.isArray(body)){
   const out=[];
   for(const key of Object.keys(body).slice(0,40))if(/^[A-Za-z_][A-Za-z0-9_.-]{0,55}$/.test(key))out.push(key);
   return out;
  }
  return [];
 }else return [];
 if(raw.length>60000)return [];
 const out=[],seen=new Set();
 function add(k){
  if(/^[A-Za-z_][A-Za-z0-9_.-]{0,55}$/.test(k)&&!seen.has(k)&&out.length<40){
   seen.add(k);out.push(k);
  }
 }
 try{
  const obj=JSON.parse(raw);
  if(obj&&typeof obj==='object'&&!Array.isArray(obj)){
   for(const k of Object.keys(obj))add(k);
   // The passport response may nest an id_token under data/result.
   // Key names only: never read a nested value that is not a plain object.
   for(const prefix of ['data','result']){
    const child=obj[prefix];
    if(child&&typeof child==='object'&&!Array.isArray(child)){
     for(const k of Object.keys(child).slice(0,25))add(prefix+'.'+k);
    }
   }
  }
 }catch(_){
  if(raw.trim().startsWith('{')||raw.trim().startsWith('['))return [];
  for(const pair of raw.split('&').slice(0,40)){
   try{add(decodeURIComponent(pair.split('=')[0].replace(/\+/g,' ')));}
   catch(_){}
  }
 }
 return out;
}
function main(){
 if(get('armed')==='0'||get('alipan_login_shape_armed')==='0')return done();
 const req=(typeof $request!=='undefined'&&$request)||{};
 const res=(typeof $response!=='undefined'&&$response)||null;
 const url=pathInfo(req.url);
 if(!url||String(req.method||'').toUpperCase()!=='POST')return done();
 const ref=header(req.headers,'referer');
 const wx=/servicewechat\.com\/(wx[0-9a-f]{16})\//i.exec(ref);
 if(!wx||wx[1].toLowerCase()!==APP){
  set('alipan_login_shape_last_result','appid_unverified');return done();
 }
 const stage=res?'response_body':'request_body';
 const now=Date.now();
 if(get('alipan_login_shape_build')!==BUILD){
  set('alipan_login_shape_build',BUILD);
  set('alipan_login_shape_start',now);
  set('alipan_login_shape_seen','');
 }
 set('alipan_login_shape_hit_at',new Date(now).toISOString());
 set('alipan_login_shape_last_host',url.host);
 set('alipan_login_shape_last_path',url.path);
 if(now-(Number(get('alipan_login_shape_start'))||now)>LIMIT_MS)return done();
 const keys=fieldNames(res?res.body:req.body);
 const status=res?Number(res.statusCode||0):null;
 const safeStatus=status!==null&&Number.isInteger(status)&&status>=0&&status<=599?status:null;
 const fingerprint=[url.host,url.path,stage,keys.join(','),safeStatus].join('|');
 const seen=get('alipan_login_shape_seen').split('\n').filter(Boolean);
 if(seen.includes(fingerprint))return done();
 const gateway=get('url').replace(/\/+$/,''),token=get('token');
 if(gateway!==GATE||token.length<32){
  set('alipan_login_shape_last_result','gateway_not_configured');return done();
 }
 const payload={v:1,type:'qx_structure_v1',host:url.host,path:url.path,
  method:'POST',stage,query_keys:url.query,header_keys:[],body_keys:keys,
  body_length:null,status:safeStatus,wx_appid:APP,wx_appid_source:'referer'};
 let ended=false;
 function finish(ok,reason){
  if(ended)return;ended=true;
  set('alipan_login_shape_last_result',ok?'uploaded':reason);
  if(ok){
   set('alipan_login_shape_seen',seen.concat([fingerprint]).slice(-12).join('\n'));
   set('alipan_login_shape_uploaded_at',new Date().toISOString());
  }
  done();
 }
 const timer=setTimeout(()=>finish(false,'timeout'),2700);
 try{
  $task.fetch({url:GATE+'/trace/v1/ingest',method:'POST',opts:{policy:'direct'},
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(payload)})
  .then(r=>{clearTimeout(timer);finish(Number(r.statusCode||r.status||0)===200,'upload_http_error')})
  .catch(()=>{clearTimeout(timer);finish(false,'network_error')});
 }catch(_){clearTimeout(timer);finish(false,'script_error')}
}
try{main()}catch(_){done()}
