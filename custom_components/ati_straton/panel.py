"""Frontend panel and websocket API for ATI Straton Flex programs."""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant, callback

from .api import ATIStratonApiError, ATIStratonResponseError, ATIStratonWriteDisabled
from .const import DOMAIN, PANEL_URL
from .coordinator import (
    ATIStratonCoordinator,
    current_timeline_value,
    first_present,
    next_timeline_change,
)

PANEL_COMPONENT_NAME = "ati-straton-program-panel"
PANEL_ICON = "mdi:chart-bell-curve"
PANEL_TITLE = "ATI Straton"
# Bump on every panel.js change to bust the browser cache and re-register.
PANEL_VERSION = "0.10.0"
PANEL_FILE = "frontend/panel.js"
PANEL_MODULE_URL = f"/ati_straton/panel-{PANEL_VERSION}.js"

WS_PROGRAM_LIST = f"{DOMAIN}/program/list"
WS_PROGRAM_SAVE = f"{DOMAIN}/program/save"

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
        websocket_api.async_register_command(hass, websocket_program_save)
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


@websocket_api.websocket_command(
    {
        vol.Required("type"): WS_PROGRAM_SAVE,
        vol.Required("entry_id"): str,
        vol.Required("timeline_id"): vol.Coerce(int),
        vol.Required("nodes"): [dict],
    }
)
@websocket_api.async_response
async def websocket_program_save(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Persist an edited group's curve (the panel editor's Save).

    Read-modify-write done here against the coordinator's current data: only the
    edited timeline's ``nodes`` are replaced; spots and colors are passed back
    opaque. Guarded — the client refuses the write unless write access is on.
    """
    coordinator = hass.data.get(DOMAIN, {}).get(msg["entry_id"])
    if not isinstance(coordinator, ATIStratonCoordinator):
        connection.send_error(msg["id"], "not_found", "ATI Straton entry not found")
        return
    try:
        await _apply_saved_nodes(coordinator, msg["timeline_id"], msg["nodes"])
    except ATIStratonWriteDisabled:
        connection.send_error(
            msg["id"], "write_disabled", "Schreibzugriff ist deaktiviert."
        )
        return
    except ATIStratonResponseError as err:
        connection.send_error(msg["id"], "invalid_request", str(err))
        return
    except ATIStratonApiError as err:
        connection.send_error(msg["id"], "write_failed", str(err))
        return
    connection.send_result(msg["id"], {"ok": True})


async def _apply_saved_nodes(
    coordinator: ATIStratonCoordinator,
    timeline_id: int,
    nodes: list[dict[str, Any]],
) -> None:
    """Build raw nodes from the editor payload and write the full program."""
    data = coordinator.data
    if not nodes:
        raise ATIStratonResponseError("No nodes to save")

    colors_by_id = {c.get("_id"): c.get("name") for c in data.colors}
    timelines = copy.deepcopy(data.timelines)
    target = next(
        (t for t in timelines if str(t.get("_id")) == str(timeline_id)), None
    )
    if target is None:
        raise ATIStratonResponseError(f"Timeline {timeline_id} not found")

    count = len(nodes)
    raw_nodes: list[dict[str, Any]] = []
    for index, node in enumerate(nodes):
        try:
            time_s = max(0, min(86400, int(round(float(node.get("time"))))))
            value = max(0.0, min(100.0, float(node.get("value"))))
        except (TypeError, ValueError) as err:
            raise ATIStratonResponseError("Invalid node time/value") from err
        color_id = node.get("color_id")
        node_type = "first" if index == 0 else "last" if index == count - 1 else "node"
        raw_nodes.append(
            {
                "time": time_s,
                "value": value,
                "type": node_type,
                "index": index,
                "color": {"_id": color_id, "name": colors_by_id.get(color_id)},
            }
        )

    target["nodes"] = raw_nodes
    await coordinator.async_apply_timelines(timelines)


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
        "write_enabled": coordinator.client.write_enabled,
        "par": _par_payload(data),
        "lamps": _lamps_payload(data),
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
        "values": [
            {
                "name": value.get("name"),
                "value": value.get("value"),
                "sort": value.get("sort"),
            }
            for value in color.get("values", [])
            if isinstance(value, dict)
        ],
    }


def _timezone_name(timeinfo: dict[str, Any]) -> str | None:
    timezone = timeinfo.get("timezone")
    if isinstance(timezone, dict):
        value = timezone.get("name")
        return str(value) if value not in (None, "") else None
    return None


def _lamps_payload(data: Any) -> list[dict[str, Any]]:
    """Return the lamp topology (master first, then linked slaves)."""
    lamps: list[dict[str, Any]] = []
    master_id = str(data.device_id) if data.device_id else None
    if master_id:
        lamps.append(
            {
                "serial": master_id,
                "role": "Master",
                "type": data.device_type,
                "sw": data.sw_version,
                "ip": None,
            }
        )
    for device in data.devices:
        serial = first_present(device, "externalId")
        if serial is None:
            continue
        sw = None
        version = first_present(device, "swVersion")
        if isinstance(version, dict):
            sw = first_present(version, "number")
        lamps.append(
            {
                "serial": str(serial),
                "role": "Slave",
                "type": first_present(device, "deviceType") or data.device_type,
                "sw": sw,
                "ip": first_present(device, "ip"),
            }
        )
    return lamps


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
