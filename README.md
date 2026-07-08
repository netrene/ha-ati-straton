# ATI Straton Flex for Home Assistant

Custom Home Assistant integration for ATI Straton Flex aquarium lights.

This is an early HACS-style integration. It talks to the local Straton web
interface and starts with read-only entities only. It does not change the light
program, demo mode, Wi-Fi settings, firmware, user credentials, or reset state.

## Installation

### HACS custom repository

1. Add this repository to HACS as a custom repository.
2. Select category `Integration`.
3. Install `ATI Straton Flex`.
4. Restart Home Assistant.
5. Add the integration from **Settings > Devices & services**.

### Manual

Copy `custom_components/ati_straton` into your Home Assistant
`custom_components` directory and restart Home Assistant.

## Configuration

The config flow asks for:

- Host or URL, for example `192.168.0.22` or `http://192.168.0.22`
- Username
- Password

The ATI web interface uses a local session cookie. The integration stores the
configured username and password in the Home Assistant config entry so it can
re-authenticate when the session expires.

## First sensor set

The first read-only version creates:

- Connection status
- Warning and danger flags from `/api/current`
- Device type
- Firmware version and release
- Uptime
- Lamp time and timezone
- Last successful update
- Raw ADC value
- Estimated power in watts, using the formula observed in the ATI web UI
- Program group count and compact group attributes
- Per enabled spot:
  - Online status
  - Temperature
  - Last online update
- Per active program group:
  - Current scheduled intensity
  - Next scheduled change

## Sidebar program panel

The integration registers a read-only sidebar panel named `ATI Straton`.

The panel displays the daily light curve from `/api/timelines`:

- Program group selector
- SVG curve with time and intensity axes
- Current-time marker
- Support points with time, intensity, and color preset
- Spot status and temperature for the selected group
- Current color spectrum channel values

The panel is intentionally read-only. It does not call `PUT /api/data`, demo,
preview, network, firmware, reboot, or reset endpoints.

## Observed API endpoints

Read-only endpoints used by this integration:

- `GET /api/info`
- `GET /api/state`
- `GET /api/timeinfo`
- `GET /api/current`
- `GET /api/timelines`
- `GET /api/spots`
- `GET /api/colors`
- `GET /api/devices`
- `GET /api/version`
- `GET /api/uptime`
- `GET /api/demo`
- `GET /api/par-table`

Potential future actions are intentionally not implemented yet:

- `POST /api/demo`
- `PUT /api/data`
- `POST /api/network`
- `GET /api/reboot`
- `POST /api/reset-device`
- Firmware update endpoints

## Current device notes

The first analysis found:

- Local master: `114619`
- Linked Straton: `147335` at `192.168.0.223`
- Device type: `Straton Flex 153`
- Software: `3.0.4`, `2024.4-beta`
- Program groups: `Links`, `Mitte`, `rechts`

## Development

Run a syntax check from the repository root:

```bash
python3 -m py_compile custom_components/ati_straton/*.py
```
