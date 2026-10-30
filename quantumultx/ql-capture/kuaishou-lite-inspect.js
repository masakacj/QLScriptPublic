/* Quantumult X: local Kuaishou Lite URL-hit probe.
   Records only date of an explicitly selected endpoint, never request data. */
'use strict';
try {
  const url=String(($request&&$request.url)||'');
  const marker='https://nebula.kuaishou.com/rest/n/nebula/';
  if(url.startsWith(marker)){
    $prefs.setValueForKey(new Date().toISOString(),'qlcap_v1_kslite_inspect_at');
    $prefs.setValueForKey('命中 Nebula 请求','qlcap_v1_kslite_inspect_result');
  }
}catch(_){}
$done({});
