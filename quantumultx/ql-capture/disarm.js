/* QX manual disarm; never logs secrets. */
'use strict';
const V='1.5.0';
function log(x){if(typeof console!=='undefined'&&console.log)console.log('[QL Disarm v'+V+'] '+x);}
try{
 log('start');
 const ok=$prefs.setValueForKey('0','qlcap_v1_armed');
 $prefs.setValueForKey('0','qlcap_v1_bydhy_armed');
 $prefs.setValueForKey('0','qlcap_v1_trace_until');
 log('capture disabled; save='+Boolean(ok));
 if(typeof $notify==='function')$notify('青龙采集 v'+V,'采集已关闭','普通采集和深度诊断均已停止；服务器原文会按时自动清除');
}catch(e){log('script exception');}
log('finish');$done({});
