/* QX manual disarm; never logs secrets. */
'use strict';
const V='1.2.0';
function log(x){if(typeof console!=='undefined'&&console.log)console.log('[QL Disarm v'+V+'] '+x);}
try{
 log('start');
 const ok=$prefs.setValueForKey('0','qlcap_v1_armed');
 log('capture disabled; save='+Boolean(ok));
 if(typeof $notify==='function')$notify('青龙采集 v'+V,'采集已关闭','不会上传后续顺丰请求');
}catch(e){log('script exception');}
log('finish');$done({});
