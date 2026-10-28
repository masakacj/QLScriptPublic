/* BYD Ocean local capture status. No credentials or raw response in logs/notifications. */
"use strict";
const P="qlcap_v1_";
function finish(){$done({});}
try {
  const value=$prefs.valueForKey(P+"bydhy_enc")||"";
  const captured=$prefs.valueForKey(P+"bydhy_at")||"";
  const armed=$prefs.valueForKey(P+"bydhy_armed")==="1";
  const detail=value
    ? "加密响应已存于 QX 本地"+(captured?"；抓取时间 "+captured:"")+"；尚未写入青龙"
    : "尚无比亚迪登录响应；请在开启 QX 后重新进入比亚迪海洋微信小程序";
  if(typeof $notify==="function")$notify("比亚迪海洋采集状态",armed?"采集已开启":"采集未开启",detail);
} catch(_e) {
  if(typeof $notify==="function")$notify("比亚迪海洋采集状态","查询失败","没有读取或上传任何凭据");
}
finish();
