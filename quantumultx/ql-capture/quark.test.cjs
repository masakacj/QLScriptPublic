'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const DIR=__dirname+'/';
const js=name=>fs.readFileSync(DIR+name+'.js','utf8');
const token='T'.repeat(48);
const endpoint='https://qlcap.781751.xyz:58443';
function prefs(seed={}){
  const obj={...seed};
  return {obj,adapter:{valueForKey:key=>obj[key]||'',setValueForKey:(val,key)=>{obj[key]=val;return true;}}};
}
async function runScript(file,{store={},url,method='GET',headers={},reply={statusCode:200,body:'{"status":"synced","service":"quark","rerun":"queued"}'}}={}){
  const x=prefs(store),uploads=[],notifications=[];
  let finish;
  const finished=new Promise(resolve=>finish=resolve);
  const sandbox={
    $request:url?{url,method,headers}:undefined,
    $prefs:x.adapter,
    $task:{fetch:async req=>{uploads.push(req);return reply;}},
    $notify:(...args)=>notifications.push(args.join(' ')),
    $done:()=>finish(),
    setTimeout,clearTimeout,Date,console:{log:()=>{}}
  };
  vm.runInNewContext(js(file),sandbox,{timeout:2000});
  await Promise.race([finished,new Promise((_,rej)=>setTimeout(()=>rej(Error(file+' timed out')),4200))]);
  return {prefs:x.obj,uploads,notifications};
}
const u='https://drive-m.quark.cn/1/clouddrive/act/growth/reward?kps=KPSSECRET111&sign=SIGN%2BSECRET%3D&vcode=VCODESECRET222&private=ignore_me';
(async()=>{
  let q=await runScript('quark',{url:u});
  assert.equal(q.uploads.length,0,'no setup must not upload');
  q=await runScript('quark',{url:u,store:{qlcap_v1_url:endpoint,qlcap_v1_token:token}});
  assert.equal(q.uploads.length,1,'default-on should capture without Arm');
  assert.equal(q.uploads[0].url,endpoint+'/api/v1/capture');
  assert.equal(q.uploads[0].headers.Authorization,'Bearer '+token);
  const event=JSON.parse(q.uploads[0].body);
  assert.deepEqual(Object.keys(event.cookies).sort(),['kps','sign','vcode']);
  assert.equal(event.cookies.sign,'SIGN+SECRET=');
  assert.equal(event.url,'https://drive-m.quark.cn/1/clouddrive/act/growth/reward');
  assert(!JSON.stringify(event).includes('private=ignore_me'));
  assert(!q.notifications.join(' ').includes('KPSSECRET111'));
  assert(!q.notifications.join(' ').includes('SIGN+SECRET='));
  assert.equal(q.prefs.qlcap_v1_quark_last_result,'synced/任务已补跑');
  let dup=await runScript('quark',{url:u,store:q.prefs});
  assert.equal(dup.uploads.length,0,'unchanged signature should not re-upload immediately');
  q=await runScript('quark',{url:u,store:{qlcap_v1_armed:'0',qlcap_v1_url:endpoint,qlcap_v1_token:token}});
  assert.equal(q.uploads.length,0,'manual Disarm should pause');
  q=await runScript('quark',{url:u.replace('drive-m.quark.cn','evil.quark.cn'),store:{qlcap_v1_url:endpoint,qlcap_v1_token:token}});
  assert.equal(q.uploads.length,0,'only exact Quark hostname');
  q=await runScript('quark',{url:u.replace('kps=KPSSECRET111&',''),store:{qlcap_v1_url:endpoint,qlcap_v1_token:token}});
  assert.equal(q.uploads.length,0,'missing parameters must never upload');
  q=await runScript('quark',{url:u+'&kps=OTHERSECRET',store:{qlcap_v1_url:endpoint,qlcap_v1_token:token}});
  assert.equal(q.uploads.length,0,'conflicting repeated params must be rejected');
  q=await runScript('quark',{url:u,store:{qlcap_v1_url:endpoint,qlcap_v1_token:token},
    reply:{statusCode:422,body:'{"error":"invalid"}'}});
  assert.equal(q.prefs.qlcap_v1_quark_last_result,'HTTP 422');
  assert.equal(q.prefs.qlcap_v1_quark_fp,undefined,'failed validations must not mark credential as accepted');
  let x=await runScript('disarm',{store:{}});
  assert.equal(x.prefs.qlcap_v1_armed,'0');
  x=await runScript('arm',{store:x.prefs});
  assert.equal(x.prefs.qlcap_v1_armed,'1');
  assert.equal(x.prefs.qlcap_v1_quark_armed,'1');
  x=await runScript('quark',{url:u,store:{...x.prefs,qlcap_v1_url:endpoint,qlcap_v1_token:token}});
  assert.equal(x.uploads.length,1);
  const mobile='https://wx.10086.cn/qwhdhub/api/mark/do/mark';
  x=await runScript('china-mobile',{url:mobile,method:'POST',headers:{Cookie:'QWHD_SESSION_TOKEN=LOCALTOKEN12345678; Authorization=OTHERSECRET'}});
  assert.equal(x.prefs.qlcap_v1_chinaMobile_cookie,'LOCALTOKEN12345678');
  assert.equal(x.uploads.length,0,'no live trace unless explicit debug');
  assert(!x.notifications.join(' ').includes('LOCALTOKEN12345678'));
  x=await runScript('china-mobile',{url:mobile,method:'POST',
    store:{qlcap_v1_armed:'0'},headers:{Cookie:'QWHD_SESSION_TOKEN=LOCALTOKEN12345678'}});
  assert.equal(x.prefs.qlcap_v1_chinaMobile_cookie,undefined);
  const rewrite=fs.readFileSync(DIR+'rewrite.conf','utf8');
  const profile=fs.readFileSync(DIR+'qx-cookie-only.conf','utf8');
  assert(rewrite.includes('drive-m\\.quark\\.cn'));
  assert(profile.includes('hostname = mcs-mimp-web.sf-express.com, mina.bydoceanauto.com, wx.10086.cn, drive-m.quark.cn'));
  console.log('PASS default-on Quark capture + dedup + HTTP422 protection + Arm/Disarm + CMCC local capture');
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
