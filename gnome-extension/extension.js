const {Gio,GLib,St,Clutter}=imports.gi;
const Main=imports.ui.main, PanelMenu=imports.ui.panelMenu, PopupMenu=imports.ui.popupMenu;
const Me=imports.misc.extensionUtils.getCurrentExtension();
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const fmt=n=>valid(n)?Math.floor(n/3600)+'h '+String(Math.floor(n%3600/60)).padStart(2,'0')+'m':'—';
class Xattendo {
 enable(){
  this.active=true;
  this.button=new PanelMenu.Button(0.0,'Xattendo');
  const panel=new St.BoxLayout({style_class:'panel-status-menu-box'});
  panel.add_child(new St.Icon({icon_name:'preferences-system-time-symbolic',style_class:'system-status-icon'}));
  this.label=new St.Label({text:'—',y_align:Clutter.ActorAlign.CENTER});panel.add_child(this.label);this.button.add_child(panel);
  Main.panel.addToStatusArea(Me.metadata.uuid,this.button);
  const item=new PopupMenu.PopupBaseMenuItem({reactive:false,can_focus:false}),card=new St.BoxLayout({vertical:true,style_class:'xattendo-card'});
  item.add_child(card);this.button.menu.addMenuItem(item);
  const label=(text,style_class)=>{const l=new St.Label({text,style_class});card.add_child(l);return l};
  label('Xattendo','xattendo-title');this.status=label('Connecting…','xattendo-muted');label('Today · net attendance','xattendo-muted');this.value=label('—','xattendo-value');
  const track=new St.BoxLayout({style_class:'xattendo-track',width:230});this.fill=new St.Widget({style_class:'xattendo-fill',width:0,height:8});track.add_child(this.fill);card.add_child(track);
  this.goal=label('Daily target —','xattendo-muted');this.metrics=label('Recorded —   Locked —','xattendo-metrics');this.period=label('Current period —','xattendo-metrics');
  this.detail=new PopupMenu.PopupSubMenuMenuItem('Observed screen locks');this.button.menu.addMenuItem(this.detail);
  this.button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
  this.action=this.button.menu.addAction('Refresh attendance',()=>this.refresh());
  for(const [name,view] of [['Open dashboard','overview'],['42 Intra profile','profile'],['Session timeline','sessions'],['Settings','settings']])this.button.menu.addAction(name,()=>this.open(view));
  try{this.project=JSON.parse(imports.byteArray.toString(GLib.file_get_contents(Me.path+'/config.json')[1])).project;this.refresh();this.timer=GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,90,()=>{this.refresh();return GLib.SOURCE_CONTINUE});}catch(_){this.status.text='Run make gnome to configure Xattendo.'}
  this.button.menu.connect('open-state-changed',(_,open)=>{if(open&&(!this.lastRefresh||Date.now()-this.lastRefresh>60000))this.refresh()});
 }
 open(view){if(!this.project)return;try{Gio.Subprocess.new(['/usr/bin/python3',this.project+'/gnome_snapshot.py','--open',view],Gio.SubprocessFlags.STDOUT_SILENCE|Gio.SubprocessFlags.STDERR_SILENCE)}catch(_){this.status.text='Could not open dashboard.'}}
 refresh(){
  if(!this.active||!this.project||this.process)return;this.status.text='Refreshing…';this.action.setSensitive(false);
  let proc;try{proc=Gio.Subprocess.new(['/usr/bin/python3',this.project+'/gnome_snapshot.py'],Gio.SubprocessFlags.STDOUT_PIPE|Gio.SubprocessFlags.STDERR_PIPE)}catch(_){this.failed();return}
  this.process=proc;this.timeout=GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,95,()=>{this.timeout=0;try{proc.force_exit()}catch(_){}return GLib.SOURCE_REMOVE});
  proc.communicate_utf8_async(null,null,(source,result)=>{
   if(this.timeout){GLib.source_remove(this.timeout);this.timeout=0}this.process=null;
   try{const [,stdout]=source.communicate_utf8_finish(result);if(!this.active)return;if(!source.get_successful())throw Error();this.render(JSON.parse(stdout.trim().split('\n').pop()));this.lastRefresh=Date.now()}catch(_){if(this.active)this.failed()}finally{if(this.active)this.action.setSensitive(true)}
  });
 }
 failed(){this.label.text=this.value.text='—';this.fill.width=0;this.goal.text='Daily target —';this.metrics.text='Recorded —   Locked —';this.period.text='Current period —';this.detail.menu.removeAll();this.status.text='Unavailable · open dashboard to sign in or retry.';this.action.setSensitive(true)}
 render(data){
  const r=data.report;if(!r){this.failed();return}const net=r.logged_seconds,target=r.attendance_goal?.daily_seconds,locked=data.locks?.locked_seconds??r.locked_seconds;
  this.label.text=this.value.text=fmt(net);this.status.text=(r.time_kind==='recorded'?'Recorded':'Estimated')+' · '+(r.date||'Today');
  this.fill.width=Math.round(230*(valid(net)&&valid(target)&&target>0?Math.min(1,net/target):0));
  this.goal.text=valid(net)&&valid(target)?'Goal '+fmt(target)+' · '+fmt(Math.max(0,target-net))+' left':'Daily target unavailable';
  this.metrics.text='Recorded '+fmt(r.attendo_recorded_seconds)+'   Locked '+fmt(locked);
  const p=(r.attendance_periods||[]).find(x=>x.label==='Current period');this.period.text='Current period '+(p&&valid(p.total)?fmt(p.total*3600):'—');
  this.detail.menu.removeAll();const locks=data.locks?.periods||[];
  if(!locks.length)this.detail.menu.addMenuItem(new PopupMenu.PopupMenuItem('No available lock records',{reactive:false}));
  for(const l of locks.slice(-12).reverse())this.detail.menu.addMenuItem(new PopupMenu.PopupMenuItem(String(l.start||'').slice(11,16)+' – '+(l.ongoing?'ongoing':String(l.end||'').slice(11,16))+' · '+fmt(l.seconds),{reactive:false}));
 }
 disable(){this.active=false;if(this.timer)GLib.source_remove(this.timer);if(this.timeout){GLib.source_remove(this.timeout);this.timeout=0}if(this.process){try{this.process.force_exit()}catch(_){}}this.button?.destroy()}
}
function init(){let instance;return {enable(){instance=new Xattendo();instance.enable()},disable(){instance?.disable();instance=null}}}
