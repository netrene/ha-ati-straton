"""Data coordinator for ATI Straton Flex lamps."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, time
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import ATIStratonApiClient, ATIStratonApiError, ATIStratonAuthError
from .const import DEFAULT_SCAN_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class ATIStratonData:
    """Latest ATI Straton data."""

    info: dict[str, Any]
    state: dict[str, Any]
    timeinfo: dict[str, Any]
    current: dict[str, Any]
    timelines: list[dict[str, Any]]
    spots: list[dict[str, Any]]
    colors: list[dict[str, Any]]
    devices: list[dict[str, Any]]
    version: dict[str, Any]
    uptime: dict[str, Any]
    demo: dict[str, Any] | None
    par_table: list[dict[str, Any]]

    @property
    def device_id(self) -> str | None:
        """Return the local lamp ID."""
        value = self.info.get("id")
        return str(value) if value not in (None, "") else None

    @property
    def device_type(self) -> str | None:
        """Return the local lamp type."""
        value = self.info.get("deviceType")
        return str(value) if value not in (None, "") else None

    @property
    def sw_version(self) -> str | None:
        """Return the software version number."""
        value = self.version.get("number")
        return str(value) if value not in (None, "") else None

    @property
    def enabled_spots(self) -> list[dict[str, Any]]:
        """Return enabled spots."""
        return [spot for spot in self.spots if spot.get("enabled", True)]

    @property
    def active_timelines(self) -> list[dict[str, Any]]:
        """Return active timelines."""
        return [line for line in self.timelines if line.get("active", True)]


class ATIStratonCoordinator(DataUpdateCoordinator[ATIStratonData]):
    """Coordinate local ATI Straton polling."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        client: ATIStratonApiClient,
    ) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=DEFAULT_SCAN_INTERVAL,
        )
        self.entry = entry
        self.client = client
        self.last_successful_refresh: datetime | None = None

    async def _async_update_data(self) -> ATIStratonData:
        """Fetch latest lamp data."""
        try:
            info = await self.client.get_info()
            state = await self.client.get_state()
            timeinfo = await self.client.get_timeinfo()
            current = await self.client.get_current()
            timelines = await self.client.get_timelines()
            spots = await self.client.get_spots()
            colors = await self.client.get_colors()
            devices = await self.client.get_devices()
            version = await self.client.get_version()
            uptime = await self.client.get_uptime()
            demo = await self._async_optional(self.client.get_demo)
            par_table = await self._async_optional(self.client.get_par_table) or []
        except ATIStratonAuthError as err:
            raise ConfigEntryAuthFailed from err
        except ATIStratonApiError as err:
            raise UpdateFailed(str(err)) from err

        self.last_successful_refresh = datetime.now(UTC)
        return ATIStratonData(
            info=info,
            state=state,
            timeinfo=timeinfo,
            current=current,
            timelines=timelines,
            spots=spots,
            colors=colors,
            devices=devices,
            version=version,
            uptime=uptime,
            demo=demo,
            par_table=par_table,
        )

    async def _async_optional(self, func: Any) -> Any:
        """Fetch optional data without failing the whole update."""
        try:
            return await func()
        except ATIStratonApiError as err:
            _LOGGER.debug("Optional ATI Straton endpoint failed: %s", err)
            return None


def first_present(data: dict[str, Any] | None, *keys: str) -> Any:
    """Return the first non-empty value from a mapping."""
    if not data:
        return None
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None


def external_device_id(value: Any) -> str | None:
    """Return the lamp ID part of an ATI external ID like 114619:0."""
    if value in (None, ""):
        return None
    return str(value).split(":", 1)[0]


def ms_timestamp(value: Any) -> datetime | None:
    """Convert a millisecond epoch value to a UTC datetime."""
    try:
        return datetime.fromtimestamp(float(value) / 1000, UTC)
    except (TypeError, ValueError, OSError):
        return None


def seconds_since_midnight(now: datetime | None = None) -> int:
    """Return current seconds since local midnight."""
    if now is None:
        now = datetime.now()
    return now.hour * 3600 + now.minute * 60 + now.second


def seconds_to_time(value: Any) -> time | None:
    """Convert seconds since midnight to a time."""
    try:
        seconds = max(0, min(86400, int(float(value))))
    except (TypeError, ValueError):
        return None
    if seconds == 86400:
        seconds = 86399
    return time(seconds // 3600, (seconds % 3600) // 60, seconds % 60)


def current_timeline_value(timeline: dict[str, Any]) -> float | None:
    """Interpolate the current timeline intensity."""
    nodes = _sorted_nodes(timeline)
    if not nodes:
        return None
    current_seconds = seconds_since_midnight()
    previous = nodes[0]
    for node in nodes[1:]:
        node_time = _node_time(node)
        previous_time = _node_time(previous)
        if node_time is None or previous_time is None:
            previous = node
            continue
        if current_seconds <= node_time:
            previous_value = _node_value(previous)
            node_value = _node_value(node)
            if previous_value is None or node_value is None:
                return node_value
            if node_time == previous_time:
                return node_value
            ratio = (current_seconds - previous_time) / (node_time - previous_time)
            return round(previous_value + (node_value - previous_value) * ratio, 2)
        previous = node
    return _node_value(nodes[-1])


def next_timeline_change(timeline: dict[str, Any]) -> time | None:
    """Return the next configured change time for a timeline."""
    current_seconds = seconds_since_midnight()
    for node in _sorted_nodes(timeline):
        node_time = _node_time(node)
        if node_time is not None and node_time > current_seconds:
            return seconds_to_time(node_time)
    for node in _sorted_nodes(timeline):
        node_time = _node_time(node)
        if node_time is not None:
            return seconds_to_time(node_time)
    return None


def _sorted_nodes(timeline: dict[str, Any]) -> list[dict[str, Any]]:
    nodes = timeline.get("nodes", [])
    if not isinstance(nodes, list):
        return []
    return sorted(
        [node for node in nodes if isinstance(node, dict)],
        key=lambda item: _node_time(item) or 0,
    )


def _node_time(node: dict[str, Any]) -> int | None:
    try:
        return int(float(node.get("time")))
    except (TypeError, ValueError):
        return None


def _node_value(node: dict[str, Any]) -> float | None:
    try:
        return float(node.get("value"))
    except (TypeError, ValueError):
        return None
