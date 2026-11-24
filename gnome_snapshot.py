#!/usr/bin/env python3
"""Local dashboard bridge for GNOME Shell."""
import argparse
import json
import urllib.request
import webbrowser
from server_control import manage

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--open', choices=('overview', 'profile', 'sessions', 'settings'))
    args = parser.parse_args()
    port = manage('start')
    if args.open:
        webbrowser.open(f'http://localhost:{port}/#/{args.open}')
    else:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f'http://127.0.0.1:{port}/api/dashboard', timeout=75) as response:
            print(json.dumps(json.load(response), allow_nan=False))

if __name__ == '__main__':
    main()
