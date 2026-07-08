"""Binary sensor platform for ATI Straton Flex."""

from __future__ import annotations

from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .coordinator import ATIStratonCoordinator, first_present
from .entity import ATIStratonEntity, ATIStratonSpotEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up ATI Straton binary sensor entities."""
    coordinator: ATIStratonCoordinator = hass.data[DOMAIN][entry.entry_id]
    known_spots: set[str] = set()
    async_add_entities(
        [
            ATIStratonConnectionBinarySensor(coordinator),
            ATIStratonCurrentFlagBinarySensor(
                coordinator,
                "warning",
                "warning",
                "isWarning",
                BinarySensorDeviceClass.PROBLEM,
            ),
            ATIStratonCurrentFlagBinarySensor(
                coordinator,
                "danger",
                "danger",
                "isDanger",
                BinarySensorDeviceClass.PROBLEM,
            ),
        ]
    )

    @callback
    def add_spot_entities() -> None:
        entities: list[BinarySensorEntity] = []
        for spot in coordinator.data.enabled_spots:
            spot_id = first_present(spot, "_id")
            if spot_id is None:
                continue
            spot_key = str(spot_id)
            if spot_key in known_spots:
                continue
            known_spots.add(spot_key)
            entities.append(ATIStratonSpotOnlineBinarySensor(coordinator, spot_key))
        if entities:
            async_add_entities(entities)

    add_spot_entities()
    remove_listener: CALLBACK_TYPE = coordinator.async_add_listener(add_spot_entities)
    entry.async_on_unload(remove_listener)


class ATIStratonConnectionBinarySensor(ATIStratonEntity, BinarySensorEntity):
    """Representation of local API connectivity."""

    _attr_translation_key = "connection"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ATIStratonCoordinator) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, "connection")

    @property
    def is_on(self) -> bool:
        """Return whether the last update succeeded."""
        return self.coordinator.last_update_success


class ATIStratonCurrentFlagBinarySensor(ATIStratonEntity, BinarySensorEntity):
    """Binary sensor for current warning flags."""

    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(
        self,
        coordinator: ATIStratonCoordinator,
        suffix: str,
        translation_key: str,
        field: str,
        device_class: BinarySensorDeviceClass,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, suffix)
        self._attr_translation_key = translation_key
        self._attr_device_class = device_class
        self._field = field

    @property
    def is_on(self) -> bool | None:
        """Return the flag state."""
        value = self.coordinator.data.current.get(self._field)
        return bool(value) if value is not None else None


class ATIStratonSpotOnlineBinarySensor(ATIStratonSpotEntity, BinarySensorEntity):
    """Spot online state."""

    _attr_translation_key = "spot_online"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    def __init__(self, coordinator: ATIStratonCoordinator, spot_id: str) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, spot_id, "online")
        self._attr_name = f"{self.spot_label} Online"

    @property
    def is_on(self) -> bool | None:
        """Return whether the spot is online."""
        spot = self.spot
        if spot is None:
            return None
        value: Any = spot.get("online")
        return bool(value) if value is not None else None
