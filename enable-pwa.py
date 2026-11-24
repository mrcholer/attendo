#!/usr/bin/env python3
from pathlib import Path
import ast
import sys

root = Path(__file__).resolve().parent
path = root / 'website.py'
assets = ('/manifest.webmanifest', '/sw.js', '/icon-192.png', '/icon-512.png')
try:
    source = path.read_text(encoding='utf-8')
except OSError as exc:
    sys.exit(f'Run this script inside the Attendo repository: {exc}')
original = "elif url.path in ('/', '/index.html', '/style.css', '/app.js', '/theme.js'):"
replacement = original[:-2] + ', ' + ', '.join(repr(asset) for asset in assets) + '):'
if replacement in source:
    print('PWA assets already enabled.')
    sys.exit(0)
if source.count(original) != 1:
    sys.exit('The upstream asset allowlist has changed. No files modified.')
updated = source.replace(original, replacement)
ast.parse(updated)
backup = root / 'website.py.pre-v6'
if not backup.exists():
    backup.write_text(source, encoding='utf-8')
path.write_text(updated, encoding='utf-8')
print('PWA assets enabled. Restart the local Xattendo server.')
