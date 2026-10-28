"use strict";
const fs=require("node:fs"), vm=require("node:vm"), assert=require("node:assert/strict");
const src=fs.readFileSync(__dirname+"/bydhy-capture.js","utf8");
function run({armed="1",url="https://mina.bydoceanauto.com/?service=mina.decryptCode",body="YWJjZA==",method="POST",response=true}={}){
 const vars={"qlcap_v1_armed":armed}, notifications=[];let done=0;
 const sandbox={$prefs:{valueForKey:k=>vars[k]||"",setValueForKey:(v,k)=>(vars[k]=v,true)},$request:{url,method},$notify:(...v)=>notifications.push(v.join(" ")),$done:()=>done++,console:{log:()=>{}}};
 if(response)sandbox.$response={body};
 vm.runInNewContext(src,sandbox,{timeout:1000});
 return {vars,notifications,done};
}
let x=run();assert.equal(x.done,1);assert.equal(x.vars.qlcap_v1_bydhy_enc,"YWJjZA==");assert(x.notifications.join(" ").includes("尚未写入青龙"));assert(x.vars.qlcap_v1_bydhy_at);
x=run({armed:"0"});assert.equal(x.vars.qlcap_v1_bydhy_enc,undefined);assert.equal(x.done,1);
x=run({url:"https://example.com/?service=mina.decryptCode"});assert.equal(x.vars.qlcap_v1_bydhy_enc,undefined);
x=run({url:"https://mina.bydoceanauto.com/?service=other"});assert.equal(x.vars.qlcap_v1_bydhy_enc,undefined);
x=run({body:"not base64<>"});assert.equal(x.vars.qlcap_v1_bydhy_enc,undefined);assert(x.notifications.join(" ").includes("响应格式不匹配"));
x=run({response:false});assert.equal(x.vars.qlcap_v1_bydhy_enc,undefined);
x=run({method:"GET"});assert.equal(x.vars.qlcap_v1_bydhy_enc,undefined);
x=run({method:""});assert.equal(x.vars.qlcap_v1_bydhy_enc,"YWJjZA==");
assert(!run().notifications.join(" ").includes("YWJjZA=="));
console.log("PASS 9 BYD Ocean QX capture tests (local-only, no secret notification)");
