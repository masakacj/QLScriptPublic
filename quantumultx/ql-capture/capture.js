/* QX: explicit SF request/response header capture. Do not log headers or secrets. */
'use strict';
const V='1.5.0',P='qlcap_v1_';
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
 if(stage==='reqh')probeByd();
 if(stage==='reqb'&&validB64(requestBody)){
  if(isSign){
   if(put('bydhy_enc',requestBody)){put('bydhy_at',new Date().toISOString());note('比亚迪凭据候选已保存','签到请求体已捕获，仅保存在 QX 本地');}
  }else{
   // May contain a session_id but is not verified; never overwrite the primary credential.
   put('bydhy_other_enc',requestBody);
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
  method:String(req.method||'GET').toUpperCase(),
  at:Date.now()
 };
 if(stage==='reqh')obj.headers=headersForTrace(req.headers);
 if(stage==='rsh'){
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
 let finished=false;
 function exit(){if(finished)return;finished=true;finishPhase(stage);}
 // Limit diagnostic overhead for user traffic. Late responses are ignored.
 const timeout=setTimeout(exit,1800);
 $task.fetch({
  url:server+'/trace/v1/ingest', method:'POST',
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
   put('trace_last_result','ok');
   if(prior===0)note('请求诊断开始','已接收到指定域名的请求/响应事件；原文仅在受控服务器内存');
  }else{
   put('trace_last_result','HTTP '+code);
  }
  exit();
 }).catch(()=>{
  if(!finished){clearTimeout(timeout);put('trace_last_result','network error');exit();}
 });
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
function main(){
 const source=(typeof $request!=='undefined'&&$request&&$request.url)||'';
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
