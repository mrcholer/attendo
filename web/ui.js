(() => {
'use strict';
const $=id=>document.getElementById(id), main=$('overview'), api=window.xattendoV6;
if(!main||!api)return;
const form=$('intra-form'), uid=$('intra-uid'), secret=$('intra-secret'), state=$('intra-state'), msg=$('intra-message');
let settingsActive=false, busy=false, config=null, generation=0;
const buttonIds=['intra-save','intra-test','intra-disconnect'];
function controls(){for(const id of buttonIds)$(id).disabled=busy; $('intra-test').disabled=busy||!config?.configured;$('intra-disconnect').disabled=busy||!config?.configured;uid.disabled=secret.disabled=busy;form.setAttribute('aria-busy',String(busy));}
function render(data){config=data;state.textContent=data.connected?'Connected':data.configured?'Configured · renews on demand':data.manual?'Manual token':'Not connected';state.dataset.connected=String(!!data.connected);uid.placeholder=data.uid_hint||'Your application UID';msg.textContent=data.connected?'Application authorized. Open 42 Intra profile to refresh your projects.':data.configured?'Saved locally. The next request renews your token automatically.':data.manual?'Manual token available. Connect an application for automatic renewal.':'Enter the UID and secret from your 42 API application.';controls();}
async function action(kind,values){
 if(busy)return;
 const id=++generation;busy=true;controls();state.textContent='Checking…';msg.textContent=kind==='connect'?'Authorizing your application…':kind==='disconnect'?'Removing saved credentials…':'Checking connection…';
 try{const opt={cache:'no-store',signal:AbortSignal.timeout(25000)};if(kind){opt.method='POST';opt.headers={'Content-Type':'application/json'};opt.body=JSON.stringify({action:kind,...values})}
 const response=await fetch('/api/intra/config',opt);const data=await response.json();if(!response.ok)throw Error(data.error||'Connection request failed.');
 if(id!==generation)return;render(data);if(kind==='connect'||kind==='disconnect'){uid.value='';secret.value='';api.notify(kind==='connect'?'42 API application connected':'Saved API credentials removed');}
 }catch(e){if(id===generation){state.textContent='Connection unavailable';state.dataset.connected='false';msg.textContent=e.message;api.notify(e.message,true)}}
 finally{if(id===generation){busy=false;secret.value='';controls();}}
}
form.addEventListener('submit',e=>{e.preventDefault();action('connect',{uid:uid.value.trim(),secret:secret.value.trim()})});
$('intra-test').onclick=()=>action('test');
$('intra-disconnect').onclick=()=>{if(confirm('Remove the saved 42 API application credentials from this workstation? Manual token files are not removed.'))action('disconnect')};
function nav(){const active=!main.hidden&&main.dataset.view==='settings';if(active&&!settingsActive&&!busy)action();if(!active&&settingsActive){uid.value='';secret.value=''}settingsActive=active;}
new MutationObserver(nav).observe(main,{attributes:true,attributeFilter:['data-view','hidden']});nav();
function node(tag,cls){const n=document.createElement(tag);n.className=cls;return n}
function line(w,h=12){const n=node('span','skeleton');n.style.setProperty('--w',w);n.style.height=h+'px';return n}
function skeleton(kind){const root=node('div','v73-skeleton');root.setAttribute('aria-hidden','true');const metrics=node('div','v73-skeleton-metrics');const count=kind==='profile'?4:kind==='insights'?3:kind==='focus'?3:kind==='calendar'?0:4;for(let i=0;i<count;i++){const card=node('div','v73-skeleton-metric');card.append(line('65%'),line('45%',27));metrics.append(card)}if(count)root.append(metrics);
if(kind==='calendar'){const calendar=node('div','v73-skeleton-calendar');for(let i=0;i<35;i++){const cell=node('div','v73-skeleton-metric');cell.append(line('40%'),line('65%'));calendar.append(cell)}root.append(calendar)}
else if(['sessions','history','insights','focus'].includes(kind)){const chart=node('div','v73-skeleton-chart');for(let i=0;i<16;i++){const bar=line('100%',24+((i*37)%88));chart.append(bar)}root.append(chart)}
else {for(let i=0;i<4;i++){const row=node('div','v73-skeleton-row');row.append(line('38%'),line('22%'));root.append(row)}}return root}
const busyNodes=new Map();
function setSkeleton(target,kind,on){if(!target)return;const existing=busyNodes.get(target);if(on){if(existing)return;const sk=skeleton(kind);target.before(sk);target.classList.add('v73-loading-target');target.setAttribute('aria-busy','true');busyNodes.set(target,sk)}else if(existing){existing.remove();target.classList.remove('v73-loading-target');target.removeAttribute('aria-busy');busyNodes.delete(target)}}
window.xattendoUI={campusBusy(v,on){if(v==='profile'){setSkeleton($('v7-profile'),v,on);setSkeleton($('v7-projects'),'reports',on)}else{setSkeleton($('v7-timeline'),v,on);setSkeleton($('v7-rows')?.closest('.table-wrap'),'reports',on)}}};
const dataPages={calendar:'v6-calendar',reports:'v6-month-metrics',insights:'v6-forecast-chart',focus:'v6-focus-metrics'};
function reportLoading(){const view=main.dataset.view,waiting=!main.hidden&&$('refresh').disabled&&$('day-report').hidden;for(const [kind,id] of Object.entries(dataPages))setSkeleton($(id),kind,waiting&&view===kind);setSkeleton($('v6-connections'),'reports',!main.hidden&&view==='system'&&$('v6-check').disabled);}
const observer=new MutationObserver(reportLoading);observer.observe(main,{attributes:true,attributeFilter:['data-view','hidden']});observer.observe($('refresh'),{attributes:true,attributeFilter:['disabled']});observer.observe($('day-report'),{attributes:true,attributeFilter:['hidden']});observer.observe($('v6-check'),{attributes:true,attributeFilter:['disabled']});reportLoading();
})();
