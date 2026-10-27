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
  assert.equal(x.calls,1);assert.equal(x.data.qlcap_v1_token,TOKEN);assert.equal(x.data.qlcap_v1_url,'https://qlcap.781751.xyz:58443');assert.equal(x.data.qlcap_v1_armed,'0');assert(x.notifications.join(' ').includes('初始化成功'));assert(!x.notifications.join(' ').includes(TOKEN));
  const old={'qlcap_v1_token':'OLD'.repeat(16),'qlcap_v1_url':'https://qlcap.781751.xyz:58443','qlcap_v1_armed':'1'};
  x=await run('setup',{fragment:'#token='+TOKEN,prefs:old,answer:{statusCode:401,body:'{"error":"unauthorized"}'}});
  assert.equal(x.data.qlcap_v1_token,old.qlcap_v1_token);assert.equal(x.data.qlcap_v1_armed,'1');
  x=await run('setup',{prefs:old});assert.equal(x.calls,1);assert(x.notifications.join(' ').includes('配置正常'));
  x=await run('status');assert.equal(x.calls,0);assert(x.notifications.join(' ').includes('尚未配置'));
  x=await run('status',{prefs:old});assert.equal(x.calls,1);assert(x.notifications.join(' ').includes('DRY_RUN'));
  x=await run('status',{prefs:old,answer:{statusCode:401,body:'{"error":"unauthorized"}'}});assert(x.notifications.join(' ').includes('401'));
  x=await run('status',{prefs:old,reject:true});assert(x.notifications.join(' ').includes('网络异常'));
  console.log('PASS 8 simulated QX setup/status flows; all notifications avoid tokens');
})().catch(e=>{console.error(e);process.exitCode=1;});
