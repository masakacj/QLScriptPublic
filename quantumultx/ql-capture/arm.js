/* QX default-on capture: optional manual global enable switch. */
'use strict';
const V='2.0.0',P='qlcap_v1_';
try {
  $prefs.setValueForKey('1',P+'armed');
  $prefs.setValueForKey('1',P+'bydhy_armed');
  $prefs.setValueForKey('1',P+'quark_armed');
  if(typeof $notify==='function')$notify('QL Cookie Capture v'+V,'已开启持续采集','QX 运行时自动抓取顺丰、比亚迪、夸克；无需倒计时或再次 Arm');
}catch(e) {
  if(typeof $notify==='function')$notify('QL Cookie Capture v'+V,'开启失败','检查 QX 的任务运行权限');
}
$done({});
