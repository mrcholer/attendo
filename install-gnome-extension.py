#!/usr/bin/env python3
"""Install the GNOME Shell 42 extension for the current user."""
import json
import os
from pathlib import Path
import shutil

project = Path(__file__).resolve().parent
target = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share')) / 'gnome-shell/extensions/logged-time@local'
target.mkdir(parents=True, exist_ok=True)
for name in ('metadata.json', 'extension.js', 'stylesheet.css'):
    shutil.copyfile(project / 'gnome-extension' / name, target / name)
(target / 'config.json').write_text(json.dumps({'project': str(project)}) + '\n')
print(f'Installed: {target}')
print('Enable with: gnome-extensions enable logged-time@local')
print('If not found, log out and back in first. Keep this project at its current path.')
