const navigation = [...document.querySelectorAll('.sidebar .nav')];
function activateSection(hash) {
  const selected = navigation.find(link => link.hash === hash) || navigation[0];
  for (const link of navigation) {
    const active = link === selected;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}
for (const link of navigation) {
  link.addEventListener('click', () => activateSection(link.hash));
}
window.addEventListener('hashchange', () => activateSection(window.location.hash));
activateSection(window.location.hash);

const $ = id => document.getElementById(id);
const zone = 'Africa/Casablanca';
const campusDateFormat = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit'});
function campusToday() {
  const parts = Object.fromEntries(campusDateFormat.formatToParts(new Date()).map(({type, value}) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const defaultDaySetting = $('default-day');
try {
  defaultDaySetting.value = localStorage.getItem('logged-default-day') === 'yesterday' ? 'yesterday' : 'today';
} catch { /* Keep the default when storage is unavailable. */ }
defaultDaySetting.addEventListener('change', () => {
  try { localStorage.setItem('logged-default-day', defaultDaySetting.value); } catch { /* Keep the setting for this visit. */ }
});
const startupSetting = $('launch-at-login');
let savedStartupSetting = null;
let checkingStartupSetting = false;

async function syncStartupSetting(enabled) {
  if (checkingStartupSetting) return;
  checkingStartupSetting = true;
  startupSetting.disabled = true;
  const errorMessage = $('startup-error');
  errorMessage.hidden = true;
  try {
    const options = enabled === undefined ? {} : {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({launch_at_login: enabled})
    };
    const response = await fetch('/api/settings', options);
    if (response.status === 404) throw new Error('Restart the local server to manage launch at login.');
    const data = await response.json();
    if (!response.ok || typeof data.launch_at_login !== 'boolean') {
      throw new Error(data.error || 'Unable to read the desktop startup setting.');
    }
    savedStartupSetting = data.launch_at_login;
  } catch (error) {
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
  } finally {
    startupSetting.checked = savedStartupSetting === true;
    startupSetting.disabled = savedStartupSetting === null;
    checkingStartupSetting = false;
  }
}

$('open-settings').addEventListener('click', () => {
  $('settings').showModal();
  syncStartupSetting();
});
startupSetting.addEventListener('change', () => syncStartupSetting(startupSetting.checked));

let today = campusToday();
let selectedDay = defaultDaySetting.value === 'yesterday' ? previousDay() : today;
let loading = false;
let dashboardRequest = 0;
const dayReports = new Map();
// At 35 minutes past a full hour, attendance rounds up to the next hour.
const attendanceRoundingOffsetSeconds = (60 - 35) * 60;
const duration = value => value == null ? '—' : `${Math.floor(value / 3600)}h ${String(Math.floor(value % 3600 / 60)).padStart(2,'0')}m`;
const clock = value => new Intl.DateTimeFormat('en-GB', {timeZone:zone,hour:'2-digit',minute:'2-digit'}).format(new Date(value));
function updateGoal(report) {
  const target = report?.attendance_goal?.daily_seconds;
  const logged = report?.logged_seconds;
  $('goal-label').textContent = target == null ? 'Unavailable' : `${target / 3600}h`;
  let message = target == null ? 'Attendo recommendation unavailable' : 'Waiting for your attendance';
  let percent = null;
  if (target != null && logged != null) {
    const requiredSeconds = Math.max(0, target - attendanceRoundingOffsetSeconds);
    const minutesLeft = Math.ceil(Math.max(0, requiredSeconds - logged) / 60);
    percent = minutesLeft === 0 ? 100 : Math.floor(100 * logged / requiredSeconds);
    message = minutesLeft === 0 ? 'Daily target reached' : `${duration(minutesLeft * 60)} to your goal`;
  }
  $('progress').style.width = `${percent ?? 0}%`;
  $('percent').textContent = percent == null ? '—' : `${percent}%`;
  $('remaining').textContent = message;
}
function updateDayView() {
  $('today').setAttribute('aria-pressed', String(selectedDay === today));
  $('yesterday').setAttribute('aria-pressed', String(selectedDay === previousDay()));
  const historical = selectedDay !== today && selectedDay !== previousDay();
  $('goal-panel').hidden = selectedDay !== today;
  $('logged-card').hidden = historical;
  $('recorded-card').hidden = historical;
  $('intra-card').hidden = historical;
  $('daily-cards').classList.toggle('historical', historical);
  $('historical-card').hidden = !historical;
}
async function fetchDashboard(day, force = false) {
  const response = await fetch(`/api/dashboard?date=${encodeURIComponent(day)}${force ? '&refresh=1' : ''}`, {cache: 'no-store'});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to load attendance.');
  return data;
}

function showDashboard() {
  const returnFocus = $('session-screen').contains(document.activeElement);
  $('session-screen').hidden = true;
  $('sidebar').hidden = false;
  $('overview').hidden = false;
  if (returnFocus) $('open-settings').focus();
}

async function fetchSessions() {
  const response = await fetch('/api/session', {cache: 'no-store'});
  if (response.status === 404) throw new Error('Restart the local server to check both sessions.');
  const sessions = await response.json();
  if (!['attendo', 'intra'].every(key => [true, false, null].includes(sessions[key]))) {
    throw new Error('Unable to check both sessions. Restart the local server and try again.');
  }
  return sessions;
}

function showSessionScreen() {
  dayReports.clear();
  $('day-report').hidden = true;
  $('signed-in-account').hidden = true;
  const opening = $('session-screen').hidden;
  if ($('settings').open) $('settings').close();
  $('sidebar').hidden = true;
  $('overview').hidden = true;
  $('session-screen').hidden = false;
  if (opening) $('session-title').focus();
}

function renderSessions(sessions) {
  const missing = [];
  for (const service of ['intra', 'attendo']) {
    const active = sessions[service];
    const name = $(`${service}-name`).textContent;
    if (active === false) missing.push(name);
    const state = active === true ? 'signed-in' : active === false ? 'signed-out' : 'unknown';
    const status = $(`${service}-state`);
    if (status.dataset.state === state) continue;
    status.dataset.state = state;
    status.textContent = active === true ? 'Signed in' : active === false ? 'Sign-in required' : 'Unable to verify';
    const link = $(`${service}-login`);
    link.firstElementChild.textContent = active === false ? 'Sign in' : 'Open site';
    link.setAttribute('aria-label', `${active === false ? 'Sign in to' : 'Open'} ${name} in a new tab`);
  }
  const guidance = $('session-guidance');
  guidance.hidden = !missing.length;
  if (missing.length) {
    const account = missing.length === 1 ? missing[0] : 'both services';
    guidance.textContent = `Sign in to ${account} in Firefox, Chrome, or Brave, then return here.`;
  }
  const message = (sessions.errors || []).join(' ');
  if ($('session-status').textContent !== message) $('session-status').textContent = message;
}

function renderDashboard(data) {
  renderAttendance(data);
  const r = data.report, locks = data.locks;
  $('signed-in-account').hidden = !r?.username;
  const workstation = r?.current_workstation ? ` · Workstation ${r.current_workstation}` : '';
  $('signed-in-account').textContent = r?.username ? `Signed in as ${r.username}${workstation}` : '';
  $('logged').replaceChildren();
  if (r?.logged_seconds != null) {
    const seconds = r.logged_seconds;
    $('logged').append(document.createTextNode(Math.floor(seconds/3600)));
    const h=document.createElement('span');h.textContent='h';$('logged').append(h,document.createTextNode(String(Math.floor(seconds%3600/60)).padStart(2,'0')));
    const m=document.createElement('span');m.textContent='m';$('logged').append(m);
  } else $('logged').textContent = '—';
  $('historical-total').textContent = r?.time_kind === 'recorded' ? duration(r.attendo_seconds) : '—';
  const recorded = r?.attendo_recorded_seconds;
  const expectedHours = recorded == null && selectedDay === previousDay() && r?.logged_seconds != null
    ? Math.floor((r.logged_seconds + attendanceRoundingOffsetSeconds) / 3600) : null;
  $('recorded').textContent = recorded == null ? '—' : `${Math.floor(recorded / 3600)}h`;
  $('recorded-expected').hidden = expectedHours == null;
  $('recorded-expected').textContent = expectedHours == null ? '' : `(expected: ${expectedHours}h)`;
  const latestRecorded = (r?.attendance_periods || []).flatMap(period => period.days)
    .filter(day => day.date < selectedDay).sort((a, b) => b.date.localeCompare(a.date))[0];
  $('recorded-description').hidden = expectedHours != null;
  $('recorded-description').textContent = recorded != null ? 'Recorded campus attendance for this day'
    : !r ? 'Connect to Attendo and refresh'
    : latestRecorded ? `Not yet recorded · latest ${duration(latestRecorded.hours * 3600)} (${latestRecorded.date})`
    : 'Attendo has not returned a saved total for this day';
  $('intra-total').textContent = duration(r?.attendo_source === '42_intra_locations' ? r.attendo_seconds : null);
  $('locked').textContent = duration(locks?.locked_seconds ?? r?.locked_seconds);
  $('kind').textContent = r?.time_kind === 'recorded' ? 'Recorded' : 'Estimated';
  const periods = locks?.periods || [];
  $('count').textContent = `${periods.length} period${periods.length===1?'':'s'}`;
  renderLockRows($('periods'), locks);
  $('warnings').replaceChildren();
  for (const message of new Set([...(r?.warnings || []), ...(locks?.warnings || []), ...(data.errors || [])])) { const li=document.createElement('li');li.textContent=message;$('warnings').append(li); }
  $('status').className = data.errors.length ? 'error' : '';
  if (r) {
    const attendanceStatus = r.time_kind === 'recorded' ? (r.attendo_seconds == null ? 'Recorded total unavailable for this day' : 'Recorded daily attendance')
      : r.attendo_seconds == null ? '42 Intra location data unavailable for this day'
      : 'Estimated attendance, adjusted for observed locks';
    const details = data.errors.length || r.attendo_seconds == null ? ' · See “About these numbers” for details.' : '';
    $('status').textContent = `${attendanceStatus}${details}`;
  } else {
    $('status').textContent = data.errors[0]?.replace(/^Error: /, '') || 'Attendance is unavailable.';
  }
  updateGoal(r);
}

async function load(force = false, sessions = null) {
  const request = ++dashboardRequest;
  syncCampusDay();
  updateDayView();
  const day = selectedDay;
  if (!dayReports.has(day)) dayReports.set(day, {});
  const entry = dayReports.get(day);
  $('day-report').hidden = !entry.data;
  const checkSignIn = force || $('overview').hidden;
  loading = true;
  $('refresh').disabled = true;
  $('refresh').textContent = 'Refreshing…';
  $('retry-session').disabled = true;
  $('retry-session').textContent = 'Checking…';
  try {
    if (checkSignIn) {
      sessions = sessions ?? await fetchSessions();
      if (request !== dashboardRequest) return;
      renderSessions(sessions);
      if (!sessions.active) {
        showSessionScreen();
        return;
      }
      showDashboard();
    }

    if (entry.data) renderDashboard(entry.data);
    $('status').className = '';
    $('status').textContent = day === today ? 'Loading today’s attendance…' : 'Loading yesterday’s attendance…';
    // Reuse a date's pending request when switching away and back.
    if (!entry.pending) {
      entry.pending = fetchDashboard(day, force).finally(() => { entry.pending = null; });
    }
    const data = await entry.pending;
    entry.data = data;
    if (request !== dashboardRequest) return;
    renderDashboard(data);
    $('day-report').hidden = false;
  } catch (error) {
    if (request !== dashboardRequest) return;
    if (checkSignIn && !sessions?.active) {
      renderSessions({errors: [error.message]});
      showSessionScreen();
    } else {
      $('status').className = 'error';
      $('status').textContent = $('day-report').hidden ? error.message : `${error.message} Previous values may be stale.`;
    }
  } finally {
    if (request === dashboardRequest) {
      loading = false;
      $('refresh').disabled = false;
      $('refresh').textContent = 'Refresh data';
      $('retry-session').disabled = false;
      $('retry-session').textContent = 'Refresh status';
    }
  }
}
function previousDay() {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function syncCampusDay() {
  const currentDay = campusToday();
  if (currentDay === today) return false;
  const viewingToday = selectedDay === today;
  dayReports.clear();
  today = currentDay;
  selectedDay = viewingToday ? today : previousDay();
  return true;
}

function selectDay(viewToday) {
  const rolledOver = syncCampusDay();
  const day = viewToday ? today : previousDay();
  if (!rolledOver && day === selectedDay) return;
  selectedDay = day;
  load();
}
$('retry-session').addEventListener('click', () => load(true));
$('refresh').addEventListener('click', () => load(true));
$('today').addEventListener('click', () => selectDay(true));
$('yesterday').addEventListener('click', () => selectDay(false));
function renderLockRows(body, locks) {
  const periods = locks?.periods || [];
  body.replaceChildren();
  for (const period of [...periods].reverse()) {
    const row = document.createElement('tr');
    for (const value of [clock(period.start), period.ongoing ? '—' : clock(period.end), duration(period.seconds)]) {
      const cell=document.createElement('td');cell.textContent=value;row.append(cell);
    }
    const cell=document.createElement('td'), tag=document.createElement('span');tag.className='tag';tag.textContent=period.ongoing?'Ongoing':'Completed';cell.append(tag);row.append(cell);body.append(row);
  }
  if (!periods.length) { const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=4;cell.className='empty';cell.textContent=locks?'No lock periods recorded for this day.':'Lock history is unavailable.';row.append(cell);body.append(row); }
}

function renderCurrentPeriod(period, target) {
  $('current-period-progress').hidden = !period;
  if (!period) return;

  const seconds = period.total * 3600;
  const hasTarget = target > 0;
  const reached = hasTarget && seconds >= target;
  const progress = hasTarget ? Math.min(1, Math.max(0, seconds / target)) : 0;
  const compactDuration = value => duration(value).replace(/ 00m$/, '');
  const dateFormat = new Intl.DateTimeFormat('en-US', {month:'short', day:'numeric', timeZone:'UTC'});
  $('period-gauge').style.setProperty('--period-sweep', `${progress * 270}deg`);
  $('period-progress-total').textContent = compactDuration(seconds);
  $('period-progress-target').textContent = hasTarget ? `of ${compactDuration(target)}` : 'Recorded';
  $('period-progress-count').textContent = `${period.days.filter(day => day.counted).length} / 7 days counted`;
  $('period-progress-status').textContent = reached ? 'Target reached' : hasTarget ? 'In progress' : 'Target unavailable';
  $('period-progress-status').classList.toggle('target-reached', reached);
  $('period-progress-dates').textContent = dateFormat.formatRange(new Date(period.start), new Date(period.end));
}

function renderAttendance(data) {
  const periods = data.report?.attendance_periods || [];
  const target = data.report?.attendance_goal?.target_seconds;
  renderCurrentPeriod(periods.find(period => period.label === 'Current period'), target);
  const list = $('attendance-periods');
  const expanded = new Set([...list.querySelectorAll('.attendance-period[open]')].map(item => item.dataset.period));
  const expandedDays = new Set([...list.querySelectorAll('.attendance-day[open]')].map(item => item.dataset.day));
  list.replaceChildren();
  if (!periods.length) {
    list.textContent = 'Attendance periods are unavailable. Connect to Attendo and refresh.';
    return;
  }
  const dateFormat = new Intl.DateTimeFormat('en-US', {month:'short', day:'numeric', year:'numeric', timeZone:'UTC'});
  for (const period of periods) {
    const details = document.createElement('details');
    details.className = 'attendance-period';
    details.dataset.period = period.start;
    details.open = expanded.has(period.start);

    const summary = document.createElement('summary');
    const description = document.createElement('span');
    const dates = document.createElement('strong');
    dates.textContent = dateFormat.formatRange(new Date(period.start), new Date(period.end));
    const counted = document.createElement('small');
    counted.textContent = `${period.label} · ${period.days.filter(day => day.counted).length}/7 days counted`;
    description.append(dates, counted);

    const totals = document.createElement('span');
    totals.className = 'period-totals';
    const total = document.createElement('strong');
    total.textContent = duration(period.total * 3600);
    totals.append(total);
    if (target != null) {
      const status = document.createElement('small');
      status.textContent = period.total * 3600 >= target ? 'Target reached' : `of ${duration(target)} target`;
      totals.append(status);
    }
    summary.append(description, totals);

    details.append(summary, renderAttendanceDays(period, expandedDays, data));
    list.append(details);
  }
}

function renderAttendanceDays(period, expandedDays, data) {
  const container = document.createElement('div');
  container.className = 'attendance-days';
  const dateFormat = new Intl.DateTimeFormat('en-US', {day:'numeric', month:'short', timeZone:'UTC'});
  const days = [...period.days].sort((a, b) => b.date.localeCompare(a.date));
  for (const day of days) {
    const details = document.createElement('details');
    details.className = 'attendance-day';
    details.dataset.day = `${period.start}/${day.date}`;
    details.open = expandedDays.has(details.dataset.day);

    const summary = document.createElement('summary');
    if (day.date === selectedDay) summary.setAttribute('aria-current', 'date');
    const name = document.createElement('span');
    name.textContent = dateFormat.format(new Date(day.date));
    const amount = document.createElement('strong');
    amount.textContent = duration(day.hours * 3600).replace(/ 00m$/, '');
    const status = document.createElement('span');
    status.className = 'day-count-status';
    status.classList.toggle('counted', day.counted);
    status.textContent = day.counted ? 'Counted' : 'Not counted';
    summary.append(name, amount, status);

    const content = document.createElement('div');
    content.className = 'attendance-day-content';
    const report = document.createElement('div');
    report.className = 'inline-day-report';
    report.setAttribute('aria-live', 'polite');
    let requested = false;
    const loadDetails = async () => {
      if (!details.open || requested) return;
      if (day.date > today) {
        report.textContent = 'Daily details will be available on this date.';
        return;
      }
      requested = true;
      report.textContent = 'Loading daily details…';
      try {
        renderInlineDay(report, day.date === data.date ? data : await fetchDashboard(day.date));
      } catch (error) {
        report.textContent = error.message;
        requested = false;
      }
    };
    details.addEventListener('toggle', loadDetails);
    if (details.open) loadDetails();
    content.append(report);
    details.append(summary, content);
    container.append(details);
  }
  return container;
}

function renderInlineDay(container, {report, locks, errors}) {
  const totals = document.createElement('dl');
  totals.className = 'inline-day-totals';
  for (const [label, seconds] of [
    ['Net attendance', report?.logged_seconds],
    ['Attendo recorded', report?.attendo_recorded_seconds],
    ['Locked time', locks?.locked_seconds ?? report?.locked_seconds]
  ]) {
    const metric = document.createElement('div');
    const name = document.createElement('dt');
    name.textContent = label;
    const value = document.createElement('dd');
    value.textContent = duration(seconds);
    metric.append(name, value);
    totals.append(metric);
  }
  const history = document.createElement('div');
  history.className = 'table-wrap';
  history.tabIndex = 0;
  history.setAttribute('role', 'region');
  history.setAttribute('aria-label', 'Daily lock periods');
  history.innerHTML = '<table><caption>Lock history</caption><thead><tr><th scope="col">Locked at</th><th scope="col">Unlocked at</th><th scope="col">Duration</th><th scope="col">Status</th></tr></thead><tbody></tbody></table>';
  renderLockRows(history.querySelector('tbody'), locks);
  container.replaceChildren(totals, history);
  if (errors.length) {
    const message = document.createElement('p');
    message.textContent = errors.join(' ');
    container.append(message);
  }
}

let checkingSession = false;
async function checkSession() {
  if (checkingSession || loading || document.hidden) return;
  if (syncCampusDay() && !$('overview').hidden) {
    await load(true);
    return;
  }
  checkingSession = true;
  const request = dashboardRequest;
  try {
    const sessions = await fetchSessions();
    if (request !== dashboardRequest) return;
    renderSessions(sessions);
    if (sessions.active === false || (sessions.active === null && $('overview').hidden)) {
      showSessionScreen();
    } else if (sessions.active && $('overview').hidden) {
      await load(true, sessions);
    }
  } catch (error) {
    if (request === dashboardRequest && !$('session-screen').hidden) renderSessions({errors: [error.message]});
  } finally {
    checkingSession = false;
  }
}

window.addEventListener('focus', checkSession);
window.addEventListener('pageshow', checkSession);
document.addEventListener('visibilitychange', checkSession);
setInterval(checkSession, 3000);
updateGoal();load(true);
