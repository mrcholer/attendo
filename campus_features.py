"""Read-only optional official 42 API access; no credentials reach the browser."""
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import stat
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler
from zoneinfo import ZoneInfo
import attendo_client
import intra_credentials

ZONE = ZoneInfo('Africa/Casablanca')

class APIError(ValueError):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise APIError('42 API redirect refused.')

def token():
    try:
        managed = intra_credentials.managed_token()
        if managed:
            return managed
    except intra_credentials.CredentialError as error:
        raise APIError(str(error)) from None
    value = os.environ.get('INTRA_API_TOKEN', '').strip()
    if not value:
        path = Path(os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config') / 'xattendo/intra-token'
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            return None
        except OSError:
            raise APIError('Unable to open the local 42 API token file.') from None
        with os.fdopen(fd, 'r', encoding='utf-8') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise APIError('The local API token file must have mode 600 and be owned by you.')
            try:
                value = stream.read(8193).strip()
            except (OSError, UnicodeError):
                raise APIError('Invalid API token file.') from None
    if not value or len(value) > 8192 or not value.isascii() or any(c.isspace() for c in value):
        raise APIError('Invalid API token.')
    return value

def api_get(path, access, params=None):
    url = 'https://api.intra.42.fr/v2/' + path + ('?' + urlencode(params) if params else '')
    req = Request(url, headers={'Authorization': 'Bearer ' + access, 'Accept': 'application/json',
                                'User-Agent': 'Xattendo/7'})
    try:
        with build_opener(NoRedirect()).open(req, timeout=10) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise APIError('42 API response too large.')
        return json.loads(raw)
    except HTTPError as error:
        raise APIError({401: 'Renew your expired or invalid 42 API token.',
                        403: '42 API access denied.', 429: '42 API rate limited.'}
                       .get(error.code, f'42 API returned HTTP {error.code}.')) from None
    except (URLError, OSError, UnicodeError, json.JSONDecodeError):
        raise APIError('42 API unavailable or returned invalid data.') from None

def current_login():
    try:
        profile = attendo_client.session_profile()
    except (attendo_client.AttendoError, OSError, ValueError):
        return None
    return (os.environ.get('INTRA_LOGIN') or profile.login) if profile else None

def string(value):
    return value[:160] if isinstance(value, str) else None

def number(value):
    return value if type(value) in (int, float) and math.isfinite(value) else None

def objects(value):
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []

def sanitize_projects(rows):
    result = []
    for row in objects(rows):
        project = row.get('project')
        if not isinstance(project, dict) or not isinstance(project.get('name'), str):
            continue
        validation = row.get('validated?')
        result.append({'id': number(row.get('id')), 'name': string(project['name']),
                       'slug': string(project.get('slug')), 'status': string(row.get('status')),
                       'mark': number(row.get('final_mark')),
                       'validated': validation if type(validation) is bool else None,
                       'cursus_ids': [n for n in row.get('cursus_ids', []) if type(n) is int]
                       if isinstance(row.get('cursus_ids'), list) else []})
    return result

def fetch_projects(login, access):
    path = 'users/' + quote(login, safe='') + '/projects_users'
    rows, seen = [], set()
    for page in range(1, 21):
        batch = api_get(path, access, {'page[size]': 100, 'page[number]': page})
        if not isinstance(batch, list) or any(not isinstance(row, dict) for row in batch):
            raise APIError('Unexpected 42 project registrations response.')
        new = 0
        for row in batch:
            ident = row.get('id')
            if type(ident) is int:
                if ident in seen:
                    continue
                seen.add(ident)
            rows.append(row)
            new += 1
        if len(batch) < 100:
            return sanitize_projects(rows), True
        if not new:
            break
    return sanitize_projects(rows), False

def sanitize_profile(raw, login):
    if not isinstance(raw, dict) or raw.get('login') != login:
        raise APIError('42 API profile does not match campus account.')
    courses = [{'name': string(c['cursus'].get('name')), 'level': number(c.get('level')),
                'end_at': string(c.get('end_at'))}
               for c in objects(raw.get('cursus_users')) if isinstance(c.get('cursus'), dict)]
    projects = sanitize_projects(raw.get('projects_users'))
    return {'login': login, 'name': string(raw.get('displayname')) or login,
            'wallet': number(raw.get('wallet')), 'correction_points': number(raw.get('correction_point')),
            'campuses': [c['name'][:160] for c in objects(raw.get('campus')) if isinstance(c.get('name'), str)],
            'cursus': courses, 'projects': projects,
            'projects_available': isinstance(raw.get('projects_users'), list)}

def profile_data():
    login = current_login()
    data = {'login': login, 'profile': None, 'message': None}
    if not login:
        data['message'] = 'Sign in to your campus account first.'
        return data
    try:
        access = token()
        if access:
            data['profile'] = sanitize_profile(api_get('users/' + quote(login, safe=''), access), login)
            try:
                projects, complete = fetch_projects(login, access)
                data['profile']['projects'] = projects
                data['profile']['projects_available'] = True
                if not complete:
                    data['project_message'] = 'Project pagination limit reached; some records may be missing.'
            except APIError as error:
                data['project_message'] = 'Could not refresh project registrations: ' + str(error) + ' Showing embedded profile projects if available.'
        else:
            data['message'] = 'Connect your 42 API application in Settings to load academic details.'
    except APIError as error:
        data['message'] = str(error)
    return data

def day_bounds(day):
    return (datetime.combine(day, datetime.min.time(), ZONE),
            datetime.combine(day + timedelta(days=1), datetime.min.time(), ZONE))

def timestamp(value):
    try:
        t = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return t if t.tzinfo is not None else None
    except (AttributeError, ValueError, TypeError):
        return None

def clip_sessions(rows, day, now=None):
    start, end = day_bounds(day)
    now = now or datetime.now(timezone.utc)
    cutoff = min(end.timestamp(), now.timestamp())
    result = []
    for row in objects(rows):
        a = timestamp(row.get('begin_at'))
        b = timestamp(row.get('end_at')) if row.get('end_at') is not None else now
        if a is None or b is None:
            continue
        lo, hi = max(a.timestamp(), start.timestamp()), min(b.timestamp(), cutoff)
        if hi <= lo:
            continue
        result.append({'start': datetime.fromtimestamp(lo, ZONE).isoformat(),
                       'end': datetime.fromtimestamp(hi, ZONE).isoformat(),
                       'host': string(row.get('host')),
                       'ongoing': row.get('end_at') is None and hi == cutoff and cutoff < end.timestamp()})
    return sorted(result, key=lambda item: item['start'])

def locations(day, login):
    access = token()
    if not access or not login:
        return None, 'Exact campus sessions require an authorized 42 API token and signed-in campus account.'
    start, end = day_bounds(day)
    low = (start - timedelta(days=7)).astimezone(timezone.utc).isoformat()
    high = end.astimezone(timezone.utc).isoformat()
    rows = []
    truncated = True
    for page in range(1, 6):
        batch = api_get('users/' + quote(login, safe='') + '/locations', access,
                        {'range[begin_at]': low + ',' + high, 'sort': '-begin_at',
                         'page[size]': 100, 'page[number]': page})
        if not isinstance(batch, list):
            raise APIError('Unexpected 42 locations response.')
        rows.extend(batch)
        if len(batch) < 100:
            truncated = False
            break
    note = 'Location intervals use a seven-day start lookback. Unknown gaps are not verified absences.'
    if truncated:
        note += ' API page limit reached; records may be incomplete.'
    return clip_sessions(rows, day), note
