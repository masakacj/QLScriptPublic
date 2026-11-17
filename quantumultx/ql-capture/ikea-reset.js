/* Quantumult X interactive task: restart the one-shot IKEA metadata window.
 * Only clears local IKEA discovery state; no other QL captures are modified.
 */
'use strict';
const P='qlcap_v1_';
try {
  $prefs.setValueForKey('0',P+'ikea_capture_started_ms');
  $prefs.setValueForKey('',P+'ikea_sent_fingerprints');
  $prefs.setValueForKey('0',P+'ikea_first_success');
  $prefs.setValueForKey('1',P+'ikea_armed');
  if(typeof $notify==='function'){
    $notify('宜家小程序采集','已准备好',
      '现在打开宜家小程序签到页。首次命中宜家域名后采集 30 分钟，仅上传脱敏请求结构。');
  }
} catch(_) {
  if(typeof $notify==='function')
    $notify('宜家小程序采集','准备失败','请确认 QX 的脚本储存功能正常。');
}
if(typeof $done==='function')$done({});
