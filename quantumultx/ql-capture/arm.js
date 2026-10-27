/* One-shot, user initiated only. */
const P='qlcap_v1_';const ok=!!($prefs.valueForKey(P+'url')&&$prefs.valueForKey(P+'token'));
if(ok)$prefs.setValueForKey('1',P+'armed');
if(typeof $notify==='function')$notify('青龙采集中心',ok?'已开启一次采集':'尚未配置',ok?'打开目标应用的会员页面':'先在手机本地设置服务地址和令牌');
$done({});
