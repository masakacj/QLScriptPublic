/* BYD Ocean QX local capture arm/disarm toggle; never reads credentials. */
"use strict";
const KEY="qlcap_v1_bydhy_armed";
try {
  const active=$prefs.valueForKey(KEY)==="1";
  const next=active?"0":"1";
  if(!$prefs.setValueForKey(next,KEY))throw new Error("prefs");
  if(typeof $notify==="function") {
    $notify("比亚迪海洋 QX 采集",active?"已暂停":"已开启",
      active?"不再捕获新的登录响应；已保存的记录仍保留":
      "打开比亚迪海洋微信小程序，触发登录。只存 QX 本机，不向青龙上传");
  }
}catch(_e){
  if(typeof $notify==="function")$notify("比亚迪海洋 QX 采集","切换失败","请检查 QX 任务权限和配置");
}
$done({});
