"""The ATI Straton Flex integration."""

from __future__ import annotations

from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import ATIStratonApiClient
from .const import (
    CONF_SCAN_INTERVAL,
    CONF_WRITE_ENABLED,
    DEFAULT_SCAN_INTERVAL_SECONDS,
    DEFAULT_WRITE_ENABLED,
    DOMAIN,
)
from .coordinator import ATIStratonCoordinator
from .panel import async_setup_panel, async_unload_panel_if_unused

PLATFORMS: list[Platform] = [
    Platform.BINARY_SENSOR,
    Platform.SENSOR,
]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up ATI Straton from a config entry."""
    write_enabled = entry.options.get(CONF_WRITE_ENABLED, DEFAULT_WRITE_ENABLED)
    client = ATIStratonApiClient(
        async_get_clientsession(hass), entry.data, write_enabled=write_enabled
    )
    await client.login()
    coordinator = ATIStratonCoordinator(hass, entry, client)
    scan_interval = entry.options.get(
        CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL_SECONDS
    )
    coordinator.update_interval = timedelta(seconds=scan_interval)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await async_setup_panel(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the entry when options change (write access, scan interval)."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload an ATI Straton config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
        async_unload_panel_if_unused(hass)
    return unload_ok
