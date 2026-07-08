"""Diagnostics support for ATI Straton Flex."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CONF_PASSWORD, DOMAIN
from .coordinator import ATIStratonCoordinator

TO_REDACT = {CONF_PASSWORD, "key", "password"}


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant,
    entry: ConfigEntry,
) -> dict[str, Any]:
    """Return diagnostics for a config entry."""
    coordinator: ATIStratonCoordinator = hass.data[DOMAIN][entry.entry_id]
    data = coordinator.data
    return {
        "entry": _redact(dict(entry.data)),
        "info": _redact(data.info),
        "state": data.state,
        "timeinfo": data.timeinfo,
        "current": data.current,
        "version": data.version,
        "uptime": data.uptime,
        "devices": _redact(data.devices),
        "spots": _summarize_spots(data.spots),
        "timelines": _summarize_timelines(data.timelines),
        "colors_count": len(data.colors),
        "last_successful_refresh": coordinator.last_successful_refresh.isoformat()
        if coordinator.last_successful_refresh
        else None,
    }


def _summarize_spots(spots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": spot.get("_id"),
            "name": spot.get("name"),
            "external_id": spot.get("externalId"),
            "custom_name": spot.get("customName"),
            "online": spot.get("online"),
            "enabled": spot.get("enabled"),
            "temperature": spot.get("temperature"),
            "ip": spot.get("ip"),
        }
        for spot in spots
    ]


def _summarize_timelines(timelines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": timeline.get("_id"),
            "name": timeline.get("name"),
            "visible": timeline.get("visible"),
            "active": timeline.get("active"),
            "spot_addresses": timeline.get("spotAddresses"),
            "nodes": len(timeline.get("nodes", [])),
            "spots": [
                spot.get("externalId")
                for spot in timeline.get("spots", [])
                if isinstance(spot, dict)
            ],
        }
        for timeline in timelines
    ]


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "***REDACTED***" if str(key).lower() in TO_REDACT else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value
