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
function clear(){catalogRequest?.abort();catalogRequest=null;window.xattendoUI?.campusBusy('profile',false);window.xattendoUI?.campusBusy('sessions',false);request?.abort();request=null;for(const n of [profile,projects,timeline,rows,status])n.replaceChildren();for(const id of ['v7-profile-refresh','v7-session-refresh'])$(id).disabled=false}
let chosenCourse=null,catalogRequest=null;
function profileView(d){
profile.replaceChildren();projects.replaceChildren();
if(!d.login){profile.append(el('p',d.message||'Profile unavailable'));return}
const p=d.profile,courses=(p?.cursus||[]).filter(c=>Number.isInteger(c.id));
const ident=el('div','','v7-identity'),avatar=el('div',d.login.slice(0,2).toUpperCase(),'v7-avatar'),info=el('div');
info.append(el('h2',p?.name||d.login),el('p','@'+d.login+' · '+(p?.campuses?.join(', ')||'42 Intra'),'v5-muted'));
const link=el('a','Open Intra ↗','button');link.href='https://profile.intra.42.fr/users/'+encodeURIComponent(d.login);link.target='_blank';link.rel='noopener noreferrer';ident.append(avatar,info,link);profile.append(ident);
if(d.message)profile.append(el('p',d.message,'v5-muted'));
const controls=el('div','','v74-tabs');const body=el('div');profile.append(controls,body);
const python=el('section','','v74-python');
function isPython(x){return /python/i.test(x.name||'')||/python/i.test(x.slug||'')}
function group(title,list,empty){
const section=el('section','','v72-project-section'),heading=el('div','','v72-project-heading');heading.append(el('h3',title),el('span',String(list.length),'v72-project-count'));section.append(heading);
if(!list.length)section.append(el('p',empty,'v5-muted'));
for(const item of list){const row=el('div','','v72-project-row'),left=el('div','','v72-project-name'),right=el('div','','v72-project-meta');
left.append(el('strong',item.name));
const registered=Object.prototype.hasOwnProperty.call(item,'status');
const label=registered?(item.validated===true?'Validated':item.status?item.status.replace(/_/g,' '):'Registered'):item.availability==='open'?'Open for registration':item.availability==='closed'?'Not open':'Availability unknown';
right.append(el('span',label,'v72-project-status '+(registered?(item.validated===true?'validated':'active'):item.availability==='open'?'active':'')));
if(registered)right.append(el('span',finite(item.mark)?String(item.mark)+'/100':'Not graded','v72-project-mark'));
row.append(left,right);section.append(row)}
return section;
}
function renderPython(registered,catalog,known){
python.replaceChildren();python.append(el('h3','Python Piscine'));
const r=registered.filter(isPython),c=catalog.filter(isPython),open=c.filter(x=>x.availability==='open'),closed=c.filter(x=>x.availability==='closed'),unknown=c.filter(x=>x.availability==='unknown');
if(r.length)python.append(group('Registered Python projects',r,''));
if(open.length)python.append(group('Open Python projects',open,''));
if(closed.length)python.append(group('Not open',closed,''));
if(unknown.length)python.append(group('Availability unknown',unknown,''));
if(!r.length&&!open.length&&!closed.length&&!unknown.length)python.append(el('p',known?'No Python Piscine projects found in this cursus catalog. Opening status not confirmed.':'Python Piscine opening status is unavailable.','v5-muted'));
}
async function show(c){
catalogRequest?.abort();catalogRequest=null;chosenCourse=c?.id??null;
for(const b of controls.children)b.setAttribute('aria-pressed',String(b.dataset.id===String(chosenCourse)));
body.replaceChildren();projects.replaceChildren();
const registered=(p?.projects||[]).filter(x=>c?x.cursus_ids?.includes(c.id):!x.cursus_ids?.length);
const metrics=el('div','','v6-metrics');metrics.append(metric('Level',finite(c?.level)?c.level.toFixed(2):'—'),metric('Wallet',finite(p?.wallet)?String(p.wallet):'—'),metric('Correction points',finite(p?.correction_points)?String(p.correction_points):'—'),metric('Registrations',p?.projects_available?String(registered.length):'—'));body.append(metrics);
if(d.project_message)projects.append(el('p',d.project_message,'v5-muted'));
if(!p?.projects_available)projects.append(el('p','Registration records unavailable.','v5-muted'));
const active=registered.filter(x=>x.validated!==true&&x.status!=='finished');
projects.append(group('Registered · current',active,'No current registrations.'),group('Validated',registered.filter(x=>x.validated===true),'No validated projects.'),group('Other completed attempts',registered.filter(x=>x.status==='finished'&&x.validated!==true),'No other completed attempts.'));
const catalogBox=el('div');projects.append(catalogBox,python);renderPython(registered,[],false);
if(!c){catalogBox.append(el('p','Cursus information unavailable for these records.','v5-muted'));return}
const ctrl=new AbortController();catalogRequest=ctrl;
catalogBox.append(el('p','Loading available projects…','v5-muted'));for(let i=0;i<3;i++){const sk=el('div','','skeleton');sk.style.margin='12px 0';catalogBox.append(sk)}
try{
const res=await fetch('/api/intra/catalog?cursus='+encodeURIComponent(c.id),{cache:'no-store',signal:ctrl.signal});const result=await res.json();
if(!res.ok)throw Error(result.error||'Catalog unavailable');
if(ctrl.signal.aborted||catalogRequest!==ctrl||main.hidden||main.dataset.view!=='profile'||api.read().prefs.privacy||result.login!==d.login)return;
const ids=new Set(registered.map(x=>x.project_id).filter(Number.isInteger)),slugs=new Set(registered.map(x=>x.slug).filter(Boolean));
const unregistered=(result.projects||[]).filter(x=>!ids.has(x.id)&&!slugs.has(x.slug));
catalogBox.replaceChildren();catalogBox.append(group('Not registered · open',unregistered.filter(x=>x.availability==='open'&&!isPython(x)),'No confirmed open unregistered projects.'));
const closed=unregistered.filter(x=>x.availability==='closed'&&!isPython(x)),unknown=unregistered.filter(x=>x.availability==='unknown'&&!isPython(x));
const details=el('details','','v74-details');details.append(el('summary','Closed / unknown projects ('+(closed.length+unknown.length)+')'),group('Not open',closed,'None confirmed closed.'),group('Availability unknown',unknown,'None.'));catalogBox.append(details,el('p',result.note+(result.complete?'':' Catalog may be incomplete.'),'v5-muted'));
renderPython(registered,unregistered,true);
}catch(e){if(!ctrl.signal.aborted&&catalogRequest===ctrl){catalogBox.replaceChildren(el('p','Unable to load project catalog: '+e.message,'v5-muted'));}}
}
for(const c of courses){const button=el('button',(c.grade?c.grade+' at ':'')+(c.name||'Cursus'),'button');button.type='button';button.dataset.id=String(c.id);button.onclick=()=>show(c);controls.append(button)}
if((p?.projects||[]).some(x=>!x.cursus_ids?.length)){const button=el('button','Unassigned projects','button');button.dataset.id='null';button.onclick=()=>show(null);controls.append(button)}
show(courses.find(c=>c.id===chosenCourse)||courses.find(c=>/42cursus/i.test(c.name||''))||courses.find(c=>!c.end_at)||courses[0]||null);
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
const ctrl=new AbortController();request=ctrl;const b=$(v==='profile'?'v7-profile-refresh':'v7-session-refresh');b.disabled=true;const target=v==='profile'?profile:status;target.textContent='Loading…';window.xattendoUI?.campusBusy(v,true);
try{const response=await fetch(v==='profile'?'/api/intra/profile':'/api/intra/sessions?date='+encodeURIComponent(date.value),{cache:'no-store',signal:ctrl.signal});const d=await response.json();if(!response.ok)throw Error(d.error||'Request failed');if(request!==ctrl||main.hidden||api.read().prefs.privacy)return;if(v==='profile')profileView(d);else sessionView(d)}
catch(e){if(request===ctrl&&!ctrl.signal.aborted)target.textContent=e.message}finally{if(request===ctrl){request=null;b.disabled=false;window.xattendoUI?.campusBusy(v,false)}}}
function route(){const s=api.read(),v=main.dataset.view,active=!main.hidden&&['profile','sessions'].includes(v);const next=active?[v,s.account,s.prefs.privacy].join('|'):'';if(next===key)return;key=next;if(!active){clear();view='';return}if(v==='sessions'){date.max=s.today;if(view!==v||!date.value)date.value=s.reportData?.date||s.today}view=v;load(v)}
$('v7-profile-refresh').onclick=()=>load('profile');$('v7-session-refresh').onclick=()=>load('sessions');date.onchange=()=>date.value&&date.value<=api.read().today&&load('sessions');
new MutationObserver(route).observe(main,{attributes:true,attributeFilter:['data-view','hidden']});new MutationObserver(route).observe(document.documentElement,{attributes:true,attributeFilter:['class']});setInterval(route,1500);route();
})();
