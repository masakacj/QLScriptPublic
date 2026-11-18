/* Alipan WeChat miniapp refresh response -> private QingLong.
 * Exact issuer + exact WeChat AppID; only once when miniapp refreshes naturally.
 * Only transmits to the user's private HTTPS collector, never to GitHub/logs.
 */
'use strict';
const PREFIX='qlcap_v1_';
const GATEWAY='https://qlcap.781751.xyz:58443';
const WX='wxf86f0a56fa23241f';
const SRC='https://auth.aliyundrive.com/v2/account/token';
function read(k){return $prefs.valueForKey(PREFIX+k)||'';}
function save(k,v){return $prefs.setValueForKey(String(v),PREFIX+k);}
function done(){if(typeof $done==='function')$done({});}
function header(headers,name){
 const key=Object.keys(headers||{}).find(k=>k.toLowerCase()===name);
 return key?String(headers[key]):'';
}
function digest(s){
 let v=2166136261;
 for(let i=0;i<s.length;i++){v^=s.charCodeAt(i);v=Math.imul(v,16777619);}
 return (v>>>0).toString(16);
}
function main(){
 const request=(typeof $request!=='undefined'&&$request)||{};
 const response=(typeof $response!=='undefined'&&$response)||{};
 if(!/^https:\/\/auth\.aliyundrive\.com\/v2\/account\/token(?:\?|$)/i.test(String(request.url||'')))return done();
 if(String(request.method||'').toUpperCase()!=='POST')return done();
 if(Number(response.statusCode)!==200)return done();
 save('alipan_refresh_hit_at',new Date().toISOString());
 if(read('armed')==='0'||read('alipan_refresh_armed')==='0')return done();
 const referer=header(request.headers,'referer');
 const app=/servicewechat\.com\/(wx[0-9a-f]{16})\//i.exec(referer);
 if(!app||app[1].toLowerCase()!==WX)return done();
 let obj;
 try{obj=JSON.parse(String(response.body||''));}catch(_){
   save('alipan_refresh_last_result','response_unavailable');
   return done();
 }
 if(!obj||typeof obj!=='object'||Array.isArray(obj))return done();
 const rt=obj.refresh_token,access=obj.access_token,uid=obj.user_id;
 if(typeof rt!=='string'||!/^[a-zA-Z0-9_-]{32,256}$/.test(rt)||
    typeof access!=='string'||access.length<40||access.length>5000||
    typeof uid!=='string'||!/^[a-zA-Z0-9_-]{8,180}$/.test(uid)){
    save('alipan_refresh_last_result','response_schema_invalid');
    return done();
 }
 const f=digest(rt+'|'+uid);
 if(read('alipan_refresh_last_hash')===f)return done();
 const host=read('url').replace(/\/+$/,'');
 const gatewayKey=read('token');
 if(host!==GATEWAY||gatewayKey.length<32){
   save('alipan_refresh_last_result','gateway_not_configured');return done();
 }
 let ended=false;
 function finish(reason){
  if(ended)return;
  ended=true;
  save('alipan_refresh_last_result',reason);
  if(reason==='synced'){
   save('alipan_refresh_last_hash',f);
   save('alipan_refresh_last_at',new Date().toISOString());
   if(typeof $notify==='function')
    $notify('阿里云盘自动凭据接入','刷新凭据已安全同步青龙',
       '不显示 Token，不影响其他脚本。');
  }
  done();
 }
 const timer=setTimeout(()=>finish('timeout'),3000);
 try {
  $task.fetch({url:GATEWAY+'/trace/v1/ingest',method:'POST',
     opts:{policy:'direct'},
     headers:{Authorization:'Bearer '+gatewayKey,'Content-Type':'application/json'},
     body:JSON.stringify({v:1,type:'alipan_refresh_v1',service:'alipan',
       url:SRC,captured_at:Date.now(),wx_appid:WX,
       account:{user_id:uid,access_token:access,refresh_token:rt}})}
  ).then(reply=>{
   clearTimeout(timer);
   let result={};try{result=JSON.parse(reply.body||'{}')}catch(_){}
   if(Number(reply.statusCode||reply.status)!==200||result.accepted!==true)return finish('server_rejected');
   finish(result.status==='queued'?'queued':
     (result.status==='synced'||result.status==='unchanged'?'synced':'server_unconfirmed'));
  }).catch(()=>{clearTimeout(timer);finish('network_error');});
 }catch(_){clearTimeout(timer);finish('script_error');}
}
try{main()}catch(_){done()}
