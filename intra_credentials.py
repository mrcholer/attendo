"""Local client-credentials management for Xattendo. No credentials in responses."""
import json
import math
import os
from pathlib import Path
import stat
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, build_opener, HTTPRedirectHandler

LOCK = threading.RLock()
CACHE = None

class CredentialError(ValueError):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CredentialError('Unexpected OAuth redirect refused.')

def path():
    return Path(os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config') / 'xattendo/intra-credentials.json'

def validate(uid, secret):
    for value in (uid, secret):
        if not isinstance(value, str) or not 1 <= len(value) <= 512 or not value.isascii() or any(not c.isprintable() or c.isspace() for c in value):
            raise CredentialError('Enter valid client UID and secret without spaces.')
    return uid, secret

def read_credentials():
    try:
        fd = os.open(path(), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    except OSError:
        raise CredentialError('Unable to read local API credentials.') from None
    with os.fdopen(fd, 'r', encoding='utf-8') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise CredentialError('Local credentials must be owned by you with permissions 600.')
        try:
            data = json.loads(stream.read(4097))
            return validate(data['uid'], data['secret'])
        except (ValueError, KeyError, TypeError, UnicodeError, OSError):
            raise CredentialError('Invalid local API credentials file.') from None

def save_credentials(uid, secret):
    target = path()
    try:
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix='.intra-', dir=target.parent)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                json.dump({'uid': uid, 'secret': secret}, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, target)
        finally:
            if os.path.exists(name):
                os.unlink(name)
    except OSError:
        raise CredentialError('Unable to save local API credentials.') from None

def exchange(uid, secret):
    data = urlencode({'grant_type': 'client_credentials', 'client_id': uid,
                      'client_secret': secret, 'scope': 'public'}).encode()
    req = Request('https://api.intra.42.fr/oauth/token', data=data,
                  headers={'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded',
                           'User-Agent': 'Xattendo/7.3'})
    try:
        with build_opener(NoRedirect()).open(req, timeout=15) as response:
            raw = response.read(65537)
        if len(raw) > 65536:
            raise CredentialError('Unexpected token response.')
        result = json.loads(raw)
        access = result.get('access_token') if isinstance(result, dict) else None
        ttl = result.get('expires_in') if isinstance(result, dict) else None
        if not isinstance(access, str) or not access or len(access) > 8192 or not access.isascii() or any(not c.isprintable() or c.isspace() for c in access):
            raise CredentialError('42 did not return a usable access token.')
        if type(ttl) not in (int, float) or not math.isfinite(ttl) or ttl <= 0:
            raise CredentialError('42 returned an invalid token expiration.')
        return access, time.time() + ttl
    except HTTPError as exc:
        raise CredentialError({400:'42 rejected the application credentials or scope.',
                               401:'Invalid UID or secret. Check your 42 application.',
                               403:'42 denied application access.',
                               429:'42 API rate limit reached. Try again later.'}
                              .get(exc.code, f'42 OAuth returned HTTP {exc.code}.')) from None
    except (URLError, OSError, UnicodeError, json.JSONDecodeError):
        raise CredentialError('Unable to reach 42 OAuth or read its response.') from None

def managed_token(force=False):
    global CACHE
    with LOCK:
        creds = read_credentials()
        if not creds:
            CACHE = None
            return None
        if not force and CACHE and CACHE[0] == creds and CACHE[2] > time.time() + 60:
            return CACHE[1]
        access, expires = exchange(*creds)
        CACHE = (creds, access, expires)
        return access

def manual_available():
    token_path = path().parent / 'intra-token'
    return bool(os.environ.get('INTRA_API_TOKEN', '').strip() or token_path.is_file())

def status():
    with LOCK:
        creds = read_credentials()
        if not creds:
            return {'configured': False, 'connected': False, 'manual': manual_available(), 'uid_hint': None}
        connected = bool(CACHE and CACHE[0] == creds and CACHE[2] > time.time())
        return {'configured': True, 'connected': connected, 'manual': manual_available(),
                'uid_hint': creds[0][:8] + '…' + creds[0][-4:], 'expires_at': int(CACHE[2]) if connected else None}

def connect(uid, secret):
    global CACHE
    with LOCK:
        creds = validate(uid, secret)
        access, expires = exchange(*creds)
        save_credentials(*creds)
        CACHE = (creds, access, expires)
        return status()

def disconnect():
    global CACHE
    with LOCK:
        try:
            path().unlink(missing_ok=True)
        except OSError:
            raise CredentialError('Unable to remove local API credentials.') from None
        CACHE = None
        return status()
