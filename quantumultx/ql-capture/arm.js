/* QX one-shot arm; logs never print a token. */
'use strict';
const V='1.3.0',P='qlcap_v1_';
function log(x){if(typeof console!=='undefined'&&console.log)console.log('[QL Arm v'+V+'] '+x);}
function done(){$done({});}
try{
 log('start');
 const url=$prefs.valueForKey(P+'url')||'',token=$prefs.valueForKey(P+'token')||'';
 const valid=/^https:\/\//i.test(url)&&token.length>=32;
 if(valid){
  const saved=$prefs.setValueForKey('1',P+'armed'); $prefs.setValueForKey('1',P+'bydhy_armed');
  log('continuous capture enabled; save='+Boolean(saved));
  if(typeof $notify==='function')$notify('青龙采集 v'+V,'已开启持续采集','顺丰和比亚迪白名单采集已开启；比亚迪响应仅存 QX 本地');
 }else{
  log('not configured; no state changed');
  if(typeof $notify==='function')$notify('青龙采集 v'+V,'尚未初始化','先运行 QL Setup');
 }
}catch(e){log('script exception; no sensitive details');}
log('finish');done();
