.DEFAULT_GOAL := update

PYTHON ?= python3
PORT ?= 47831
ARGS ?=

.PHONY: dependencies update help web stats run once json locks collect snapshot migrate-history install uninstall test gnome

help:
	@printf '%s\n' \
	  'Logged time calculator' \
	  '' \
	  '  make            Pull updates, migrate lock history, and reopen the website' \
	  '  make stats      Show stats once in the terminal' \
	  '  make run        Show the live daily report (Ctrl-C to exit)' \
	  '  make web        Open the localhost website server on port 47831' \
	  '  make once       Print one daily JSON report' \
	  '  make json       Print JSON reports every refresh' \
	  '  make locks      List today’s lock periods and total locked time' \
	  '  make collect    Collect lock history in the foreground' \
	  '  make snapshot   Save current lock history once' \
	  '  make migrate-history  Import, verify, and remove legacy JSON history files' \
	  '  make install    Install logged-time on PATH and start background website and enable login startup' \
	  '  make uninstall  Stop website, remove command and startup; preserve history' \
	  '  make test       Run the offline test suite' \
	  '' \
	  'Options: PYTHON=python3 ARGS="--refresh 30"' \
	  'Example: make once ARGS="--date 2026-11-14"' \
	  'See README.md for login, shared-home storage, and accuracy details.'

stats:
	$(PYTHON) daily.py stats $(ARGS)

run:
	$(PYTHON) daily.py $(ARGS)

web:
	$(PYTHON) website.py $(ARGS)

once:
	$(PYTHON) daily.py --once $(ARGS)

json:
	$(PYTHON) daily.py --json $(ARGS)

locks:
	$(PYTHON) shared_history.py list $(ARGS)

collect:
	$(PYTHON) shared_history.py collect $(ARGS)

snapshot:
	$(PYTHON) shared_history.py collect --once $(ARGS)

migrate-history:
	$(PYTHON) shared_history.py migrate --delete-imported $(ARGS)

update:
	git -c url.https://github.com/mohamednasih/attendo.git.insteadOf=git@github.com:mohamednasih/attendo.git pull --ff-only
	$(PYTHON) server_control.py stop
	$(MAKE) install

dependencies:
	$(PYTHON) browser_dependencies.py install

install: dependencies
	$(MAKE) migrate-history ARGS=
	PORT="$(PORT)" bash ./install.sh
	@if [ -d "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/logged-time@local" ]; then $(PYTHON) install-gnome-extension.py; fi

uninstall:
	bash ./install.sh --uninstall
	$(PYTHON) browser_dependencies.py remove

test:
	$(PYTHON) -m unittest -v

gnome:
	$(PYTHON) install-gnome-extension.py
