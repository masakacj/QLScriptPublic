/* QX scheduled recovery-result notifier. No cookie/secret in logs. */
'use strict';
const V='1.0.0',P='qlcap_v1_';
function read(k){return $prefs.valueForKey(P+k)||'';}
function put(k,v){return $prefs.setValueForKey(String(v),P+k);}
function log(x){console.log('[QL Recovery Notice v'+V+'] '+x);}
function done(){$done({});}
const server=read('url').replace(/\/+$/,''),token=read('token');
if(!/^https:\/\/[^/]+$/i.test(server)||token.length<32){log('not configured');done();}
else $task.fetch({url:server+'/api/v1/status',method:'GET',
 headers:{Authorization:'Bearer '+token},opts:{policy:'direct'}})
.then(r=>{
 if(Number(r.statusCode||r.status||0)!==200){log('gateway status rejected');return done();}
 let data;try{data=JSON.parse(r.body||'{}');}catch(e){return done();}
 if(!Array.isArray(data.recovery))return done();
 for(const item of data.recovery){
  if(!item||!item.service||!item.at||!item.result)continue;
  const id=String(item.service).replace(/[^A-Za-z0-9_]/g,'');
  if(!id)continue;
  const key='recovery_notice_'+id;
  const mark=String(item.result)+'|'+String(item.at);
  if(read(key)===mark)continue;
  let title='',message='';
  if(item.result==='login_expired'){title='登录已过期';message='请打开对应应用，刷新 Cookie 后将自动补跑一次';}
  else if(item.result==='completed'){
   title='过期后补跑成功';
   const delta=typeof item.points_delta==='number'?' · 积分 '+(item.points_delta>=0?'+':'')+item.points_delta:'';
   const total=typeof item.points_total==='number'?' · 当前 '+item.points_total:'';
   message='青龙任务已完成'+delta+total;
  }else if(item.result==='expired_again'){title='补跑失败';message='新 Cookie 仍无效，请重新登录';}
  else if(item.result==='task_failed'){title='补跑需检查';message='青龙任务已执行，但未确认成功，请查看任务日志';}
  else continue;
  // Save first so repeated QX scheduled runs do not spam notifications.
  put(key,mark);
  if(typeof $notify==='function')$notify('青龙自动恢复 · '+id,title,message);
  log('notified '+id+' '+item.result);
 }
 done();
}).catch(()=>{log('status fetch failed');done();});
