'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const BASE='https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/';
const files={
  setup:fs.readFileSync(__dirname+'/setup-online.js','utf8'),
  status:fs.readFileSync(__dirname+'/status.js','utf8')
};
const TOKEN='T'.repeat(48);
async function run(which,{fragment='',prefs={},answer={statusCode:200,body:'{"dry_run":true,"services":["sf"],"recent":[]}'},reject=false}={}){
  const notifications=[];
  const data={...prefs};
  let calls=0;
  let finish;
  const completed=new Promise(resolve=>{finish=resolve;});
  const sandbox={
    $environment:{sourcePath:BASE+(which==='setup'?'setup-online.js':'status.js')+fragment},
    $prefs:{valueForKey:k=>data[k]||'',setValueForKey:(v,k)=>{data[k]=v;return true;}},
    $notify:(...args)=>{notifications.push(args.join(' '));},
    $task:{fetch:async req=>{calls++;assert.equal(req.url.includes('qlcap.781751.xyz:58443'),true);assert(!req.url.includes(TOKEN));return reject?Promise.reject(new Error('down')):answer;}},
    $done:()=>finish()
  };
  vm.runInNewContext(files[which],sandbox,{timeout:1500});
  await Promise.race([completed,new Promise((_,rej)=>setTimeout(()=>rej(new Error('script did not call $done')),1200))]);
  return {notifications,data,calls};
}
(async()=>{
  let x=await run('setup');assert.equal(x.calls,0);assert(x.notifications.join(' ').includes('需要初始化'));
  x=await run('setup',{fragment:'#token='+TOKEN});
  assert.equal(x.calls,1);assert.equal(x.data.qlcap_v1_token,TOKEN);assert.equal(x.data.qlcap_v1_url,'https://qlcap.781751.xyz:58443');assert.equal(x.data.qlcap_v1_armed,'1');assert(x.notifications.join(' ').includes('初始化成功'));assert(!x.notifications.join(' ').includes(TOKEN));
  const old={'qlcap_v1_token':'OLD'.repeat(16),'qlcap_v1_url':'https://qlcap.781751.xyz:58443','qlcap_v1_armed':'1'};
  x=await run('setup',{fragment:'#token='+TOKEN,prefs:old,answer:{statusCode:401,body:'{"error":"unauthorized"}'}});
  assert.equal(x.data.qlcap_v1_token,old.qlcap_v1_token);assert.equal(x.data.qlcap_v1_armed,'1');
  x=await run('setup',{prefs:old});assert.equal(x.calls,1);assert(x.notifications.join(' ').includes('配置正常'));
  x=await run('status');assert.equal(x.calls,0);assert(x.notifications.join(' ').includes('尚未初始化'));
  x=await run('status',{prefs:old});assert.equal(x.calls,1);assert(x.notifications.join(' ').includes('DRY_RUN'));
  x=await run('status',{prefs:old,answer:{statusCode:401,body:'{"error":"unauthorized"}'}});assert(x.notifications.join(' ').includes('401'));
  x=await run('status',{prefs:old,reject:true});assert(x.notifications.join(' ').includes('网络异常'));
  // Expired debug windows must retain useful local success/failure diagnostics.
  const oldTime=new Date(Date.now()-12*60000).toISOString();
  x=await run('status',{prefs:{...old,
    qlcap_v1_trace_until:'0',qlcap_v1_trace_attempt_count:'9',
    qlcap_v1_trace_sent_count:'6',qlcap_v1_trace_failed_count:'3',
    qlcap_v1_trace_last_result:'HTTP 403',qlcap_v1_trace_last_attempt_at:oldTime,
    qlcap_v1_bydhy_reqb_seen_at:oldTime,qlcap_v1_bydhy_rsb_seen_at:oldTime}});
  const diag=x.notifications.join(' ');
  assert(diag.includes('诊断窗口已关闭'));
  assert(diag.includes('上传尝试9/成功6/失败3'));
  assert(diag.includes('HTTP 403'));
  assert(diag.includes('正文请求 12分钟前'));
  assert(diag.includes('响应 12分钟前'));
  assert(!diag.includes(TOKEN));

  const unified=fs.readFileSync(__dirname+'/capture.js','utf8');
  async function testUnified(url,responseBody,armed='1'){
   const store={qlcap_v1_armed:armed,qlcap_v1_bydhy_armed:armed};
   const notices=[];let resolveDone;
   const done=new Promise(r=>resolveDone=r);
   const sandbox={
    $request:{url,method:'POST',headers:{}},
    $response:{body:responseBody,headers:{}},
    $prefs:{valueForKey:k=>store[k]||'',setValueForKey:(v,k)=>(store[k]=v,true)},
    $notify:(...args)=>notices.push(args.join(' ')),
    $done:()=>resolveDone(),
    console:{log:()=>{}}
   };
   vm.runInNewContext(unified,sandbox,{timeout:1200});
   await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(new Error('capture did not finish')),800))]);
   return {store,notices};
  }
  let y=await testUnified('https://mina.bydoceanauto.com/?service=mina.decryptCode','YWJjZA==');
  assert.equal(y.store.qlcap_v1_bydhy_enc,'YWJjZA==');
  assert(!y.notices.join(' ').includes('YWJjZA=='));
  y=await testUnified('https://mina.bydoceanauto.com/?service=mina.decryptCode','YWJjZA==','0');
  assert.equal(y.store.qlcap_v1_bydhy_enc,undefined);
  y=await testUnified('https://invalid.example/?service=mina.decryptCode','YWJjZA==');
  assert.equal(y.store.qlcap_v1_bydhy_enc,undefined);
  assert(fs.readFileSync(__dirname+'/rewrite.conf','utf8').includes('url script-response-body https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/capture.js?v=152#trace=rsb'));
  // Actual sign-in request body is encrypted; collecting it must not execute a new sign-in.
  const signPath='https://mina.bydoceanauto.com/?s=ForCommonUcSrv.forward&serviceDir=activity/sign/signIn';
  async function testSignRequest(armed='1') {
   const store={qlcap_v1_armed:armed}; const notices=[]; let finish; let returned;
   const completion=new Promise(resolve=>finish=resolve);
   const sandbox={
    $request:{url:signPath,method:'POST',body:'YWJjZA==',headers:{}},
    $prefs:{valueForKey:k=>store[k]||'',setValueForKey:(v,k)=>(store[k]=v,true)},
    $notify:(...args)=>notices.push(args.join(' ')),
    $done:arg=>{returned=arg;finish();}, 
    $task:{fetch:()=>{throw Error('unexpected network request')}},
    console:{log:()=>{}}
   };
   vm.runInNewContext(unified,sandbox,{timeout:1200});
   await Promise.race([completion,new Promise((_,reject)=>setTimeout(()=>reject(Error('capture did not finish')),800))]);
   return {store,notices,returned};
  }
  let signResult=await testSignRequest();
  assert.equal(signResult.store.qlcap_v1_bydhy_enc,'YWJjZA==');
  assert.equal(signResult.returned.body,'YWJjZA==');
  assert(signResult.notices.join(' ').includes('签到请求已捕获'));
  signResult=await testSignRequest('0');
  assert.equal(signResult.store.qlcap_v1_bydhy_enc,undefined);
  assert.equal(signResult.returned.body,'YWJjZA==');
  assert(fs.readFileSync(__dirname+'/rewrite.conf','utf8').includes('script-request-body'));
  console.log('PASS BYD sign request-body capture without extra sign-in');
  async function passiveProbe({response=true,armed=true}={}){
   const store=armed?{qlcap_v1_armed:'1'}:{qlcap_v1_armed:'0'};
   const notices=[];let returned;
   const sandbox={
    $request:{url:'https://mina.bydoceanauto.com/?s=ForCommonUcSrv.forward&serviceDir=activity/list',method:'GET',headers:{}},
    $prefs:{valueForKey:k=>store[k]||'',setValueForKey:(v,k)=>(store[k]=v,true)},
    $notify:(...args)=>notices.push(args.join(' ')),
    $done:arg=>returned=arg, console:{log:()=>{}}
   };
   if(response)sandbox.$response={headers:{'content-type':'application/json'}};
   vm.runInNewContext(unified,sandbox,{timeout:1500});
   return {store,notices,returned};
  }
  let hit=await passiveProbe({response:false});
  assert(hit.store.qlcap_v1_bydhy_seen_at);
  assert(hit.notices.join(' ').includes('比亚迪域名已命中'));
  assert.equal(hit.returned.body,undefined);
  hit=await passiveProbe({armed:false});
  assert.equal(hit.store.qlcap_v1_bydhy_seen_at,undefined);
  hit=await passiveProbe({response:true});
  assert(hit.store.qlcap_v1_bydhy_seen_at);
  assert(fs.readFileSync(__dirname+'/rewrite.conf','utf8').includes('url script-request-body https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/capture.js?v=152#trace=reqb'));
  console.log('PASS BYD passive host probe and paused-state isolation');

  console.log('PASS unified BYD capture allowlist, pause and no credential leaks');


  async function runFourPhase(phase, {active=true, reply={statusCode:200,body:'{"accepted":true}'}, url=signPath}={}){
   const prefs={
    qlcap_v1_armed:'1', qlcap_v1_bydhy_armed:'1',
    qlcap_v1_url:'https://qlcap.781751.xyz:58443',qlcap_v1_token:TOKEN,
    qlcap_v1_trace_until:active?String(Date.now()+60000):'0',
    qlcap_v1_trace_sent_count:'0'
   };
   const original=phase==='reqb'?'test-raw-request-body':'test-raw-response-body';
   const secret='USER_SECRET_SESSION_12345';
   const notifications=[],uploads=[];
   let resolveDone;
   const completion=new Promise(resolve=>resolveDone=resolve);
   const sandbox={
    $environment:{sourcePath:BASE+'capture.js#trace='+phase},
    $request:{url,method:'POST',sessionIndex:4321,body:phase==='reqb'?original:undefined,headers:{Authorization:'Bearer '+secret}},
    $response:{statusCode:201,sessionIndex:4321,body:phase==='rsb'?original:undefined,headers:{"Set-Cookie":"sid="+secret}},
    $prefs:{valueForKey:k=>prefs[k]||'',setValueForKey:(v,k)=>(prefs[k]=v,true)},
    $notify:(...args)=>notifications.push(args.join(' ')),
    $task:{fetch:async opts=>{uploads.push(opts);return reply;}},
    $done:value=>resolveDone(value),
    setTimeout,clearTimeout,
    console:{log:()=>{}},
   };
   vm.runInNewContext(unified,sandbox,{timeout:3000});
   const result=await Promise.race([completion,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout in phase '+phase)),3500))]);
   return {result,uploads,prefs,notifications,original,secret};
  }
  for (const phase of ['reqh','reqb','rsh','rsb']){
   const t=await runFourPhase(phase);
   assert.equal(t.uploads.length,1,'upload expected for '+phase);
   const sent=JSON.parse(t.uploads[0].body);
   assert.equal(sent.session_index,'4321');
   assert.equal(sent.url,signPath);
   assert.equal(sent.stage,({reqh:'request_headers',reqb:'request_body',rsh:'response_headers',rsb:'response_body'})[phase]);
   assert.equal(t.uploads[0].headers.Authorization,'Bearer '+TOKEN);
   assert.equal(t.prefs.qlcap_v1_trace_sent_count,'1');
   assert.equal(t.prefs.qlcap_v1_trace_attempt_count,'1');
   assert.equal(t.prefs.qlcap_v1_trace_failed_count,undefined);
   assert(t.prefs.qlcap_v1_trace_last_attempt_at);
   assert.equal(t.prefs.qlcap_v1_trace_last_result,'ok/'+phase);
   assert(!t.notifications.join(' ').includes(t.secret));
   if(phase==='reqh')assert.equal(sent.headers.Authorization,'Bearer '+t.secret);
   if(phase==='rsh')assert.equal(sent.headers['Set-Cookie'],'sid='+t.secret);
   if(phase==='reqb'){
    assert.equal(t.result.body,t.original);
    assert.equal(sent.headers.Authorization,'Bearer '+t.secret);
    assert(t.prefs.qlcap_v1_bydhy_body_seen_at);
    assert(t.prefs.qlcap_v1_bydhy_reqb_seen_at);
   }
   if(phase==='rsb'){
    assert.equal(t.result.body,t.original);
    assert.equal(sent.headers['Set-Cookie'],'sid='+t.secret);
    assert.equal(sent.status,201);
    assert(t.prefs.qlcap_v1_bydhy_rsb_seen_at);
   }
  }
  const rejected=await runFourPhase('reqb',{reply:{statusCode:403,body:'{"error":"not armed"}'}});
  assert.equal(rejected.prefs.qlcap_v1_trace_attempt_count,'1');
  assert.equal(rejected.prefs.qlcap_v1_trace_failed_count,'1');
  assert.equal(rejected.prefs.qlcap_v1_trace_last_result,'HTTP 403');
  assert.equal(rejected.prefs.qlcap_v1_trace_sent_count,'0');
  assert.equal(rejected.result.body,rejected.original);
  let inactive=await runFourPhase('reqb',{active:false});
  assert.equal(inactive.uploads.length,0);
  assert.equal(inactive.result.body,inactive.original);
  inactive=await runFourPhase('reqh',{url:'https://other.example.com/'});
  assert.equal(inactive.uploads.length,0);
  assert(!inactive.notifications.join(' ').includes('USER_SECRET'));
  const bydrules=fs.readFileSync(__dirname+'/rewrite.conf','utf8').split('\n').filter(x=>x.includes('mina\\.bydoceanauto'));
  assert.equal(bydrules.filter(x=>x.includes('script-request-body')).length,1);
  assert.equal(bydrules.filter(x=>x.includes('script-response-body')).length,1);
  assert(!bydrules.some(x=>x.includes('script-request-header')||x.includes('script-response-header')));
  console.log('PASS QX four-phase HTTP capture, exact-domain/TTL gating, unchanged bodies, safe notifications');
  // Existing QL Arm must only enable 10m debug when the server has explicitly armed it.
  const armScript=fs.readFileSync(__dirname+'/arm.js','utf8');
  async function armWith(reply){
   const prefs={'qlcap_v1_token':TOKEN,'qlcap_v1_url':'https://qlcap.781751.xyz:58443'};
   const notifications=[];let finish;
   const completion=new Promise(resolve=>finish=resolve);
   vm.runInNewContext(armScript,{
    $prefs:{valueForKey:k=>prefs[k]||'',setValueForKey:(v,k)=>(prefs[k]=v,true)},
    $task:{fetch:async x=>{assert(x.url.includes('/trace/v1/config'));return reply;}},
    $notify:(...args)=>notifications.push(args.join(' ')),
    $done:()=>finish(),console:{log:()=>{}},
   },{timeout:2000});
   await Promise.race([completion,new Promise((_,rej)=>setTimeout(()=>rej(Error('arm not done')),1000))]);
   return {prefs,notifications};
  }
  let arm=await armWith({statusCode:200,body:'{"active":true,"host":"mina.bydoceanauto.com","remaining_seconds":480}'});
  assert(Number(arm.prefs.qlcap_v1_trace_until)>Date.now());
  assert(arm.notifications.join(' ').includes('深度诊断'));
  arm=await armWith({statusCode:200,body:'{"active":false,"remaining_seconds":0}'});
  assert.equal(arm.prefs.qlcap_v1_trace_until,'0');
  console.log('PASS QL Arm requires server-side trace authorization');

  console.log('PASS 8 simulated QX setup/status flows; all notifications avoid tokens');
})().catch(e=>{console.error(e);process.exitCode=1;});
