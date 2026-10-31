/* Quantumult X HTTP Backend: private LAN read-only QL Capture status.
 * No Cookie, refresh_token, bearer token, CA key, raw HTTP record or URL
 * is ever returned. Not a native QX HTTP Analyzer history API.
 *
 * QX profile entry:
 * [http_backend]
 * https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/http-backend-status.js, tag=QL Capture Status, path=^/qlcap/status/v1/, enabled=true
 */
'use strict';
const VERSION='1.0.0', PREFIX='qlcap_v1_';
function pref(key){try{return String($prefs.valueForKey(PREFIX+key)||'');}catch(_){return '';}}
function iso(key){
 const value=pref(key);
 return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)&&
        Number.isFinite(Date.parse(value))?value:null;
}
function code(key){
 const value=Number(pref(key));
 return Number.isInteger(value)&&value>=100&&value<=599?value:null;
}
function appid(key,regex){
 const value=pref(key);
 return regex.test(value)?value:null;
}
function result(key){
 const value=pref(key);
 const allowed=[
  '四阶段记录已接收','部分阶段未接收','timeout',
  '认证响应含刷新字段','已命中，未见刷新字段',
  'Nebula 命中，有 Cookie 请求头','Nebula 命中，无 Cookie 请求头',
  '安全状态已上传','网关不可达','上传超时'
 ];
 return allowed.includes(value)?value:(value?'other':null);
}
function send(status,obj){
 $done({
  status:'HTTP/1.1 '+status,
  headers:{
   'Content-Type':'application/json; charset=utf-8',
   'Cache-Control':'no-store',
   'X-Content-Type-Options':'nosniff'
  },
  body:JSON.stringify(obj)
 });
}
try{
 const req=typeof $request==='undefined'?{}:$request;
 const path=String(req.path||'').split('?')[0];
 if(path!=='/qlcap/status/v1/'&&path!=='/qlcap/status/v1'){
  send('404 Not Found',{error:'not_found'});
 }else if(req.method&&String(req.method).toUpperCase()!=='GET'){
  send('405 Method Not Allowed',{error:'method_not_allowed'});
 }else{
  send('200 OK',{
   service:'qlcap-qx',
   version:VERSION,
   read_only:true,
   fields_are_whitelisted:true,
   capture_enabled:pref('armed')!=='0',
   aliyun:{
    seen_at:iso('aliyun_inspect_at'),
    response_http_status:code('aliyun_inspect_http'),
    has_refresh_token_field:pref('aliyun_inspect_has_refresh')==='1',
    last_result:result('aliyun_inspect_result'),
    upload_at:iso('aliyun_inspect_uploaded_at'),
    wx_appid:appid('aliyun_wx_appid',/^wx[0-9a-f]{16}$/),
    wx_appid_source:appid('aliyun_wx_appid_source',/^(referer|user_agent|request_app_id)$/),
    client_app_id:appid('aliyun_client_app_id',/^[A-Za-z0-9_.-]{2,48}$/)
   },
   kuaishou:{
    seen_at:iso('kslite_inspect_at'),
    has_cookie_header:pref('kslite_inspect_has_cookie_header')==='1',
    last_result:result('kslite_inspect_result'),
    upload_at:iso('kuaishou_inspect_uploaded_at')
   },
   shape:{
    last_at:iso('shape_last_at'),
    last_result:result('shape_last_result')
   },
   trace:{
    last_attempt_at:iso('trace_last_attempt_at'),
    last_result:pref('trace_last_result')==='pending'?'pending':null
   }
  });
 }
}catch(_){
 send('500 Internal Server Error',{error:'diagnostics_unavailable'});
}
