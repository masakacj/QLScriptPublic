/* QX optional manual global disable switch, persistent until QL Arm. */
'use strict';
const V='2.0.0',P='qlcap_v1_';
try {
  $prefs.setValueForKey('0',P+'armed');
  $prefs.setValueForKey('0',P+'bydhy_armed');
  $prefs.setValueForKey('0',P+'quark_armed');
  $prefs.setValueForKey('0',P+'trace_until');
  if(typeof $notify==='function')$notify('QL Cookie Capture v'+V,'采集已手动暂停','恢复时运行 QL Arm；关闭 QX Tunnel 也会停止抓取');
}catch(e) {
  if(typeof $notify==='function')$notify('QL Cookie Capture v'+V,'暂停失败','检查 QX 的任务运行权限');
}
$done({});
