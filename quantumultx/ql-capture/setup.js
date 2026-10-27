/* Run as Quantumult X manual task after editing this local copy only.
 * NEVER commit real CAPTURE_TOKEN to GitHub. */
const SERVER_URL='https://REPLACE-WITH-YOUR-HTTPS-DOMAIN';
const CAPTURE_TOKEN='REPLACE-WITH-32-CHARACTER-RANDOM-SECRET';
const PREFIX='qlcap_v1_';
const ok=/^https:\/\/[^/]+$/i.test(SERVER_URL)&&CAPTURE_TOKEN.length>=32&&!CAPTURE_TOKEN.includes('REPLACE-');
if(ok){$prefs.setValueForKey(SERVER_URL.replace(/\/+$/,''),PREFIX+'url');$prefs.setValueForKey(CAPTURE_TOKEN,PREFIX+'token');$prefs.setValueForKey('0',PREFIX+'armed');}
if(typeof $notify==='function')$notify('青龙采集中心',ok?'配置已保存':'配置未保存',ok?'可以运行 arm.js':'请先在设备本地填写域名及私有令牌');
$done({});
