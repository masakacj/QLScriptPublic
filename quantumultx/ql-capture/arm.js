/* QX unified one-tap collector. A private admin first prepares a BYD trace;
 * only this user-initiated QL Arm action activates its 10-minute window.
 * Without preparation, ordinary SF/BYD collection continues unchanged.
 */
'use strict';
const V='1.5.3',P='qlcap_v1_',TRACE_HOST='mina.bydoceanauto.com';
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
 if(!info.active||info.host!==TRACE_HOST||seconds<=0)return false;
 $prefs.setValueForKey(String(Date.now()+seconds*1000),P+'trace_until');
 $prefs.setValueForKey('0',P+'trace_sent_count');
 $prefs.setValueForKey('0',P+'trace_attempt_count');
 $prefs.setValueForKey('0',P+'trace_failed_count');
 $prefs.setValueForKey('',P+'trace_last_sent');
 $prefs.setValueForKey('',P+'trace_last_attempt_at');
 $prefs.setValueForKey('未开始',P+'trace_last_result');
 notify('持续采集和深度诊断已开启','比亚迪 HTTP 请求/响应限时 '+seconds+' 秒；仅存受控服务器内存');
 return true;
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
   if(info.active&&info.host===TRACE_HOST){
    if(!activateLocal(info))return normal('诊断窗口已过期，普通采集不受影响');
    return done();
   }
   // Private admin authorization alone cannot capture traffic: the user
   // must explicitly tap this QL Arm task before this activation is sent.
   if(info.prepared&&info.prepared_host===TRACE_HOST&&Number(info.prepared_remaining_seconds)>0){
    return fetchJson(url+'/trace/v1/activate',token,'POST',{host:TRACE_HOST}).then(r=>{
     if(r.code===200&&activateLocal(r.data))return done();
     return normal('诊断启动未成功（HTTP '+r.code+'）；普通采集已启用');
    }).catch(()=>normal('诊断启动网络异常；普通采集已启用'));
   }
   return normal('顺丰及比亚迪正常采集已启用；服务器未准备深度诊断');
  }).catch(()=>normal('诊断服务未连通；普通 Cookie 采集不受影响'));
 }
}catch(_e){log('script exception; secrets withheld');done();}
