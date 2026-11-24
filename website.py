#!/usr/bin/env python3
"""Loopback-only web dashboard for the existing logged-time calculator."""
import argparse
import configparser
from datetime import date, datetime
from functools import partial
import getpass
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import signal
from pathlib import Path
import subprocess
import sys
import threading
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

import attendo_client
import intra_client
import campus_features
import intra_credentials
from desktop_startup import autostart_path, launch_at_login, set_launch_at_login

ROOT = Path(__file__).resolve().parent
SETTINGS_LOCK = threading.Lock()


def command_json(script, args):
    result = subprocess.run([sys.executable, str(ROOT / script), *args],
                            stdin=subprocess.DEVNULL, capture_output=True,
                            text=True, timeout=30, cwd=ROOT)
    if result.returncode:
        raise ValueError(result.stderr.strip() or 'Unable to load attendance data.')
    return json.loads(result.stdout)


def dashboard(day, refresh=False):
    data = {'date': day, 'report': None, 'locks': None, 'errors': []}
    for key, script, args in (
        ('report', 'daily.py', ['--intra', '--once', '--no-collect', '--date', day]),
        ('locks', 'shared_history.py', ['list', '--json', '--date', day]),
    ):
        try:
            if key == 'locks' and data['report']:
                current = next((period for period in data['report'].get('attendance_periods', [])
                                if period['label'] == 'Current period'), None)
                if current:
                    args.extend(['--period', current['start'][:10], current['end'][:10]])
            data[key] = command_json(script, args)
        except (ValueError, OSError, subprocess.TimeoutExpired) as error:
            data['errors'].append(str(error))
    return data


def session_status():
    errors = []
    profile = None
    try:
        profile = attendo_client.session_profile()
        attendo = profile is not None
    except attendo_client.AttendoError as error:
        attendo = None
        errors.append(str(error))
    except OSError:
        attendo = None
        errors.append('Unable to check the Attendo session.')

    # Without an Attendo profile, use the campus workstation login for the Intra lookup.
    try:
        login = os.environ.get('INTRA_LOGIN') or (profile.login if profile else getpass.getuser())
        intra_client.fetch_locations(login)
        intra = True
    except intra_client.IntraSessionError:
        intra = False
    except ValueError as error:
        intra = None
        errors.append(str(error))
    except (OSError, KeyError):
        intra = None
        errors.append('Unable to check the 42 Intra session.')

    active = False if False in (attendo, intra) else attendo and intra
    return {'attendo': attendo, 'intra': intra, 'active': active, 'errors': errors}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def send_json(self, payload, status=200):
        body = json.dumps(payload, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def intra_local(self, post=False):
        port = self.server.server_port
        hosts = {f'localhost:{port}', f'127.0.0.1:{port}'}
        if port == 80:
            hosts.update(('localhost', '127.0.0.1'))
        host = self.headers.get('Host')
        if host not in hosts or self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return False
        return not post or self.headers.get('Origin') == 'http://' + host

    def intra_config_post(self):
        if not self.intra_local(post=True):
            self.send_json({'error': 'Open Xattendo on localhost to change API settings.'}, 403)
            return
        if self.headers.get_content_type() != 'application/json':
            self.send_json({'error': 'Expected JSON settings.'}, 415)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096:
                raise ValueError()
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or payload.get('action') not in ('connect', 'test', 'disconnect'):
                raise ValueError()
        except (ValueError, UnicodeError):
            self.send_json({'error': 'Invalid API configuration request.'}, 400)
            return
        try:
            action = payload['action']
            if action == 'connect':
                result = intra_credentials.connect(payload.get('uid'), payload.get('secret'))
            elif action == 'disconnect':
                result = intra_credentials.disconnect()
            else:
                if not intra_credentials.managed_token(force=True):
                    raise intra_credentials.CredentialError('Connect a 42 API application first.')
                result = intra_credentials.status()
            self.send_json(result)
        except intra_credentials.CredentialError as error:
            self.send_json({'error': str(error)}, 400)

    def do_POST(self):
        if self.path == '/api/intra/config':
            self.intra_config_post()
            return
        if self.path != '/api/settings':
            self.send_error(404)
            return
        port = self.server.server_port
        suffix = f':{port}' if port != 80 else ''
        if self.headers.get('Origin') not in (f'http://localhost{suffix}', f'http://127.0.0.1{suffix}'):
            self.send_json({'error': 'Open xattendo on localhost to change desktop settings.'}, 403)
            return
        if self.headers.get_content_type() != 'application/json':
            self.send_json({'error': 'Expected JSON settings.'}, 415)
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 256:
                raise ValueError('Invalid settings length')
            payload = json.loads(self.rfile.read(length))
            enabled = payload.get('launch_at_login') if isinstance(payload, dict) else None
            if type(enabled) is not bool:
                raise ValueError('Invalid setting')
        except ValueError:
            self.send_json({'error': 'Expected a true or false launch-at-login setting.'}, 400)
            return
        try:
            with SETTINGS_LOCK:
                set_launch_at_login(autostart_path(), enabled, ROOT, sys.executable, port, preserve_command=True)
        except (OSError, ValueError, configparser.Error):
            self.send_json({'error': 'Unable to save the desktop startup setting.'}, 500)
            return
        self.send_json({'launch_at_login': enabled})

    def do_GET(self):
        # Always send current assets even if a browser has an older cached copy.
        for header in ('If-Modified-Since', 'If-None-Match'):
            if header in self.headers:
                del self.headers[header]
        url = urlsplit(self.path)
        if url.path == '/api/health':
            body = json.dumps({'pid': os.getpid()}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif url.path == '/api/settings':
            try:
                self.send_json({'launch_at_login': launch_at_login(autostart_path())})
            except (OSError, ValueError, configparser.Error):
                self.send_json({'error': 'Unable to read the desktop startup setting.'}, 500)
        elif url.path == '/api/session':
            payload = session_status()
            self.send_json(payload, 503 if payload['active'] is None else 200)
        elif url.path == '/api/dashboard':
            try:
                today = datetime.now(ZoneInfo('Africa/Casablanca')).date()
                day = date.fromisoformat(parse_qs(url.query).get('date', [today.isoformat()])[0])
                if day > today:
                    raise ValueError('Choose today or a past day.')
                payload, status = dashboard(day.isoformat(), refresh=parse_qs(url.query).get('refresh') == ['1']), 200
            except ValueError as error:
                payload, status = {'error': str(error)}, 400
            body = json.dumps(payload, allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif url.path == '/api/intra/config':
            if not self.intra_local():
                self.send_json({'error': 'Open Xattendo on localhost.'}, 403)
                return
            try:
                self.send_json(intra_credentials.status())
            except intra_credentials.CredentialError as error:
                self.send_json({'error': str(error)}, 400)
        elif url.path == '/api/intra/catalog':
            if not self.intra_local():
                self.send_json({'error': 'Open Xattendo on localhost.'}, 403)
                return
            try:
                raw_id = parse_qs(url.query).get('cursus', [''])[0]
                if not raw_id.isascii() or not raw_id.isdecimal() or len(raw_id) > 9:
                    raise ValueError('Choose a valid cursus.')
                self.send_json(campus_features.catalog_data(int(raw_id)))
            except (ValueError, OSError) as error:
                self.send_json({'error': str(error)}, 400)
        elif url.path in ('/api/intra/profile', '/api/intra/sessions'):
            port = self.server.server_port
            allowed = {f'localhost:{port}', f'127.0.0.1:{port}'}
            if port == 80:
                allowed.update(('localhost', '127.0.0.1'))
            if self.headers.get('Host') not in allowed or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                self.send_json({'error': 'Open Xattendo on localhost.'}, 403)
                return
            if url.path == '/api/intra/profile':
                self.send_json(campus_features.profile_data())
                return
            try:
                day = date.fromisoformat(parse_qs(url.query).get('date', [datetime.now(campus_features.ZONE).date().isoformat()])[0])
                if day > datetime.now(campus_features.ZONE).date():
                    raise ValueError()
                start, end = campus_features.day_bounds(day)
            except (ValueError, OverflowError):
                self.send_json({'error': 'Choose a valid past or current date.'}, 400)
                return
            payload = {'date': day.isoformat(), 'start': start.isoformat(), 'end': end.isoformat(),
                       'observed_through': min(end, datetime.now(campus_features.ZONE)).isoformat(),
                       'locations': None, 'locks': None, 'notes': []}
            try:
                locks = command_json('shared_history.py', ['list', '--json', '--date', day.isoformat()])
                if isinstance(locks.get('periods'), list):
                    payload['locks'] = locks['periods']
                payload['notes'].append('Screen-lock history contains observed records only.')
            except (ValueError, OSError, subprocess.TimeoutExpired):
                payload['notes'].append('Observed lock history unavailable.')
            try:
                payload['locations'], note = campus_features.locations(day, campus_features.current_login())
                payload['notes'].append(note)
            except (campus_features.APIError, OverflowError) as error:
                payload['notes'].append(str(error))
            self.send_json(payload)
        elif url.path in ('/', '/index.html', '/style.css', '/app.js', '/theme.js', '/manifest.webmanifest', '/sw.js', '/icon-192.png', '/icon-512.png', '/campus.js', '/ui.js'):
            super().do_GET()
        else:
            self.send_error(404)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=47831)
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(ROOT / 'web')))
    from shared_history import HistoryCollector, DEFAULT_HISTORY
    collector = HistoryCollector(DEFAULT_HISTORY, getpass.getuser())
    collector.start()
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    print(f'xattendo is running at http://localhost:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        collector.stop()


if __name__ == '__main__':
    main()
