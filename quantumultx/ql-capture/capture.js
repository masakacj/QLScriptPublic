/* QX scoped capture: preserve SF, BYD and bounded debug behavior.
 * Aliyun and Kuaishou Lite hooks are local diagnostic metadata only.
 * No new secret values are forwarded or included in notifications.
 */
'use strict';
const V='1.5.7',P='qlcap_v1_';
const sf={host:'mcs-mimp-web.sf-express.com',paths:['/mcs-mimp/','/home','/superWelfare'],
 names:['sessionId','_login_mobile_','_login_user_id_']};
function log(x){if(typeof console!=='undefined'&&console.log)console.log('[QL Capture v'+V+'] '+x);}
function get(k){return $prefs.valueForKey(P+k)||'';}
function put(k,v){return $prefs.setValueForKey(String(v),P+k);}
function done(){
 log('finish');
 // In body rewrites QX expects an unchanged original body to be returned.
 // Never remove or mutate the real sign-in/login payload.
 const url=(typeof $request!=='undefined'&&$request&&$request.url)||'';
 if(/^https:\/\/(?:auth\.aliyundrive\.com|auth\.alipan\.com)\/v2\/account\/token(?:\?|$)/i.test(url)){
  const response=typeof $response==='undefined'?null:$response;
  if(response&&typeof response.body==='string')return $done({body:response.body});
  if(response&&response.bodyBytes)return $done({bodyBytes:response.bodyBytes});
  return $done({});
 }
 if(/^https:\/\/mina\.bydoceanauto\.com\//i.test(url)){
  // A response-header hook must not send body fields as rewrite output.
  if(typeof $response!=='undefined'&&$response&&$response.headers&&typeof $response.body!=='string')return $done({});
  if(/serviceDir=activity\/sign\/signIn(?:&|$)/i.test(url)&&
     typeof $request.body==='string')return $done({body:$request.body});
  if(/service=mina\.decryptCode(?:&|$)/i.test(url)&&
     typeof $response!=='undefined'&&$response&&typeof $response.body==='string')
   return $done({body:$response.body});
 }
 $done({});
}
function header(o,n){const k=Object.keys(o||{}).find(x=>x.toLowerCase()===n);return k?String(o[k]):'';}
function extract(s){
 const out={};for(const n of sf.names){
  const m=new RegExp('(?:^|[;,]\\s*)'+n+'=([^;\\r\\n,]+)','i').exec(s||'');
  if(m&&m[1])out[n]=m[1].trim();
 }return out;
}
function complete(c){return sf.names.every(n=>typeof c[n]==='string'&&c[n].length>0);}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16);}
function note(title,message){log(title);if(typeof $notify==='function')$notify('青龙采集 v'+V,title,message);}
function probeByd(){
 // Host-level reachability diagnostic, with no URLs, headers or credentials logged.
 const now=Date.now(), last=Number(get('bydhy_probe_at'))||0;
 put('bydhy_seen_at',new Date(now).toISOString());
 if(!get('bydhy_enc')&&now-last>600000){
  put('bydhy_probe_at',String(now));
  note('比亚迪域名已命中','QX HTTPS 拦截有效；尚未捕获到登录/签到请求体');
 }
}

/* Deep trace: explicitly activated for 10 minutes, exact BYD domain only.
 * Stages are selected by the public rewrite script URL fragment.
 * No captured headers, bodies, or URL query values reach QX logs/notifications.
 */
function tracePhase(){
 const path=(typeof $environment!=='undefined'&&$environment&&$environment.sourcePath)||'';
 const match=/#trace=(reqh|reqb|rsh|rsb)(?:&|$)/.exec(path);
 return match?match[1]:'';
}
function finishPhase(stage){
 if(stage==='reqb'&&typeof $request!=='undefined'&&$request&&typeof $request.body==='string')
  return $done({body:$request.body});
 if(stage==='rsb'&&typeof $response!=='undefined'&&$response&&typeof $response.body==='string')
  return $done({body:$response.body});
 if(stage==='rsb'&&typeof $response!=='undefined'&&$response&&$response.bodyBytes)
  return $done({bodyBytes:$response.bodyBytes});
 return $done({});
}
function headersForTrace(value){
 const out={},names=Object.keys(value||{}).slice(0,90);
 for(let i=0;i<names.length;i++){
  const k=names[i]; if(!k||k.length>128)continue;
  const s=String(value[k]===undefined?'':value[k]);
  out[k]=s.slice(0,16384);
 }
 return out;
}
function validB64(text){
 return typeof text==='string'&&text.length>0&&text.length<16384&&/^[A-Za-z0-9+/=]+$/.test(text);
}
function handleBydTrace(url,stage){
 if(get('armed')==='0'||get('bydhy_armed')==='0')return finishPhase(stage);
 const req=typeof $request!=='undefined'&&$request?$request:{};
 const resp=typeof $response!=='undefined'&&$response?$response:{};
 const requestBody=typeof req.body==='string'?req.body:null;
 const responseBody=typeof resp.body==='string'?resp.body:null;
 const isSign=/[?&]s=ForCommonUcSrv\.forward(?:&|$)/.test(url)&&/[?&]serviceDir=activity\/sign\/signIn(?:&|$)/.test(url);
 const isLogin=/[?&]service=mina\.decryptCode(?:&|$)/.test(url);
 if(stage==='reqb'||stage==='rsb'){
  put('bydhy_seen_at',new Date().toISOString());
  put('bydhy_body_seen_at',new Date().toISOString());
  put('bydhy_body_last_stage',stage);
  if(stage==='reqb')put('bydhy_reqb_seen_at',new Date().toISOString());
  if(stage==='rsb')put('bydhy_rsb_seen_at',new Date().toISOString());
 }
 if(stage==='reqh'){
  put('bydhy_seen_at',new Date().toISOString());
  if(Date.now()>=(Number(get('trace_until'))||0))probeByd();
 }
 if(stage==='reqb'&&validB64(requestBody)){
  if(isSign){
   if(put('bydhy_enc',requestBody)){put('bydhy_at',new Date().toISOString());note('比亚迪凭据候选已保存','签到请求体已捕获，仅保存在 QX 本地');}
  }
 }
 if(stage==='rsb'&&isLogin&&validB64(responseBody)&&get('bydhy_enc')!==responseBody){
  if(put('bydhy_enc',responseBody)){put('bydhy_at',new Date().toISOString());note('比亚迪登录响应已保存','加密响应仅保存在 QX 本地');}
 }
 const until=Number(get('trace_until'))||0;
 if(Date.now()>=until)return finishPhase(stage);
 const server=get('url').replace(/\/+$/,'');
 const token=get('token');
 // Never send captured data to an unapproved destination even if QX prefs change.
 if(server!=='https://qlcap.781751.xyz:58443'||token.length<32){
  put('trace_last_result','gateway not configured');
  return finishPhase(stage);
 }
 const phases={reqh:'request_headers',reqb:'request_body',rsh:'response_headers',rsb:'response_body'};
 const obj={
  v:1, stage:phases[stage], url:url,
  session_index:req.sessionIndex!==undefined?String(req.sessionIndex):
   resp.sessionIndex!==undefined?String(resp.sessionIndex):null,
  method:req.method?String(req.method).toUpperCase():null,
  at:Date.now()
 };
 if(stage==='reqh'||stage==='reqb')obj.headers=headersForTrace(req.headers);
 if(stage==='rsh'||stage==='rsb'){
  obj.headers=headersForTrace(resp.headers);
  const v=Number(resp.statusCode);if(Number.isFinite(v))obj.status=v;
 }
 if(stage==='reqb'||stage==='rsb'){
  const text=stage==='reqb'?requestBody:responseBody;
  if(text===null){
   obj.body=null;
   obj.binary_body=Boolean((stage==='reqb'?req.bodyBytes:resp.bodyBytes));
  }else{
   obj.body=text.slice(0,200000);
   obj.truncated=text.length>200000;
  }
 }
 const attempts=Number(get('trace_attempt_count'))||0;
 put('trace_attempt_count',String(attempts+1));
 put('trace_last_attempt_at',new Date().toISOString());
 put('trace_last_stage',stage);
 put('trace_last_result','pending');
 let finished=false;
 function exit(){if(finished)return;finished=true;finishPhase(stage);}
 function fail(reason){
  if(finished)return;
  put('trace_failed_count',String((Number(get('trace_failed_count'))||0)+1));
  put('trace_last_result',reason);
  put('trace_last_fail_at',new Date().toISOString());
  exit();
 }
 // Use a short bounded wait, preserving the original HTTP body regardless of outcome.
 const timeout=setTimeout(()=>fail('timeout'),2500);
 try{
  $task.fetch({
   url:server+'/trace/v1/ingest',method:'POST',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(obj),opts:{policy:'direct'}
  }).then(r=>{
   if(finished)return;
   clearTimeout(timeout);
   const code=Number(r.statusCode||r.status||0);
   if(code===200){
    const prior=Number(get('trace_sent_count'))||0;
    put('trace_sent_count',String(prior+1));
    put('trace_last_sent',new Date().toISOString());
    put('trace_last_result','ok/'+stage);
    if(prior===0)note('请求诊断开始','已收到指定域名的请求/响应事件；原文只存于受控服务器内存');
    exit();
   }else fail('HTTP '+code);
  }).catch(()=>{
   if(!finished){clearTimeout(timeout);fail('network error');}
  });
 }catch(_e){
  if(!finished){clearTimeout(timeout);fail('fetch exception');}
 }
}

function captureByd(url){
 if(get('armed')==='0' || get('bydhy_armed')==='0'){log('BYD capture paused');return done();}
 const login=/^https:\/\/mina\.bydoceanauto\.com\/\?service=mina\.decryptCode(?:&|$)/i.test(url);
 const signing=/^https:\/\/mina\.bydoceanauto\.com\/\?s=ForCommonUcSrv\.forward&serviceDir=activity\/sign\/signIn(?:&|$)/i.test(url);
 if(!login&&!signing){
  // Request-header hooks have no $response; still record the hostname hit.
  probeByd();
  return done();
 }
 const method=String(($request&&$request.method)||'').toUpperCase();
 if(method&&method!=='POST')return done();
 // Sign-in request body already contains the AES-encrypted session_id.
 // Capture the outgoing body before the server handles the daily sign; do not replay it.
 const body=String(signing?($request&&$request.body||''):(typeof $response!=='undefined'&&$response?$response.body:'')||'').trim();
 if(!body){
  // Empty request/response bodies are not credential failures.
  probeByd();
  return done();
 }
 if(body.length>16384||!/^[A-Za-z0-9+/=]+$/.test(body)){
  note('比亚迪加密数据格式不匹配','检查 QX 请求体及重写命中情况');return done();
 }
 if(get('bydhy_enc')===body){log('BYD response unchanged');return done();}
 const saved=put('bydhy_enc',body);
 put('bydhy_seen_at',new Date().toISOString());
 if(saved){
  put('bydhy_at',new Date().toISOString());
  note('比亚迪凭据候选已保存',signing?'签到请求已捕获，QX 本地保存；未重放签到，也未同步青龙':'登录响应已捕获，QX 本地保存；未同步青龙');
 }else note('比亚迪保存失败','未修改青龙');
 done();
}
/* Send ONLY Boolean/status data. The authorized server rejects unexpected
 * keys and never accepts a request URL, Cookie, token, or response body.
 * This is separate from the explicit manually armed raw debug capture.
 */
function sendQXHit(service,stage,method,httpStatus,fieldPresent){
 const server=String(get('url')||'').replace(/\/+$/,'');
 const token=String(get('token')||'');
 if(server!=='https://qlcap.781751.xyz:58443'||token.length<32){
  put(service+'_inspect_upload','网关未配置');
  return done();
 }
 const event={
  v:1,type:'qx_event_metric_v1',service:service,stage:stage,
  method:method,http_status:httpStatus,auth_field_present:Boolean(fieldPresent)
 };
 let finished=false;
 const finish=()=>{
  if(finished)return;finished=true;done();
 };
 const timeout=setTimeout(()=>{
  put(service+'_inspect_upload','上传超时');
  finish();
 },2400);
 try{
  $task.fetch({
   url:server+'/trace/v1/ingest',method:'POST',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(event),opts:{policy:'direct'}
  }).then(r=>{
   if(finished)return;clearTimeout(timeout);
   const code=Number(r.statusCode||r.status||0);
   put(service+'_inspect_upload',code===200?'安全状态已上传':'HTTP '+code);
   if(code===200)put(service+'_inspect_uploaded_at',new Date().toISOString());
   finish();
  }).catch(()=>{
   if(finished)return;clearTimeout(timeout);
   put(service+'_inspect_upload','网关不可达');
   finish();
  });
 }catch(_){
  clearTimeout(timeout);
  put(service+'_inspect_upload','提交异常');
  finish();
 }
}
/* Aliyun response is pass-through; only safe status and credential-field
 * presence are stored locally and transmitted as Boolean metadata.
 */
function inspectAliyun(url){
 if(get('armed')==='0'||get('aliyun_inspect_armed')==='0')return done();
 if(!/^https:\/\/(?:auth\.aliyundrive\.com|auth\.alipan\.com)\/v2\/account\/token(?:\?|$)/i.test(url))return done();
 const req=typeof $request==='undefined'?{}:$request;
 const res=typeof $response==='undefined'?{}:$response;
 if(req.method&&String(req.method).toUpperCase()!=='POST')return done();
 put('aliyun_inspect_at',new Date().toISOString());
 const code=Number(res.statusCode||res.status||0);
 if(Number.isInteger(code)&&code>=100&&code<=599)put('aliyun_inspect_http',code);
 let data={};
 if(typeof res.body==='string'&&res.body.length<150000){
  try{data=JSON.parse(res.body);}catch(_){}
 }
 if(!data||typeof data!=='object'||Array.isArray(data))data={};
 const nested=data.data&&typeof data.data==='object'&&!Array.isArray(data.data)?data.data:{};
 const fields=Array.from(new Set(Object.keys(data).concat(Object.keys(nested))))
   .filter(k=>/^[A-Za-z_][A-Za-z0-9_.-]{0,59}$/.test(k)).slice(0,40);
 const hasRefresh=fields.includes('refresh_token');
 put('aliyun_inspect_has_refresh',hasRefresh?'1':'0');
 put('aliyun_inspect_result',hasRefresh?'认证响应含刷新字段':'已命中，未见刷新字段');
 const last=Number(get('aliyun_inspect_notified'))||0;
 if(Date.now()-last>600000){
  put('aliyun_inspect_notified',String(Date.now()));
  note('阿里云盘接口已命中','HTTP '+(code||'?')+' · '+(hasRefresh?'发现刷新字段':'无刷新字段')+'；未保存凭据内容');
 }
 return sendQXHit('aliyun','response','POST',Number.isInteger(code)?code:0,hasRefresh);
}
/* Kuaishou Lite request endpoint and Cookie header presence only. */
function inspectKuaishou(url){
 if(get('armed')==='0'||get('kslite_inspect_armed')==='0')return done();
 if(!/^https:\/\/nebula\.kuaishou\.com\/rest\/n\/nebula\/(?:activity\/earn\/overview|sign\/query)(?:\?|$)/i.test(url))return done();
 const req=typeof $request==='undefined'?{}:$request;
 const method=String(req.method||'GET').toUpperCase();
 if(method!=='GET'&&method!=='POST')return done();
 const present=Boolean(header(req.headers||{},'cookie'));
 put('kslite_inspect_at',new Date().toISOString());
 put('kslite_inspect_has_cookie_header',present?'1':'0');
 put('kslite_inspect_result',present?'Nebula 命中，有 Cookie 请求头':'Nebula 命中，无 Cookie 请求头');
 const last=Number(get('kslite_inspect_notified'))||0;
 if(Date.now()-last>600000){
  put('kslite_inspect_notified',String(Date.now()));
  note('快手极速版接口已命中',present?'检测到 Cookie 请求头；未保存凭据内容':'未检测到 Cookie 请求头');
 }
 return sendQXHit('kuaishou','request',method,null,present);
}

/* Per-domain HTTP structure recording. Each body rewrite reports headers
 * and JSON field names as two separate stages. Never forward original values.
 */
function shapePhase(){
 const s=(typeof $environment!=='undefined'&&$environment&&$environment.sourcePath)||'';
 const m=/#shape=(reqb|rsb)(?:&|$)/.exec(s);
 return m?m[1]:'';
}
function fieldKeys(value){
 if(!value||typeof value!=='object')return [];
 return Object.keys(value).filter(k=>/^[A-Za-z_][A-Za-z0-9_.-]{0,55}$/.test(k)).slice(0,40);
}
function jsonKeys(body){
 if(typeof body!=='string'||body.length>200000)return [];
 let obj;try{obj=JSON.parse(body);}catch(e){return [];}
 const keys=fieldKeys(obj);
 if(obj&&obj.data&&typeof obj.data==='object'){
  for(const key of fieldKeys(obj.data)){if(keys.indexOf(key)<0&&keys.length<40)keys.push(key);}
 }
 return keys;
}
function sortedFields(names){
 return names.filter(k=>/^[A-Za-z_][A-Za-z0-9_.-]{0,55}$/.test(k)).slice(0,40);
}
function recordHTTPShape(source,stage){
 if(get('armed')==='0'||get('shape_armed')==='0')return finishPhase(stage);
 const match=/^https:\/\/([^/?#]+)(\/[^?#]*)(?:\?([^#]*))?/i.exec(source);
 if(!match)return finishPhase(stage);
 const host=match[1].toLowerCase(),path=match[2];
 if(!((host==='auth.aliyundrive.com'||host==='auth.alipan.com')&&path.indexOf('/v2/account/')===0) &&
    !(host==='nebula.kuaishou.com'&&path.indexOf('/rest/n/nebula/')===0))return finishPhase(stage);
 if(!/^[\/a-zA-Z0-9_.-]+$/.test(path)||path.length>180)return finishPhase(stage);
 const req=typeof $request==='undefined'?{}:$request;
 const res=typeof $response==='undefined'?{}:$response;
 const method=String(req.method||'GET').toUpperCase();
 if(method!=='GET'&&method!=='POST')return finishPhase(stage);
 const server=String(get('url')||'').replace(/\/+$/,''),token=String(get('token')||'');
 if(server!=='https://qlcap.781751.xyz:58443'||token.length<32)return finishPhase(stage);
 const query=match[3]||'',names=[];
 for(const pair of query.split('&')){
  const key=pair.split('=')[0];
  if(key){try{names.push(decodeURIComponent(key));}catch(e){}}
 }
 const queryKeys=sortedFields(Array.from(new Set(names)));
 const h=stage==='reqb'?req.headers:res.headers;
 const headers=sortedFields(Object.keys(h||{}));
 const body=stage==='reqb'?req.body:res.body;
 const length=typeof body==='string'?Math.min(body.length,200000):null;
 const keys=jsonKeys(body);
 const status=stage==='rsb'?Number(res.statusCode||res.status||0):null;
 const base={v:1,type:'qx_structure_v1',host,path,method,query_keys:queryKeys};
 const items=stage==='reqb'?[
  {...base,stage:'request_headers',header_keys:headers,body_keys:[],body_length:null,status:null},
  {...base,stage:'request_body',header_keys:[],body_keys:keys,body_length:length,status:null}
 ]:[
  {...base,stage:'response_headers',header_keys:headers,body_keys:[],body_length:null,status:Number.isFinite(status)?status:0},
  {...base,stage:'response_body',header_keys:[],body_keys:keys,body_length:length,status:Number.isFinite(status)?status:0}
 ];
 put(host==='nebula.kuaishou.com'?'kslite_inspect_at':'aliyun_inspect_at',new Date().toISOString());
 let finished=false;
 const exit=()=>{if(finished)return;finished=true;finishPhase(stage);};
 const watchdog=setTimeout(()=>{put('shape_last_result','timeout');exit();},2700);
 try{
  const sends=items.map(payload=>$task.fetch({
   url:server+'/trace/v1/ingest',method:'POST',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(payload),opts:{policy:'direct'}
  }).then(reply=>Number(reply.statusCode||reply.status||0)===200).catch(()=>false));
  Promise.all(sends).then(values=>{
   if(finished)return;
   clearTimeout(watchdog);
   const ok=values.filter(Boolean).length;
   put('shape_last_result',ok===2?'四阶段记录已接收':'部分阶段未接收');
   put('shape_last_at',new Date().toISOString());
   exit();
  }).catch(()=>{clearTimeout(watchdog);exit();});
 }catch(e){clearTimeout(watchdog);exit();}
}

function main(){
 const source=(typeof $request!=='undefined'&&$request&&$request.url)||'';
 const phase=shapePhase();
 if(/^https:\/\/(?:auth\.aliyundrive\.com|auth\.alipan\.com)\/v2\/account\//i.test(source)){
  if(phase)return recordHTTPShape(source,phase);
  return inspectAliyun(source);
 }
 if(/^https:\/\/nebula\.kuaishou\.com\/rest\/n\/nebula\//i.test(source)){
  if(phase)return recordHTTPShape(source,phase);
  return inspectKuaishou(source);
 }
 if(/^https:\/\/mina\.bydoceanauto\.com\//i.test(source)){
  const stage=tracePhase();
  return stage?handleBydTrace(source,stage):captureByd(source);
 }
 if(get('armed')==='0'){log('skipped: capture paused');return done();}
 const server=get('url').replace(/\/+$/,''),token=get('token');
 if(!/^https:\/\/[^/]+$/i.test(server)||token.length<32){log('skipped: setup absent');return done();}
 const m=/^https:\/\/([^/?#]+)(\/[^?#]*)/i.exec(source);
 if(!m||m[1].toLowerCase()!==sf.host||!sf.paths.some(p=>m[2].startsWith(p))){
  log('skipped: source not on allowlist');return done();
 }
 const req=extract(header(($request||{}).headers,'cookie'));
 const rsp=typeof $response==='undefined'?{}:extract(header($response.headers,'set-cookie'));
 const cookies=complete(req)?req:rsp;
 if(!complete(cookies)){log('matched SF; required fields missing');return done();}
 log('matched SF; required fields present');
 const fp=hash(sf.names.map(k=>k+'='+cookies[k]).join('\0'));
 const last=get('sent_sf').split('|');
 if(last[0]===fp){log('skipped: recently sent');return done();}
 const payload={service:'sf',url:'https://'+sf.host+m[2],captured_at:Date.now(),cookies};
 log('submitting allowlisted fields to gateway');
 $task.fetch({url:server+'/api/v1/capture',method:'POST',
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify(payload),opts:{policy:'direct'}}).then(r=>{
   const code=Number(r.statusCode||r.status||0);log('gateway HTTP '+code);
   let body={};try{body=JSON.parse(r.body||'{}');}catch(e){log('response JSON invalid');}
   if(code===200&&['synced','unchanged','dry_run'].includes(body.status)){
    put('sent_sf',fp+'|'+Date.now());
    if(body.status==='dry_run')note('顺丰 Cookie 获取成功','测试模式 · 已收到凭证，未写入青龙');
    else if(body.rerun==='queued')note('顺丰 Cookie 已刷新','青龙过期任务已补跑一次，等待执行结果');
    else if(body.status==='synced')note('顺丰 Cookie 同步成功','已更新青龙对应账号');
    else note('顺丰 Cookie 已是最新','青龙无需更新');
   }else note('网关拒绝','HTTP '+code+'；旧青龙值保持不变');
   done();
 }).catch(()=>{note('上传失败','HTTPS 连接失败；未修改青龙');done();});
}
try{main();}catch(e){log('script exception; details withheld');done();}
