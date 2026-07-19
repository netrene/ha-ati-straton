"""Constants for the ATI Straton Flex integration."""

from __future__ import annotations

from datetime import timedelta

DOMAIN = "ati_straton"

CONF_HOST = "host"
CONF_USERNAME = "username"
CONF_PASSWORD = "password"

DEFAULT_NAME = "ATI Straton Flex"
DEFAULT_SCAN_INTERVAL = timedelta(seconds=30)

MANUFACTURER = "ATI Aquaristik"

PANEL_URL = "ati-straton"

# Options (config-entry options flow)
CONF_WRITE_ENABLED = "write_enabled"
CONF_SCAN_INTERVAL = "scan_interval"
CONF_AUTO_SAVE = "auto_save"

# Default OFF: write access must be opted in explicitly, so a version update
# never silently enables writing to real reef hardware.
DEFAULT_WRITE_ENABLED = False
DEFAULT_SCAN_INTERVAL_SECONDS = 30
DEFAULT_AUTO_SAVE = True
