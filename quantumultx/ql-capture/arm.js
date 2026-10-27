/* QX one-shot arm; logs never print a token. */
'use strict';
const V='1.2.0',P='qlcap_v1_';
function log(x){if(typeof console!=='undefined'&&console.log)console.log('[QL Arm v'+V+'] '+x);}
function done(){$done({});}
try{
 log('start');
 const url=$prefs.valueForKey(P+'url')||'',token=$prefs.valueForKey(P+'token')||'';
 const valid=/^https:\/\//i.test(url)&&token.length>=32;
 if(valid){
  const saved=$prefs.setValueForKey('1',P+'armed');
  log('capture armed; save='+Boolean(saved));
  if(typeof $notify==='function')$notify('青龙采集 v'+V,'已开启一次采集','进入顺丰会员页面；仅捕获白名单请求');
 }else{
  log('not configured; no state changed');
  if(typeof $notify==='function')$notify('青龙采集 v'+V,'尚未初始化','先运行 QL Setup');
 }
}catch(e){log('script exception; no sensitive details');}
log('finish');done();
