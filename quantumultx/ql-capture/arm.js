/* QX unified one-tap collector. A private admin first prepares a BYD trace;
 * only this user-initiated QL Arm action activates its 10-minute window.
 * Without preparation, ordinary SF/BYD collection continues unchanged.
 */
'use strict';
const V='1.5.5',P='qlcap_v1_',TRACE_HOST='mina.bydoceanauto.com',MOBILE_HOST='wx.10086.cn';
function log(x){if(typeof console!=='undefined'&&console.log)console.log('[QL Arm v'+V+'] '+x);}
function notify(title,msg){if(typeof $notify==='function')$notify('青龙采集 v'+V,title,msg);}
let finished=false;
function done(){if(finished)return;finished=true;$done({});}
function fetchJson(url,token,method,body){
 const req={url,method,headers:{Authorization:'Bearer '+token,Accept:'application/json'},
  opts:{policy:'direct'}};
 if(body!==undefined){
  req.headers['Content-Type']='application/json';
  req.body=JSON.stringify(body);
 }
 return $task.fetch(req).then(r=>{
  const code=Number(r.statusCode||r.status||0);
  let data={};try{data=JSON.parse(r.body||'{}');}catch(_e){}
  return {code,data};
 });
}
function activateLocal(info){
 const seconds=Math.min(600,Math.floor(Number(info.remaining_seconds)||0));
 if(!info.active||(info.host!==TRACE_HOST&&info.host!==MOBILE_HOST)||seconds<=0)return false;
 $prefs.setValueForKey(info.host,P+'trace_host');
 $prefs.setValueForKey(String(Date.now()+seconds*1000),P+'trace_until');
 $prefs.setValueForKey('0',P+'trace_sent_count');
 $prefs.setValueForKey('0',P+'trace_attempt_count');
 $prefs.setValueForKey('0',P+'trace_failed_count');
 $prefs.setValueForKey('',P+'trace_last_sent');
 $prefs.setValueForKey('',P+'trace_last_attempt_at');
 $prefs.setValueForKey('未开始',P+'trace_last_result');
 notify('持续采集和深度诊断已开启',(info.host===MOBILE_HOST?'中国移动 Cookie':'比亚迪 HTTP 请求/响应')+'采集限时 '+seconds+' 秒；仅存受控服务器内存');
 return true;
}
function uploadLocalLogin(url,token){
 // One-tap, authenticated transfer of the user's own previously intercepted
 // BYD login response; no values in logs, notifications, or Github.
 const encrypted=($prefs.valueForKey(P+'bydhy_enc')||'').trim();
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encrypted)||encrypted.length<32||encrypted.length>16384){
  notify('未找到本地比亚迪登录响应','先正常进入比亚迪海洋小程序；无需再次签到，再运行 QL Arm');
  $prefs.setValueForKey('0',P+'trace_until');
  return done();
 }
 const event={
  v:1,stage:'response_body',method:'POST',
  url:'https://mina.bydoceanauto.com/?service=mina.decryptCode',
  session_index:'qx-local-'+Date.now(),
  body:encrypted,origin:'qx-prefs-login',at:Date.now()
 };
 return fetchJson(url+'/trace/v1/ingest',token,'POST',event).then(r=>{
  $prefs.setValueForKey('0',P+'trace_until');
  if(r.code===200){
   $prefs.setValueForKey(new Date().toISOString(),P+'bydhy_transfer_at');
   notify('比亚迪加密登录信息已安全提交','已送达私有网关；等待验证后写入青龙，不会自动签到');
  }else notify('比亚迪候选提交失败','HTTP '+r.code+'；本地凭据未删除');
  done();
 }).catch(()=>{
  $prefs.setValueForKey('0',P+'trace_until');
  notify('比亚迪候选网络提交失败','请检查网络后运行 QL Arm；原凭据仍留在本机');
  done();
 });
}
function normal(message){notify('持续采集已开启',message);done();}
try{
 const url=($prefs.valueForKey(P+'url')||'').replace(/\/+$/,'');
 const token=$prefs.valueForKey(P+'token')||'';
 if(url!=='https://qlcap.781751.xyz:58443'||token.length<32){
  notify('尚未初始化','先运行 QL Setup；未开启深度诊断');done();
 }else{
  $prefs.setValueForKey('1',P+'armed');
  $prefs.setValueForKey('1',P+'bydhy_armed');
  $prefs.setValueForKey('0',P+'trace_until');
  fetchJson(url+'/trace/v1/config',token,'GET').then(result=>{
   const info=result.data;
   if(result.code!==200){
    return normal('普通采集已启用；诊断查询 HTTP '+result.code);
   }
   if(info.active&&(info.host===TRACE_HOST||info.host===MOBILE_HOST)){
    if(!activateLocal(info))return normal('诊断窗口已过期，普通采集不受影响');
    return info.host===MOBILE_HOST?done():uploadLocalLogin(url,token);
   }
   // Private admin authorization alone cannot capture traffic: the user
   // must explicitly tap this QL Arm task before this activation is sent.
   if(info.prepared&&(info.prepared_host===TRACE_HOST||info.prepared_host===MOBILE_HOST)&&Number(info.prepared_remaining_seconds)>0){
    const target=info.prepared_host;
    return fetchJson(url+'/trace/v1/activate',token,'POST',{host:target}).then(r=>{
     if(r.code===200&&activateLocal(r.data))return target===MOBILE_HOST?done():uploadLocalLogin(url,token);
     return normal('诊断启动未成功（HTTP '+r.code+'）；普通采集已启用');
    }).catch(()=>normal('诊断启动网络异常；普通采集已启用'));
   }
   return normal('顺丰及比亚迪正常采集已启用；服务器未准备深度诊断');
  }).catch(()=>normal('诊断服务未连通；普通 Cookie 采集不受影响'));
 }
}catch(_e){log('script exception; secrets withheld');done();}
