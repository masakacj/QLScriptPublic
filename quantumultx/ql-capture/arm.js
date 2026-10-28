/* QX unified capture switch; deep trace is explicitly enabled only if
 * the server collector is armed, and expires within 10 minutes.
 */
'use strict';
const V='1.5.2',P='qlcap_v1_';
function log(x){if(typeof console!=='undefined'&&console.log)console.log('[QL Arm v'+V+'] '+x);}
function notify(title,msg){if(typeof $notify==='function')$notify('青龙采集 v'+V,title,msg);}
function done(){$done({});}
try{
 const url=($prefs.valueForKey(P+'url')||'').replace(/\/+$/,'');
 const token=$prefs.valueForKey(P+'token')||'';
 if(url!=='https://qlcap.781751.xyz:58443'||token.length<32){
  notify('尚未初始化','先运行 QL Setup；没有启用深度诊断');done();
 }else{
  $prefs.setValueForKey('1',P+'armed');
  $prefs.setValueForKey('1',P+'bydhy_armed');
  $prefs.setValueForKey('0',P+'trace_until');
  // Deep trace cannot start without a separately armed, 10-minute server window.
  $task.fetch({url:url+'/trace/v1/config',method:'GET',
    headers:{Authorization:'Bearer '+token,Accept:'application/json'},
    opts:{policy:'direct'}}).then(r=>{
     const code=Number(r.statusCode||r.status||0);
     let v={};try{v=JSON.parse(r.body||'{}');}catch(_e){}
     if(code===200&&v.active&&v.host==='mina.bydoceanauto.com'&&Number(v.remaining_seconds)>0){
      const seconds=Math.min(600,Math.floor(Number(v.remaining_seconds)));
      $prefs.setValueForKey(String(Date.now()+seconds*1000),P+'trace_until');
      $prefs.setValueForKey('0',P+'trace_sent_count');
      $prefs.setValueForKey('0',P+'trace_attempt_count');
      $prefs.setValueForKey('0',P+'trace_failed_count');
      $prefs.setValueForKey('',P+'trace_last_sent');
      $prefs.setValueForKey('',P+'trace_last_attempt_at');
      $prefs.setValueForKey('未开始',P+'trace_last_result');
      notify('持续采集和深度诊断已开启','比亚迪 HTTP 请求/响应将限时采集 '+seconds+' 秒；仅供受控分析');
     }else notify('持续采集已开启','顺丰及比亚迪正常采集开启；深度诊断未启用');
     done();
    }).catch(()=>{notify('持续采集已开启','诊断服务未连通；普通 Cookie 采集不受影响');done();});
 }
}catch(_e){log('script exception; details withheld');done();}
