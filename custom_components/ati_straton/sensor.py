"""Sensor platform for ATI Straton Flex."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE, UnitOfPower, UnitOfTemperature, UnitOfTime
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import slugify

from .const import DOMAIN
from .coordinator import (
    ATIStratonCoordinator,
    current_timeline_value,
    first_present,
    ms_timestamp,
    next_timeline_change,
)
from .entity import ATIStratonEntity, ATIStratonSpotEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up ATI Straton sensor entities."""
    coordinator: ATIStratonCoordinator = hass.data[DOMAIN][entry.entry_id]
    known_spots: set[str] = set()
    known_timelines: set[str] = set()

    async_add_entities(
        [
            ATIStratonStaticSensor(
                coordinator,
                "device_type",
                "device_type",
                lambda data: data.device_type,
                EntityCategory.DIAGNOSTIC,
            ),
            ATIStratonStaticSensor(
                coordinator,
                "firmware_version",
                "firmware_version",
                lambda data: data.sw_version,
                EntityCategory.DIAGNOSTIC,
            ),
            ATIStratonStaticSensor(
                coordinator,
                "firmware_release",
                "firmware_release",
                lambda data: data.version.get("release"),
                EntityCategory.DIAGNOSTIC,
            ),
            ATIStratonStaticSensor(
                coordinator,
                "timezone",
                "timezone",
                lambda data: data.timeinfo.get("timezone", {}).get("name")
                if isinstance(data.timeinfo.get("timezone"), dict)
                else None,
                EntityCategory.DIAGNOSTIC,
            ),
            ATIStratonUptimeSensor(coordinator),
            ATIStratonLampTimeSensor(coordinator),
            ATIStratonLastUpdateSensor(coordinator),
            ATIStratonADCSensor(coordinator),
            ATIStratonPowerSensor(coordinator),
            ATIStratonProgramGroupsSensor(coordinator),
        ]
    )

    @callback
    def add_dynamic_entities() -> None:
        entities: list[SensorEntity] = []
        for spot in coordinator.data.enabled_spots:
            spot_id = first_present(spot, "_id")
            if spot_id is None:
                continue
            spot_key = str(spot_id)
            if spot_key not in known_spots:
                known_spots.add(spot_key)
                entities.append(ATIStratonSpotTemperatureSensor(coordinator, spot_key))
                entities.append(ATIStratonSpotLastUpdateSensor(coordinator, spot_key))

        for timeline in coordinator.data.active_timelines:
            timeline_id = first_present(timeline, "_id")
            if timeline_id is None:
                continue
            timeline_key = str(timeline_id)
            if timeline_key not in known_timelines:
                known_timelines.add(timeline_key)
                entities.append(
                    ATIStratonTimelineIntensitySensor(coordinator, timeline_key)
                )
                entities.append(
                    ATIStratonTimelineNextChangeSensor(coordinator, timeline_key)
                )
        if entities:
            async_add_entities(entities)

    add_dynamic_entities()
    remove_listener: CALLBACK_TYPE = coordinator.async_add_listener(add_dynamic_entities)
    entry.async_on_unload(remove_listener)


class ATIStratonStaticSensor(ATIStratonEntity, SensorEntity):
    """Static metadata sensor."""

    def __init__(
        self,
        coordinator: ATIStratonCoordinator,
        suffix: str,
        translation_key: str,
        value_fn: Callable[[Any], Any],
        entity_category: EntityCategory | None = None,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, suffix)
        self._attr_translation_key = translation_key
        self._attr_entity_category = entity_category
        self._value_fn = value_fn

    @property
    def native_value(self) -> Any:
        """Return the sensor value."""
        return self._value_fn(self.coordinator.data)


class ATIStratonUptimeSensor(ATIStratonEntity, SensorEntity):
    """Lamp uptime sensor."""

    _attr_translation_key = "uptime"
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.SECONDS
    _attr_state_class = SensorStateClass.TOTAL_INCREASING
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ATIStratonCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "uptime")

    @property
    def native_value(self) -> float | None:
        """Return uptime in seconds."""
        value = self.coordinator.data.uptime.get("uptime")
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return human-readable uptime fields."""
        uptime = self.coordinator.data.uptime
        return {
            "days": uptime.get("days"),
            "hours": uptime.get("hours"),
            "minutes": uptime.get("minutes"),
            "seconds": uptime.get("seconds"),
        }


class ATIStratonLampTimeSensor(ATIStratonEntity, SensorEntity):
    """Lamp clock sensor."""

    _attr_translation_key = "lamp_time"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ATIStratonCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "lamp_time")

    @property
    def native_value(self) -> datetime | None:
        """Return lamp time."""
        value = self.coordinator.data.timeinfo.get("ts")
        return ms_timestamp(value)


class ATIStratonLastUpdateSensor(ATIStratonEntity, SensorEntity):
    """Timestamp of the last successful update."""

    _attr_translation_key = "last_update"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ATIStratonCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "last_update")

    @property
    def native_value(self) -> datetime | None:
        """Return the coordinator refresh timestamp."""
        return self.coordinator.last_successful_refresh


class ATIStratonADCSensor(ATIStratonEntity, SensorEntity):
    """Raw ADC status sensor."""

    _attr_translation_key = "adc"
    _attr_icon = "mdi:current-dc"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ATIStratonCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "adc")

    @property
    def native_value(self) -> int | None:
        """Return the current ADC value."""
        try:
            return int(self.coordinator.data.current.get("adc"))
        except (TypeError, ValueError):
            return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return ADC warning thresholds."""
        current = self.coordinator.data.current
        return {
            "max": current.get("max"),
            "warn": current.get("warn"),
        }


class ATIStratonPowerSensor(ATIStratonEntity, SensorEntity):
    """Estimated current power display value."""

    _attr_translation_key = "estimated_power"
    _attr_device_class = SensorDeviceClass.POWER
    _attr_native_unit_of_measurement = UnitOfPower.WATT
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator: ATIStratonCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "estimated_power")

    @property
    def native_value(self) -> int | None:
        """Return the watt value used by the ATI web UI."""
        try:
            adc = float(self.coordinator.data.current.get("adc"))
        except (TypeError, ValueError):
            return None
        value = round(0.00025 * adc / 8 * 24 / 0.004)
        return max(0, int(value))


class ATIStratonProgramGroupsSensor(ATIStratonEntity, SensorEntity):
    """Number of configured program groups."""

    _attr_translation_key = "program_groups"
    _attr_icon = "mdi:chart-timeline-variant"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ATIStratonCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "program_groups")

    @property
    def native_value(self) -> int:
        """Return active group count."""
        return len(self.coordinator.data.active_timelines)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return a compact summary of program groups."""
        return {
            "groups": [
                {
                    "id": timeline.get("_id"),
                    "name": timeline.get("name"),
                    "visible": timeline.get("visible"),
                    "active": timeline.get("active"),
                    "spots": [
                        spot.get("externalId")
                        for spot in timeline.get("spots", [])
                        if isinstance(spot, dict)
                    ],
                    "nodes": len(timeline.get("nodes", [])),
                }
                for timeline in self.coordinator.data.timelines
            ]
        }


class ATIStratonSpotTemperatureSensor(ATIStratonSpotEntity, SensorEntity):
    """Spot temperature sensor."""

    _attr_translation_key = "spot_temperature"
    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator: ATIStratonCoordinator, spot_id: str) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, spot_id, "temperature")
        self._attr_name = f"{self.spot_label} Temperatur"

    @property
    def native_value(self) -> float | None:
        """Return spot temperature."""
        spot = self.spot
        try:
            return float(spot.get("temperature")) if spot else None
        except (TypeError, ValueError):
            return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return spot metadata."""
        spot = self.spot or {}
        return {
            "name": spot.get("name"),
            "external_id": spot.get("externalId"),
            "custom_name": spot.get("customName"),
            "ip": spot.get("ip"),
            "raw_temperatures": spot.get("rawtemperature"),
        }


class ATIStratonSpotLastUpdateSensor(ATIStratonSpotEntity, SensorEntity):
    """Spot last-online timestamp."""

    _attr_translation_key = "spot_last_update"
    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ATIStratonCoordinator, spot_id: str) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, spot_id, "last_update")
        self._attr_name = f"{self.spot_label} Letzte Aktualisierung"

    @property
    def native_value(self) -> datetime | None:
        """Return last online update."""
        spot = self.spot
        return ms_timestamp(spot.get("lastOnlineUpdate")) if spot else None


class ATIStratonTimelineIntensitySensor(ATIStratonEntity, SensorEntity):
    """Current scheduled group intensity."""

    _attr_translation_key = "timeline_intensity"
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator: ATIStratonCoordinator, timeline_id: str) -> None:
        """Initialize the sensor."""
        self.timeline_id = timeline_id
        name = _timeline_slug(coordinator, timeline_id)
        super().__init__(coordinator, f"group_{name}_intensity")
        self._attr_name = (
            f"{_timeline_name(coordinator, timeline_id)} geplante Intensitaet"
        )

    @property
    def native_value(self) -> float | None:
        """Return current scheduled group intensity."""
        timeline = self._timeline
        return current_timeline_value(timeline) if timeline else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return timeline metadata."""
        timeline = self._timeline or {}
        return _timeline_attributes(timeline)

    @property
    def _timeline(self) -> dict[str, Any] | None:
        for timeline in self.coordinator.data.timelines:
            if str(first_present(timeline, "_id")) == self.timeline_id:
                return timeline
        return None


class ATIStratonTimelineNextChangeSensor(ATIStratonEntity, SensorEntity):
    """Next scheduled group change."""

    _attr_translation_key = "timeline_next_change"
    _attr_icon = "mdi:clock-end"
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ATIStratonCoordinator, timeline_id: str) -> None:
        """Initialize the sensor."""
        self.timeline_id = timeline_id
        name = _timeline_slug(coordinator, timeline_id)
        super().__init__(coordinator, f"group_{name}_next_change")
        self._attr_name = (
            f"{_timeline_name(coordinator, timeline_id)} naechster Wechsel"
        )

    @property
    def native_value(self) -> str | None:
        """Return next change as HH:MM:SS."""
        timeline = self._timeline
        next_change = next_timeline_change(timeline) if timeline else None
        return next_change.isoformat() if next_change else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return timeline metadata."""
        timeline = self._timeline or {}
        return _timeline_attributes(timeline)

    @property
    def _timeline(self) -> dict[str, Any] | None:
        for timeline in self.coordinator.data.timelines:
            if str(first_present(timeline, "_id")) == self.timeline_id:
                return timeline
        return None


def _timeline_slug(coordinator: ATIStratonCoordinator, timeline_id: str) -> str:
    for timeline in coordinator.data.timelines:
        if str(first_present(timeline, "_id")) == timeline_id:
            return slugify(str(timeline.get("name") or timeline_id))
    return slugify(timeline_id)


def _timeline_name(coordinator: ATIStratonCoordinator, timeline_id: str) -> str:
    for timeline in coordinator.data.timelines:
        if str(first_present(timeline, "_id")) == timeline_id:
            return str(timeline.get("name") or timeline_id)
    return timeline_id


def _timeline_attributes(timeline: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": timeline.get("_id"),
        "name": timeline.get("name"),
        "visible": timeline.get("visible"),
        "active": timeline.get("active"),
        "linecolor": timeline.get("linecolor"),
        "spots": [
            spot.get("externalId")
            for spot in timeline.get("spots", [])
            if isinstance(spot, dict)
        ],
        "schedule": [
            {
                "time": node.get("time"),
                "value": node.get("value"),
                "color": node.get("color", {}).get("name")
                if isinstance(node.get("color"), dict)
                else None,
            }
            for node in timeline.get("nodes", [])
            if isinstance(node, dict)
        ],
    }
