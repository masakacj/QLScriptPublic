/* Quantumult X / Aliyun Drive: metadata-only login-response diagnosis.
 * NO refresh-token, Cookie, headers, body, or account data is persisted or sent.
 * Only origin, HTTP status, known field presence, and capture timestamp.
 */
'use strict';
const NS='qlcap_v1_', VER='3.1.0';
const TARGET=/^https:\/\/(?:auth\.aliyundrive\.com|auth\.alipan\.com)\/v2\/account\/token(?:\?[^#]*)?$/i;
function get(k){return String($prefs.valueForKey(NS+k)||'');}
function put(k,v){return $prefs.setValueForKey(String(v),NS+k);}
function done(){
  const response=typeof $response==='undefined'?null:$response;
  if(response&&typeof response.body==='string')return $done({body:response.body});
  if(response&&response.bodyBytes)return $done({bodyBytes:response.bodyBytes});
  $done({});
}
function run(){
  if(get('armed')==='0'||get('aliyun_inspect_armed')==='0')return done();
  const request=typeof $request==='undefined'?{}:$request;
  const response=typeof $response==='undefined'?{}:$response;
  if(!TARGET.test(String(request.url||'')))return done();
  if(request.method&&String(request.method).toUpperCase()!=='POST')return done();
  const now=new Date().toISOString();
  const code=Number(response.statusCode||response.status||0);
  let data={};
  try{data=JSON.parse(response.body||'{}');}catch(_){}
  if(!data||typeof data!=='object'||Array.isArray(data))data={};
  const nested=data.data&&typeof data.data==='object'&&!Array.isArray(data.data)?data.data:{};
  const names=Array.from(new Set(Object.keys(data).concat(Object.keys(nested))))
    .filter(k=>/^[A-Za-z_][A-Za-z0-9_.-]{0,60}$/.test(k)).slice(0,45);
  put('aliyun_inspect_at',now);
  put('aliyun_inspect_http',code);
  put('aliyun_inspect_fields',names.join(','));
  put('aliyun_inspect_has_refresh',names.includes('refresh_token')?'1':'0');
  put('aliyun_inspect_result',names.includes('refresh_token')?'响应含刷新凭据字段':'已命中，未找到刷新凭据字段');
  const last=Number(get('aliyun_inspect_notified'))||0;
  if(Date.now()-last>10*60*1000){
    put('aliyun_inspect_notified',Date.now());
    if(typeof $notify==='function')$notify('QL 阿里云盘诊断 '+VER,
      '已命中认证接口 · HTTP '+code,'请运行 QL 采集状态检查字段是否存在');
  }
  done();
}
try{run();}catch(_){try{put('aliyun_inspect_result','诊断异常');}catch(__){}done();}
