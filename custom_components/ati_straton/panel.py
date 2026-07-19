"""Frontend panel and websocket API for ATI Straton Flex programs."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN, PANEL_URL
from .coordinator import (
    ATIStratonCoordinator,
    current_timeline_value,
    next_timeline_change,
)

PANEL_COMPONENT_NAME = "ati-straton-program-panel"
PANEL_ICON = "mdi:chart-bell-curve"
PANEL_TITLE = "ATI Straton"
# Bump on every panel.js change to bust the browser cache and re-register.
PANEL_VERSION = "0.5.0"
PANEL_FILE = "frontend/panel.js"
PANEL_MODULE_URL = f"/ati_straton/panel-{PANEL_VERSION}.js"

WS_PROGRAM_LIST = f"{DOMAIN}/program/list"

PANEL_REGISTERED_VERSION = "__panel_registered_version"
STATIC_REGISTERED = "__static_registered"
WEBSOCKET_REGISTERED = "__websocket_registered"


async def async_setup_panel(hass: HomeAssistant) -> None:
    """Register the program panel and websocket commands."""
    data = hass.data.setdefault(DOMAIN, {})

    if data.get(STATIC_REGISTERED) != PANEL_VERSION:
        static_path = Path(__file__).parent / PANEL_FILE
        await hass.http.async_register_static_paths(
            [StaticPathConfig(PANEL_MODULE_URL, str(static_path), False)]
        )
        data[STATIC_REGISTERED] = PANEL_VERSION

    if not data.get(WEBSOCKET_REGISTERED):
        websocket_api.async_register_command(hass, websocket_program_list)
        data[WEBSOCKET_REGISTERED] = True

    frontend_panels = hass.data.get("frontend_panels", {})
    if (
        PANEL_URL in frontend_panels
        and data.get(PANEL_REGISTERED_VERSION) != PANEL_VERSION
    ):
        frontend.async_remove_panel(hass, PANEL_URL)

    if PANEL_URL not in hass.data.get("frontend_panels", {}):
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL,
            webcomponent_name=PANEL_COMPONENT_NAME,
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=PANEL_MODULE_URL,
            config={"domain": DOMAIN, "version": PANEL_VERSION},
            require_admin=True,
        )
    data[PANEL_REGISTERED_VERSION] = PANEL_VERSION


@callback
def async_unload_panel_if_unused(hass: HomeAssistant) -> None:
    """Remove the panel when no ATI Straton entries are loaded."""
    data = hass.data.get(DOMAIN, {})
    if any(isinstance(value, ATIStratonCoordinator) for value in data.values()):
        return

    if PANEL_URL in hass.data.get("frontend_panels", {}):
        frontend.async_remove_panel(hass, PANEL_URL)
    data.pop(PANEL_REGISTERED_VERSION, None)


@websocket_api.websocket_command({vol.Required("type"): WS_PROGRAM_LIST})
@websocket_api.async_response
async def websocket_program_list(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return loaded ATI Straton programs."""
    programs = []
    for entry_id, coordinator in hass.data.get(DOMAIN, {}).items():
        if not isinstance(coordinator, ATIStratonCoordinator):
            continue
        programs.append(_program_payload(entry_id, coordinator))

    connection.send_result(msg["id"], {"programs": programs})


def _program_payload(entry_id: str, coordinator: ATIStratonCoordinator) -> dict[str, Any]:
    """Return a frontend-friendly program payload."""
    data = coordinator.data
    return {
        "entry_id": entry_id,
        "title": coordinator.entry.title,
        "device": {
            "id": data.device_id,
            "type": data.device_type,
            "software": data.sw_version,
            "timezone": _timezone_name(data.timeinfo),
        },
        "current": {
            "adc": data.current.get("adc"),
            "estimated_power": data.estimated_watts,
            "warning": data.current.get("isWarning"),
            "danger": data.current.get("isDanger"),
        },
        "par": _par_payload(data),
        "spots": [_spot_payload(spot) for spot in data.spots],
        "colors": [_color_payload(color) for color in data.colors],
        "timelines": [_timeline_payload(timeline) for timeline in data.timelines],
        "last_successful_refresh": coordinator.last_successful_refresh.isoformat()
        if coordinator.last_successful_refresh
        else None,
    }


def _timeline_payload(timeline: dict[str, Any]) -> dict[str, Any]:
    """Return a timeline payload for the frontend."""
    return {
        "id": timeline.get("_id"),
        "name": timeline.get("name"),
        "visible": timeline.get("visible"),
        "active": timeline.get("active"),
        "linecolor": timeline.get("linecolor"),
        "spot_addresses": timeline.get("spotAddresses", []),
        "current_intensity": current_timeline_value(timeline),
        "next_change": _time_to_text(next_timeline_change(timeline)),
        "spots": [
            _spot_ref_payload(spot)
            for spot in timeline.get("spots", [])
            if isinstance(spot, dict)
        ],
        "nodes": [
            _node_payload(node)
            for node in timeline.get("nodes", [])
            if isinstance(node, dict)
        ],
    }


def _node_payload(node: dict[str, Any]) -> dict[str, Any]:
    color = node.get("color") if isinstance(node.get("color"), dict) else {}
    return {
        "index": node.get("index"),
        "type": node.get("type"),
        "time": node.get("time"),
        "time_label": _seconds_to_hhmm(node.get("time")),
        "value": node.get("value"),
        "value_org": node.get("valueOrg"),
        "active": node.get("active"),
        "color": {
            "id": color.get("_id"),
            "name": color.get("name"),
            "bgColor": color.get("bgColor"),
            "values": [
                {
                    "name": value.get("name"),
                    "value": value.get("value"),
                    "sort": value.get("sort"),
                }
                for value in color.get("values", [])
                if isinstance(value, dict)
            ],
        },
    }


def _spot_payload(spot: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": spot.get("_id"),
        "name": spot.get("name"),
        "external_id": spot.get("externalId"),
        "custom_name": spot.get("customName"),
        "online": spot.get("online"),
        "enabled": spot.get("enabled"),
        "temperature": spot.get("temperature"),
        "ip": spot.get("ip"),
    }


def _spot_ref_payload(spot: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": spot.get("_id"),
        "name": spot.get("name"),
        "external_id": spot.get("externalId"),
        "custom_name": spot.get("customName"),
        "online": spot.get("online"),
        "temperature": spot.get("temperature"),
    }


def _color_payload(color: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": color.get("_id"),
        "name": color.get("name"),
        "visible": color.get("visible"),
        "disabled": color.get("disabled"),
        "bgColor": color.get("bgColor"),
    }


def _timezone_name(timeinfo: dict[str, Any]) -> str | None:
    timezone = timeinfo.get("timezone")
    if isinstance(timezone, dict):
        value = timezone.get("name")
        return str(value) if value not in (None, "") else None
    return None


def _par_payload(data: Any) -> list[dict[str, Any]]:
    """Return PAR per depth (watts × depth factor), verified 2026-07-19."""
    watts = data.estimated_watts
    result: list[dict[str, Any]] = []
    for entry in data.par_table:
        try:
            factor = float(entry.get("factor"))
        except (TypeError, ValueError):
            factor = None
        value = (
            max(0, round(watts * factor))
            if watts is not None and factor is not None
            else None
        )
        result.append(
            {"label": entry.get("label"), "factor": factor, "value": value}
        )
    return result


def _time_to_text(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def _seconds_to_hhmm(value: Any) -> str | None:
    try:
        seconds = max(0, min(86400, int(float(value))))
    except (TypeError, ValueError):
        return None
    if seconds == 86400:
        return "24:00"
    return f"{seconds // 3600:02d}:{(seconds % 3600) // 60:02d}"
