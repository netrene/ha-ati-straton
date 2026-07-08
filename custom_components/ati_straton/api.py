"""Async API client for ATI Straton Flex lamps."""

from __future__ import annotations

from collections.abc import Mapping
import logging
from typing import Any
from urllib.parse import urljoin

from aiohttp import ClientError, ClientResponseError, ClientSession

from .const import CONF_HOST, CONF_PASSWORD, CONF_USERNAME

_LOGGER = logging.getLogger(__name__)

ENDPOINT_LOGIN = "/login"
ENDPOINT_INFO = "/api/info"
ENDPOINT_STATE = "/api/state"
ENDPOINT_TIMEINFO = "/api/timeinfo"
ENDPOINT_CURRENT = "/api/current"
ENDPOINT_TIMELINES = "/api/timelines"
ENDPOINT_SPOTS = "/api/spots"
ENDPOINT_COLORS = "/api/colors"
ENDPOINT_DEVICES = "/api/devices"
ENDPOINT_VERSION = "/api/version"
ENDPOINT_UPTIME = "/api/uptime"
ENDPOINT_DEMO = "/api/demo"
ENDPOINT_PAR_TABLE = "/api/par-table"


class ATIStratonApiError(Exception):
    """Base ATI Straton API error."""


class ATIStratonCannotConnect(ATIStratonApiError):
    """Raised when the lamp cannot be reached."""


class ATIStratonAuthError(ATIStratonApiError):
    """Raised when credentials are rejected."""


class ATIStratonResponseError(ATIStratonApiError):
    """Raised when the lamp returns unexpected data."""


class ATIStratonApiClient:
    """Small local HTTP client for the ATI Straton Flex web API."""

    def __init__(self, session: ClientSession, config: Mapping[str, Any]) -> None:
        """Initialize the API client."""
        host = str(config[CONF_HOST]).strip()
        if not host.startswith(("http://", "https://")):
            host = f"http://{host}"
        self._base_url = host.rstrip("/")
        self._username = str(config[CONF_USERNAME])
        self._password = str(config[CONF_PASSWORD])
        self._session = session
        self._session_cookie: str | None = None

    async def login(self) -> None:
        """Authenticate and store the local session cookie."""
        url = self._url(ENDPOINT_LOGIN)
        try:
            response = await self._session.post(
                url,
                data={
                    "username": self._username,
                    "password": self._password,
                },
                allow_redirects=False,
                timeout=15,
            )
        except TimeoutError as err:
            raise ATIStratonCannotConnect("Timed out connecting to ATI Straton") from err
        except ClientError as err:
            raise ATIStratonCannotConnect("Cannot connect to ATI Straton") from err

        async with response:
            if response.status in (401, 403):
                raise ATIStratonAuthError("ATI Straton credentials were rejected")
            if response.status not in (200, 302, 303):
                raise ATIStratonResponseError(
                    f"Unexpected login response: {response.status}"
                )
            cookie = response.cookies.get("connect.sid")
            if cookie is None:
                # Some aiohttp sessions keep cookies internally. Still allow this path.
                _LOGGER.debug("ATI Straton login did not expose a connect.sid cookie")
                self._session_cookie = None
            else:
                self._session_cookie = cookie.value

    async def validate(self) -> dict[str, Any]:
        """Validate credentials and return device info."""
        await self.login()
        info = await self.get_info()
        state = await self.get_state()
        if not state.get("initialized", False):
            raise ATIStratonResponseError("ATI Straton is not initialized")
        return info

    async def get_info(self) -> dict[str, Any]:
        """Return lamp metadata."""
        return await self._get_dict(ENDPOINT_INFO)

    async def get_state(self) -> dict[str, Any]:
        """Return initialization state."""
        return await self._get_dict(ENDPOINT_STATE)

    async def get_timeinfo(self) -> dict[str, Any]:
        """Return lamp time information."""
        return await self._get_dict(ENDPOINT_TIMEINFO)

    async def get_current(self) -> dict[str, Any]:
        """Return current ADC and warning state."""
        return await self._get_dict(ENDPOINT_CURRENT)

    async def get_timelines(self) -> list[dict[str, Any]]:
        """Return configured light timelines."""
        return await self._get_list(ENDPOINT_TIMELINES)

    async def get_spots(self) -> list[dict[str, Any]]:
        """Return all configured LED spots."""
        return await self._get_list(ENDPOINT_SPOTS)

    async def get_colors(self) -> list[dict[str, Any]]:
        """Return configured color presets."""
        return await self._get_list(ENDPOINT_COLORS)

    async def get_devices(self) -> list[dict[str, Any]]:
        """Return linked non-local Straton devices."""
        return await self._get_list(ENDPOINT_DEVICES)

    async def get_version(self) -> dict[str, Any]:
        """Return firmware version details."""
        return await self._get_dict(ENDPOINT_VERSION)

    async def get_uptime(self) -> dict[str, Any]:
        """Return uptime information."""
        return await self._get_dict(ENDPOINT_UPTIME)

    async def get_demo(self) -> dict[str, Any] | None:
        """Return demo mode state."""
        payload = await self._get(ENDPOINT_DEMO)
        if payload is None or isinstance(payload, dict):
            return payload
        raise ATIStratonResponseError("ATI Straton demo response is not a dict")

    async def get_par_table(self) -> list[dict[str, Any]]:
        """Return PAR display factor table."""
        return await self._get_list(ENDPOINT_PAR_TABLE)

    async def _get_dict(self, endpoint: str) -> dict[str, Any]:
        payload = await self._get(endpoint)
        if not isinstance(payload, dict):
            raise ATIStratonResponseError(f"{endpoint} did not return an object")
        return payload

    async def _get_list(self, endpoint: str) -> list[dict[str, Any]]:
        payload = await self._get(endpoint)
        if not isinstance(payload, list):
            raise ATIStratonResponseError(f"{endpoint} did not return a list")
        return [item for item in payload if isinstance(item, dict)]

    async def _get(self, endpoint: str, *, retry_auth: bool = True) -> Any:
        headers = {}
        if self._session_cookie:
            headers["Cookie"] = f"connect.sid={self._session_cookie}"

        try:
            response = await self._session.get(
                self._url(endpoint),
                headers=headers,
                timeout=15,
            )
        except TimeoutError as err:
            raise ATIStratonCannotConnect("Timed out connecting to ATI Straton") from err
        except ClientError as err:
            raise ATIStratonCannotConnect("Cannot connect to ATI Straton") from err

        async with response:
            if response.status in (401, 403):
                if retry_auth:
                    await self.login()
                    return await self._get(endpoint, retry_auth=False)
                raise ATIStratonAuthError("ATI Straton session is not authorized")
            try:
                response.raise_for_status()
                return await response.json(content_type=None)
            except ClientResponseError as err:
                raise ATIStratonResponseError(
                    f"{endpoint} returned HTTP {response.status}"
                ) from err
            except ValueError as err:
                text = await response.text()
                raise ATIStratonResponseError(
                    f"{endpoint} returned invalid JSON: {text[:80]}"
                ) from err

    def _url(self, endpoint: str) -> str:
        """Return an absolute URL for an endpoint."""
        return urljoin(f"{self._base_url}/", endpoint.lstrip("/"))
