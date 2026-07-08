"""Entity helpers for ATI Straton Flex."""

from __future__ import annotations

from typing import Any

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, MANUFACTURER
from .coordinator import ATIStratonCoordinator, external_device_id, first_present


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
        """Return Home Assistant device registry info."""
        data = self.coordinator.data
        device_id = data.device_id if data else self.coordinator.entry.entry_id
        name = data.device_type if data else "ATI Straton Flex"
        info: DeviceInfo = {
            "identifiers": {(DOMAIN, str(device_id))},
            "manufacturer": MANUFACTURER,
            "model": data.device_type if data else "Straton Flex",
            "name": str(name or "ATI Straton Flex"),
        }
        if data and data.sw_version:
            info["sw_version"] = data.sw_version
        return info


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
        """Return a concise user-facing spot label."""
        spot = self.spot
        name = first_present(spot, "name")
        external_id = first_present(spot, "externalId")
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
        spot = self.spot
        data = self.coordinator.data
        external_id = first_present(spot, "externalId")
        lamp_id = external_device_id(external_id) or data.device_id
        custom_name = first_present(spot, "customName")
        device = next(
            (
                item
                for item in data.devices
                if str(first_present(item, "externalId")) == str(lamp_id)
            ),
            None,
        )
        model = first_present(device, "deviceType") or data.device_type or "Straton Flex"
        name = custom_name or first_present(device, "name") or f"ATI-Straton-{lamp_id}"
        sw_version = data.sw_version
        version = first_present(device, "swVersion")
        if isinstance(version, dict):
            sw_version = first_present(version, "number") or sw_version

        info: DeviceInfo = {
            "identifiers": {(DOMAIN, str(lamp_id))},
            "manufacturer": MANUFACTURER,
            "model": str(model),
            "name": str(name),
        }
        if lamp_id != data.device_id:
            info["via_device"] = (DOMAIN, str(data.device_id))
        if sw_version:
            info["sw_version"] = str(sw_version)
        return info
