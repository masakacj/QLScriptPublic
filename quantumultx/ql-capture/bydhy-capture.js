/* QX BYD Ocean: allowlisted encrypted login response capture; local-only, no secret logs.
 * Match POST https://mina.bydoceanauto.com/?service=mina.decryptCode
 * Stores response under QX private prefs. No Qinglong API call or public upload.
 * To enable QL sync, the gateway must first implement validated service=bydhy.
 */
"use strict";
const P="qlcap_v1_", V="1.1.0";
function log(message){if(typeof console!=="undefined"&&console.log)console.log("[BYDHY Capture "+V+"] "+message);}
function finish(){ $done({}); }
function note(title,text){if(typeof $notify==="function")$notify("比亚迪海洋采集",title,text);}
function main(){
  if(($prefs.valueForKey(P+"armed")||"")!=="1"){log("capture not armed");return finish();}
  const url=String(($request&&$request.url)||"");
  if(!/^https:\/\/mina\.bydoceanauto\.com\/\?service=mina\.decryptCode(?:&|$)/i.test(url)){return finish();}
  const method=String(($request&&$request.method)||"").toUpperCase();
  if(method&&method!=="POST"){log("non-POST ignored");return finish();}
  if(typeof $response==="undefined"||!$response){log("response unavailable");return finish();}
  const body=String($response.body||"").trim();
  if(!body || body.length>16384 || !/^[a-zA-Z0-9+/=]+$/.test(body)){
    log("response is not AES/Base64; skipped");
    note("已命中登录接口，但响应格式不匹配","未保存凭据；检查小程序是否已登录或请求是否返回错误");
    return finish();
  }
  // Validation of the session is delegated to the trusted local QL script.
  const previous=$prefs.valueForKey(P+"bydhy_enc")||"";
  if(previous===body){log("duplicate response; skipped");return finish();}
  const saved=$prefs.setValueForKey(body,P+"bydhy_enc");
  if(saved){
    $prefs.setValueForKey(new Date().toISOString(),P+"bydhy_at");
    note("加密登录响应已保存","已保存在 QX 本地；尚未写入青龙。可运行 BYD Status 查看采集状态。");
  }
  else note("采集保存失败","未更改青龙变量");
  return finish();
}
try{main();}catch(e){log("capture failed; sensitive details suppressed");finish();}
