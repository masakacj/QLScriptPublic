/* QX manual status diagnostic - no credentials or cookie values in logs. */
'use strict';
const VERSION='1.3.0', P='qlcap_v1_';
function log(x){if(typeof console!=='undefined'&&console.log)console.log('[QL Status v'+VERSION+'] '+x);}
function note(title,msg){log(title+' / '+msg);if(typeof $notify==='function')$notify('青龙采集 v'+VERSION,title,msg);}
function read(k){return $prefs.valueForKey(P+k)||'';}
function done(){log('finish');$done({});}
try{
 log('start');
 const server=read('url').replace(/\/+$/,'');
 const token=read('token');
 if(!/^https:\/\/[^/]+$/i.test(server)||token.length<32){
  note('尚未初始化','先运行 QL Setup；没有发送网络请求');done();
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
     ' · 平台：'+(Array.isArray(data.services)?data.services.join(', '):'未知'));
   }else if(code===401)note('鉴权失败','HTTP 401，请重新绑定密钥');
   else note('检查失败','HTTP '+code+'；未修改任何设置');
   done();
  }).catch(()=>{note('网络异常','网关无法访问；未修改任何设置');done();});
 }
}catch(e){note('脚本异常','检查 QX JS 兼容性；未修改任何设置');done();}
