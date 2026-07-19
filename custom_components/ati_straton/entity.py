"""Entity helpers for ATI Straton Flex."""

from __future__ import annotations

from typing import Any

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, MANUFACTURER
from .coordinator import (
    ATIStratonCoordinator,
    ATIStratonData,
    external_device_id,
    first_present,
    spot_section,
)


def lamp_device_info(data: ATIStratonData, lamp_id: Any) -> DeviceInfo:
    """Build the device registry entry for one physical lamp.

    Single source of truth so the master lamp gets the same name from both the
    whole-device entities and its spot entities. Naming scheme:
    ``<deviceType>-<serial>-<Master|Slave>`` (e.g. ``Straton Flex 153-114619-Master``).
    """
    lamp_id = str(lamp_id)
    is_master = lamp_id == str(data.device_id)

    if is_master:
        model = data.device_type or "Straton Flex"
        sw_version = data.sw_version
    else:
        device = next(
            (
                item
                for item in data.devices
                if str(first_present(item, "externalId")) == lamp_id
            ),
            None,
        )
        model = first_present(device, "deviceType") or data.device_type or "Straton Flex"
        sw_version = data.sw_version
        version = first_present(device, "swVersion")
        if isinstance(version, dict):
            sw_version = first_present(version, "number") or sw_version

    role = "Master" if is_master else "Slave"
    info: DeviceInfo = {
        "identifiers": {(DOMAIN, lamp_id)},
        "manufacturer": MANUFACTURER,
        "model": str(model),
        "name": f"{model}-{lamp_id}-{role}",
    }
    if not is_master:
        info["via_device"] = (DOMAIN, str(data.device_id))
    if sw_version:
        info["sw_version"] = str(sw_version)
    return info


class ATIStratonEntity(CoordinatorEntity[ATIStratonCoordinator]):
    """Base entity for ATI Straton."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: ATIStratonCoordinator, suffix: str) -> None:
        """Initialize the entity."""
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.entry.entry_id}_{suffix}"
        self._attr_suggested_object_id = f"ati_straton_{suffix}"

    @property
    def device_info(self) -> DeviceInfo:
        """Return Home Assistant device registry info for the master lamp."""
        data = self.coordinator.data
        if data and data.device_id:
            return lamp_device_info(data, data.device_id)
        return {
            "identifiers": {(DOMAIN, str(self.coordinator.entry.entry_id))},
            "manufacturer": MANUFACTURER,
            "model": "Straton Flex",
            "name": "ATI Straton Flex",
        }


class ATIStratonSpotEntity(ATIStratonEntity):
    """Base entity tied to one Straton spot."""

    def __init__(
        self,
        coordinator: ATIStratonCoordinator,
        spot_id: str,
        suffix: str,
    ) -> None:
        """Initialize the entity."""
        self.spot_id = spot_id
        super().__init__(coordinator, f"spot_{spot_id}_{suffix}")

    @property
    def spot_label(self) -> str:
        """Return a concise user-facing spot label.

        Prefers the program section (Links/Mitte/rechts) derived from the spot's
        externalId, since the spot device is already the physical lamp.
        """
        spot = self.spot
        external_id = first_present(spot, "externalId")
        section = spot_section(external_id)
        if section:
            return section
        name = first_present(spot, "name")
        if name:
            return str(name).replace("_", " ")
        if external_id:
            return f"Spot {external_id}"
        return f"Spot {self.spot_id}"

    @property
    def spot(self) -> dict[str, Any] | None:
        """Return the current spot object."""
        for spot in self.coordinator.data.spots:
            if str(first_present(spot, "_id")) == self.spot_id:
                return spot
        return None

    @property
    def device_info(self) -> DeviceInfo:
        """Return device info for the physical lamp that owns the spot."""
        data = self.coordinator.data
        external_id = first_present(self.spot, "externalId")
        lamp_id = external_device_id(external_id) or data.device_id
        return lamp_device_info(data, lamp_id)
