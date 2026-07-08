"""Config flow for ATI Straton Flex."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import (
    ATIStratonApiClient,
    ATIStratonAuthError,
    ATIStratonCannotConnect,
    ATIStratonResponseError,
)
from .const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME, DEFAULT_NAME, DOMAIN


async def validate_input(hass: HomeAssistant, data: dict[str, Any]) -> dict[str, Any]:
    """Validate credentials and return discovered lamp metadata."""
    client = ATIStratonApiClient(async_get_clientsession(hass), data)
    info = await client.validate()
    return {
        "title": info.get("deviceType") or DEFAULT_NAME,
        "device_id": info.get("id"),
    }


class ATIStratonConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for ATI Straton Flex."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Handle the initial setup step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            data = {
                CONF_HOST: user_input[CONF_HOST].strip().rstrip("/"),
                CONF_USERNAME: user_input[CONF_USERNAME].strip(),
                CONF_PASSWORD: user_input[CONF_PASSWORD],
            }

            try:
                info = await validate_input(self.hass, data)
            except ATIStratonAuthError:
                errors["base"] = "invalid_auth"
            except ATIStratonCannotConnect:
                errors["base"] = "cannot_connect"
            except ATIStratonResponseError:
                errors["base"] = "invalid_response"
            except Exception:
                errors["base"] = "unknown"
            else:
                unique_id = str(info["device_id"] or data[CONF_HOST])
                await self.async_set_unique_id(unique_id)
                self._abort_if_unique_id_configured(updates={CONF_HOST: data[CONF_HOST]})
                return self.async_create_entry(title=str(info["title"]), data=data)

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_HOST, default="192.168.0.22"): str,
                    vol.Required(CONF_USERNAME, default="admin"): str,
                    vol.Required(CONF_PASSWORD): selector.TextSelector(
                        selector.TextSelectorConfig(
                            type=selector.TextSelectorType.PASSWORD
                        )
                    ),
                }
            ),
            errors=errors,
        )

    async def async_step_reauth(
        self, entry_data: dict[str, Any]
    ) -> config_entries.ConfigFlowResult:
        """Handle reauthentication."""
        self.context["title_placeholders"] = {
            CONF_HOST: str(entry_data.get(CONF_HOST, DEFAULT_NAME))
        }
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Ask for updated credentials."""
        errors: dict[str, str] = {}
        entry = self.hass.config_entries.async_get_entry(self.context["entry_id"])
        if entry is None:
            return self.async_abort(reason="reauth_entry_missing")

        if user_input is not None:
            data = dict(entry.data)
            data[CONF_PASSWORD] = user_input[CONF_PASSWORD]
            if CONF_USERNAME in user_input:
                data[CONF_USERNAME] = user_input[CONF_USERNAME].strip()

            try:
                await validate_input(self.hass, data)
            except ATIStratonAuthError:
                errors["base"] = "invalid_auth"
            except ATIStratonCannotConnect:
                errors["base"] = "cannot_connect"
            except ATIStratonResponseError:
                errors["base"] = "invalid_response"
            except Exception:
                errors["base"] = "unknown"
            else:
                self.hass.config_entries.async_update_entry(entry, data=data)
                await self.hass.config_entries.async_reload(entry.entry_id)
                return self.async_abort(reason="reauth_successful")

        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_USERNAME,
                        default=entry.data.get(CONF_USERNAME, "admin"),
                    ): str,
                    vol.Required(CONF_PASSWORD): selector.TextSelector(
                        selector.TextSelectorConfig(
                            type=selector.TextSelectorType.PASSWORD
                        )
                    ),
                }
            ),
            errors=errors,
        )
