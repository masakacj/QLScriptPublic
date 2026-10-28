/* QX manual status diagnostic - no credentials or cookie values in logs. */
'use strict';
const VERSION='1.5.2', P='qlcap_v1_';
function log(x){if(typeof console!=='undefined'&&console.log)console.log('[QL Status v'+VERSION+'] '+x);}
function note(title,msg){log(title+' / '+msg);if(typeof $notify==='function')$notify('青龙采集 v'+VERSION,title,msg);}
function read(k){return $prefs.valueForKey(P+k)||'';}
function done(){log('finish');$done({});}
function age(key){
 const ms=Date.parse(read(key));
 if(!Number.isFinite(ms))return '从未';
 const mins=Math.max(0,Math.floor((Date.now()-ms)/60000));
 return mins<1?'刚刚':mins<60?mins+'分钟前':mins<1440?Math.floor(mins/60)+'小时前':Math.floor(mins/1440)+'天前';
}
function traceStatus(){
 const sec=Math.max(0,Math.floor(((Number(read('trace_until'))||0)-Date.now())/1000));
 const attempted=Number(read('trace_attempt_count'))||0;
 const ok=Number(read('trace_sent_count'))||0;
 const failed=Number(read('trace_failed_count'))||0;
 const result=read('trace_last_result')||'未记录';
 return (sec>0?'诊断剩余'+sec+'秒':'诊断窗口已关闭')+
  ' · 上传尝试'+attempted+'/成功'+ok+'/失败'+failed+
  ' · 最近'+result+'（'+age('trace_last_attempt_at')+'）';
}
function bydStatus(){
 const hit=Boolean(read('bydhy_seen_at'));
 const status=read('bydhy_enc')?'本地有加密候选（未同步青龙）':hit?'域名已命中':'域名未命中';
 const rq=read('bydhy_reqb_seen_at'),rs=read('bydhy_rsb_seen_at');
 const older=read('bydhy_body_seen_at');
 const stages=(rq||rs)?('正文请求 '+age('bydhy_reqb_seen_at')+' / 响应 '+age('bydhy_rsb_seen_at')):
    older?('正文曾触发 '+age('bydhy_body_seen_at')+'，阶段未区分'):'正文未触发';
 return status+' · '+stages;
}
try{
 log('start');
 const server=read('url').replace(/\/+$/,'');
 const token=read('token');
 if(!/^https:\/\/[^/]+$/i.test(server)||token.length<32){
  note('尚未初始化','先运行 QL Setup；比亚迪：'+bydStatus()+' · '+traceStatus());done();
 }else{
  log('preferences present; fetching gateway status');
  const began=Date.now();
  $task.fetch({url:server+'/api/v1/status',method:'GET',
   headers:{Authorization:'Bearer '+token,Accept:'application/json'},opts:{policy:'direct'}})
  .then(r=>{
   const code=Number(r.statusCode||r.status||0);log('gateway HTTP '+code);
   let data={};try{data=JSON.parse(r.body||'{}');}catch(e){log('response JSON invalid');}
   if(code===200&&typeof data.dry_run==='boolean'){
    note('网关可用 · '+(Date.now()-began)+'ms',
     '模式：'+(data.dry_run?'DRY_RUN':'正式写入')+' · 采集：'+(read('armed')==='1'?'开启':'关闭')+
     ' · 比亚迪：'+bydStatus()+' · '+traceStatus()+' · 平台：'+(Array.isArray(data.services)?data.services.join(', '):'未知')+
     (Array.isArray(data.recovery)&&data.recovery.length?' · 自动恢复：'+data.recovery.map(x=>x.service+'/'+x.result+(typeof x.points_delta==='number'?'/积分'+x.points_delta:'')).join(','):' · 自动恢复：无待处理'));
   }else if(code===401)note('鉴权失败','HTTP 401；比亚迪：'+bydStatus()+' · '+traceStatus());
   else note('检查失败','HTTP '+code+'；比亚迪：'+bydStatus()+' · '+traceStatus());
   done();
  }).catch(()=>{note('网络异常','网关无法访问；比亚迪：'+bydStatus()+' · '+traceStatus());done();});
 }
}catch(e){note('脚本异常','检查 QX JS 兼容性；未修改任何设置');done();}
