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
  assert(fs.readFileSync(__dirname+'/rewrite.conf','utf8').includes('url script-response-body https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/capture.js'));
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
  let hit=await passiveProbe();
  assert(hit.store.qlcap_v1_bydhy_seen_at);
  assert(hit.notices.join(' ').includes('比亚迪域名已命中'));
  assert.equal(hit.returned.body,undefined);
  hit=await passiveProbe({armed:false});
  assert.equal(hit.store.qlcap_v1_bydhy_seen_at,undefined);
  hit=await passiveProbe({response:false});
  assert.equal(hit.store.qlcap_v1_bydhy_seen_at,undefined);
  assert(fs.readFileSync(__dirname+'/rewrite.conf','utf8').includes('url script-response-header https://raw.githubusercontent.com/masakacj/QLScriptPublic/main/quantumultx/ql-capture/capture.js'));
  console.log('PASS BYD passive host probe and paused-state isolation');

  console.log('PASS unified BYD capture allowlist, pause and no credential leaks');

  console.log('PASS 8 simulated QX setup/status flows; all notifications avoid tokens');
})().catch(e=>{console.error(e);process.exitCode=1;});
