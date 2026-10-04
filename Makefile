.PHONY: install install-data data data-offline test-data dev test lint

PYTHON ?= .venv/bin/python

install:
	$(MAKE) install-data
	cd apps/web && npm install

install-data:
	python3 -m venv .venv
	.venv/bin/python -m pip install -r pipelines/requirements.txt

data:
	$(PYTHON) pipelines/build_feature_store.py

data-offline:
	$(PYTHON) pipelines/build_feature_store.py --offline

test-data:
	$(PYTHON) -m pytest pipelines/tests -q

dev:
	cd apps/web && npm run dev

test:
	$(MAKE) test-data
	cd apps/web && npm test

lint:
	cd apps/web && npm run lint
