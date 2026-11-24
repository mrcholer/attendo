(() => {
const $=id=>document.getElementById(id), main=$('overview'), api=window.xattendoV6;
if(!main||!api)return;
const el=(tag,value='',cls='')=>{const n=document.createElement(tag);n.textContent=value;n.className=cls;return n};
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const fmt=n=>finite(n)?Math.floor(n/3600)+'h '+String(Math.floor(n%3600/60)).padStart(2,'0')+'m':'—';
const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Casablanca',hour:'2-digit',minute:'2-digit'});
const time=n=>clock.format(new Date(n));
const profile=$('v7-profile'),projects=$('v7-projects'),timeline=$('v7-timeline'),rows=$('v7-rows'),status=$('v7-status'),date=$('v7-date');
let request=null,key='',view='';
function metric(k,v){const n=el('div','','v6-metric');n.append(el('span',k,'v5-muted'),el('strong',v));return n}
function clear(){request?.abort();request=null;for(const n of [profile,projects,timeline,rows,status])n.replaceChildren();for(const id of ['v7-profile-refresh','v7-session-refresh'])$(id).disabled=false}
function profileView(d){
profile.replaceChildren();projects.replaceChildren();
if(!d.login){profile.append(el('p',d.message||'Profile unavailable'));return}
const p=d.profile,c=p?.cursus?.filter(x=>!x.end_at).at(-1)||p?.cursus?.at(-1);
const ident=el('div','','v7-identity'), avatar=el('div',d.login.slice(0,2).toUpperCase(),'v7-avatar'), info=el('div');
info.append(el('h2',p?.name||d.login),el('p','@'+d.login+' · '+(p?.campuses?.join(', ')||'42 Intra'),'v5-muted'));
const link=el('a','Open Intra ↗','button');link.href='https://profile.intra.42.fr/users/'+encodeURIComponent(d.login);link.target='_blank';link.rel='noopener noreferrer';ident.append(avatar,info,link);profile.append(ident);
const metrics=el('div','','v6-metrics');metrics.append(metric('Level',finite(c?.level)?c.level.toFixed(2):'—'),metric('Wallet',finite(p?.wallet)?String(p.wallet):'—'),metric('Correction points',finite(p?.correction_points)?String(p.correction_points):'—'),metric('Projects',p?.projects_available?String(p.projects.length):'—'));profile.append(metrics);
if(d.message)profile.append(el('p',d.message,'v5-muted'));
for(const c of p?.cursus||[]){const r=el('div','','v7-detail');r.append(el('span',c.name||'Cursus'),el('strong',finite(c.level)?'Level '+c.level.toFixed(2):'—'));profile.append(r)}
if(!p?.projects_available){projects.append(el('p','Project details unavailable. Configure an authorized API token.','v5-muted'));return}
if(!p.projects.length)projects.append(el('p','No project records returned.','v5-muted'));
for(const p of p.projects){const r=el('div','','v7-detail');r.append(el('span',p.name),el('span',(p.validated?'Validated':p.status||'Unknown')+(finite(p.mark)?' · '+p.mark:'')));projects.append(r)}
}
function sessionView(d){
timeline.replaceChildren();rows.replaceChildren();status.textContent=(d.notes||[]).join(' ');
const lo=Date.parse(d.start),hi=Date.parse(d.end),cut=Math.min(hi,Date.parse(d.observed_through));
if(!Number.isFinite(lo)||!Number.isFinite(hi)||!Number.isFinite(cut)||hi<=lo)return;
const interval=(data,type)=>(Array.isArray(data)?data:[]).flatMap(r=>{const a=Math.max(lo,Date.parse(r.start)),b=Math.min(cut,Date.parse(r.end));return b>a?[{a,b,type,host:r.host,ongoing:r.ongoing}]:[]}).sort((a,b)=>a.a-b.a);
const loc=interval(d.locations,'Location'),locks=interval(d.locks,'Lock');
function total(rs){let end=-Infinity,sum=0;for(const r of rs){sum+=Math.max(0,r.b-Math.max(r.a,end));end=Math.max(end,r.b)}return sum/1000}
const m=el('div','','v6-metrics');m.append(metric('Location time',Array.isArray(d.locations)?fmt(total(loc)):'—'),metric('Observed locks',Array.isArray(d.locks)?fmt(total(locks)):'—'),metric('Location sessions',Array.isArray(d.locations)?String(loc.length):'—'),metric('Lock intervals',Array.isArray(d.locks)?String(locks.length):'—'));timeline.append(m);
const axis=el('div','','v7-axis');for(let j=0;j<=4;j++)axis.append(el('span',j===4?'24:00':time(lo+(hi-lo)*j/4)));timeline.append(axis);
const detail=el('p','Select a segment. Gray areas are unknown, not verified absences.','v5-muted');
for(const [label,rs,available] of [['Campus location',loc,Array.isArray(d.locations)],['Observed screen locks',locks,Array.isArray(d.locks)]]){timeline.append(el('p',label,'v7-lane'));const track=el('div','','v7-track');for(const r of rs){const b=el('button','','v7-segment '+(r.type==='Lock'?'locked':'location'));b.type='button';b.style.left=(100*(r.a-lo)/(hi-lo))+'%';b.style.width=(100*(r.b-r.a)/(hi-lo))+'%';const desc=r.type+' · '+time(r.a)+'–'+time(r.b)+' · '+fmt((r.b-r.a)/1000);b.title=desc;b.setAttribute('aria-label',desc);b.onclick=()=>detail.textContent=desc;track.append(b)}timeline.append(track);if(!available)timeline.append(el('p','Unavailable','v5-muted'))}
timeline.append(detail);for(const r of [...loc,...locks].sort((a,b)=>a.a-b.a)){const tr=el('tr');for(const v of [r.type,time(r.a),time(r.b),fmt((r.b-r.a)/1000),r.host||(r.ongoing?'Ongoing':'—')])tr.append(el('td',v));rows.append(tr)}
if(!rows.children.length){const tr=el('tr'),td=el('td','No available interval records.');td.colSpan=5;tr.append(td);rows.append(tr)}
}
async function load(v){clear();if(main.hidden||api.read().prefs.privacy){profile.textContent='Privacy mode is on.';status.textContent='Privacy mode is on.';return}
const ctrl=new AbortController();request=ctrl;const b=$(v==='profile'?'v7-profile-refresh':'v7-session-refresh');b.disabled=true;const target=v==='profile'?profile:status;target.textContent='Loading…';
try{const response=await fetch(v==='profile'?'/api/intra/profile':'/api/intra/sessions?date='+encodeURIComponent(date.value),{cache:'no-store',signal:ctrl.signal});const d=await response.json();if(!response.ok)throw Error(d.error||'Request failed');if(request!==ctrl||main.hidden||api.read().prefs.privacy)return;if(v==='profile')profileView(d);else sessionView(d)}
catch(e){if(request===ctrl&&!ctrl.signal.aborted)target.textContent=e.message}finally{if(request===ctrl){request=null;b.disabled=false}}}
function route(){const s=api.read(),v=main.dataset.view,active=!main.hidden&&['profile','sessions'].includes(v);const next=active?[v,s.account,s.prefs.privacy].join('|'):'';if(next===key)return;key=next;if(!active){clear();view='';return}if(v==='sessions'){date.max=s.today;if(view!==v||!date.value)date.value=s.reportData?.date||s.today}view=v;load(v)}
$('v7-profile-refresh').onclick=()=>load('profile');$('v7-session-refresh').onclick=()=>load('sessions');date.onchange=()=>date.value&&date.value<=api.read().today&&load('sessions');
new MutationObserver(route).observe(main,{attributes:true,attributeFilter:['data-view','hidden']});new MutationObserver(route).observe(document.documentElement,{attributes:true,attributeFilter:['class']});setInterval(route,1500);route();
})();
