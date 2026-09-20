# AquaSense — IoT Water Dispenser Monitor

AquaSense is a two-part system: an **ESP32-based smart water dispenser** that reports
tank level, temperature, and water usage, and a **web app (PWA)** you open on your
phone or computer to watch it live, review history, get low-water alerts, and
control the dispenser. The two never talk directly to each other — both talk to
the **Lovable Cloud backend** (Supabase), which acts as the single source of truth.

---

## Table of Contents

1. [System overview](#1-system-overview)
2. [The PWA (web app)](#2-the-pwa-web-app)
3. [The backend (Lovable Cloud / Supabase)](#3-the-backend)
4. [Key identities: Device ID vs Device Token](#4-key-identities-device-id-vs-device-token)
5. [Pairing: connecting your ESP32 to the app](#5-pairing-connecting-your-esp32-to-the-app)
6. [ESP32 firmware](#6-esp32-firmware)
7. [ESP32 API reference: endpoints and column names](#7-esp32-api-reference-endpoints-and-column-names)
8. [Setup Mode (tank calibration)](#8-setup-mode-tank-calibration)
9. [Usage counter reset](#9-usage-counter-reset)
10. [Database schema](#10-database-schema)
11. [Project structure](#11-project-structure)
12. [Development](#12-development)

---

## 1. System overview

```
 ┌──────────┐   HTTPS (REST)    ┌──────────────────────┐   Realtime    ┌──────────┐
 │  ESP32   │  ───────────────► │   Lovable Cloud       │  ◄─────────►  │   PWA    │
 │ dispenser│  ◄─────────────── │   (Supabase)          │   (websockets)│  (phone/ │
 └──────────┘   polls commands  │  Postgres + RLS + RPCs│               │  desktop)│
                                 └──────────────────────┘               └──────────┘
```

- **ESP32 → backend:** the dispenser POSTs sensor readings every few seconds and
  asks "any commands for me?" on a poll loop.
- **PWA → backend:** the app reads data in realtime, and when you tap a button
  (reset counter, enter setup, reload config) it inserts a **command row** into
  the database. The ESP32 picks it up on its next poll.
- **PWA ✕ ESP32:** they never connect directly. This keeps the dispenser safe on
  any network and means the app works even when the dispenser is on another WiFi.

A device is **online** when its last reading was less than 60 seconds ago. The app
re-checks this every 15 seconds, so the online/offline pill and banners update by
themselves.

---

## 2. The PWA (web app)

A mobile-first progressive web app you can install on your phone's home screen
from the browser ("Add to Home Screen"). Dark water theme by default with a light
toggle in Settings.

### Screens

| Screen | What it does |
| --- | --- |
| **Dashboard (Home)** | Vertical tank gauge with live level %, temperature (°C), litres used today, online/offline pill, low-water banner, offline banner ("Real-time alerts are paused while the dispenser is offline"), and a last-updated timestamp. |
| **History** | Line charts of water level over 6 h / 24 h / 7 d. Gaps where the dispenser was offline are drawn as straight lines between known points — never dropped to zero. |
| **Alerts** | Newest-first list of low-water alerts, with acknowledge buttons and an all / unacknowledged filter. |
| **Settings** | Rename the device, set sensor offset and low-water threshold (sends `reload_config` to the device), reset the usage counter, see device info, toggle theme, sign out. |
| **Setup Mode** | Calibrates the tank height with the physical sensor (see section 8). |
| **Add dispenser** | Pair a new device by its Device ID; reveals the Device Token once. |

### Behaviour rules baked into the app

- **Usage today** = sum of the positive deltas of `total_liters` since local
  midnight. This survives WiFi gaps and counter resets.
- **Stale data** is dimmed and labelled; an offline dispenser never looks "live".
- All numbers use tabular figures so values don't jump around while updating.
- Every screen has loading skeletons, empty states, and error states.

---

## 3. The backend

Lovable Cloud (Supabase Postgres) holds all data. Security is enforced by
Row-Level Security: a signed-in user can only ever see or touch **their own**
devices. The ESP32 never logs in as a user — instead it calls six special
security-definer RPC functions, each of which verifies the device's secret
token before doing anything.

### The six device-facing RPCs

| RPC | Direction | Purpose |
| --- | --- | --- |
| `ingest_reading` | ESP32 → DB | Save one sensor reading. |
| `fetch_pending_commands` | ESP32 → DB | "Any commands for me?" Also expires stale commands. |
| `ack_command` | ESP32 → DB | Mark a command done / failed. |
| `publish_setup_reading` | ESP32 → DB | During Setup Mode, publish the live measured height. |
| `get_device_config` | DB → ESP32 | Read the tank config the app set (height, offset, threshold). |
| `confirm_counter_reset` | ESP32 → DB | Confirm the usage counter was zeroed on the device. |

Plus two for the app itself: `pair_device` (claim/create a device and reveal its
token once) and `get_device_token` (owner-only token lookup).

There is also a database trigger (`check_low_water`) that fires after every
reading insert: when the level crosses **below** the device's `low_level_pct`
threshold, it creates an alert row automatically — the ESP32 doesn't need to
know about alerts at all.

---

## 4. Key identities: Device ID vs Device Token

| | **Device ID** | **Device Token** |
| --- | --- | --- |
| What | A UUID naming one physical dispenser | A random secret string for that device |
| Example | `7f3a1c2e-9b…-…` | `a94f…` (32 hex chars) |
| Secret? | No — safe to show on the screen | **Yes** — it's the device's password |
| Stored in | `devices.id` | `devices.device_token` |

Every ESP32 request includes **both**: the ID says *which* device it is, the token
*proves* it. The app itself can never list tokens — the token is revealed exactly
once at pairing time so you can paste it into the firmware.

---

## 5. Pairing: connecting your ESP32 to the app

The pairing flow (no account on the ESP32, ever):

1. **Flash the ESP32.** On first boot the firmware generates a random UUID (or you
   hardcode one) and shows it on the dispenser screen / serial log. That's the
   **Device ID**.
2. **In the app**, sign in, tap **Add dispenser**, type the Device ID and a name
   (e.g. "Kitchen Dispenser"), tap **Pair dispenser**.
3. The app creates/claims the `devices` row under your account and reveals the
   **Device Token — shown only once**. Copy it.
4. **Paste the token into `secrets.h`** on the ESP32:
   ```c
   // secrets.h
   #define DEVICE_ID    "7f3a1c2e-…-…"     // devices.id
   #define DEVICE_TOKEN "a94f…"            // devices.device_token
   #define API_URL      "https://<your-app>/api/..."  // or Supabase REST URL
   ```
5. Reboot the ESP32. It starts calling `get_device_config` (to learn the tank
   settings), then enters its normal loop of `ingest_reading` + `fetch_pending_commands`.

For development you can skip step 2–3 by pre-seeding a device row with SQL and
reading its token yourself.

---

## 6. ESP32 firmware

The firmware is plain Arduino/ESP32 code that talks REST over HTTPS to the
backend. Its whole world is a loop:

```text
every ~5 s:  read sensors  →  ingest_reading(level, temp, flow, total)
every ~5 s:  fetch_pending_commands  →  run any command  →  ack_command
on boot and on reload_config:  get_device_config
```

### Sensor → percentage math

The ESP32 mounts an ultrasonic distance sensor pointing down into the tank:

```text
distance_in   = measured distance from sensor to water surface
water_height  = tank_height_in - (distance_in - sensor_offset_in)
level_pct     = clamp(100 * water_height / tank_height_in, 0, 100)
```

`tank_height_in`, `sensor_offset_in`, and `low_level_pct` come from
`get_device_config` so the app can change them without reflashing.

### Non-volatile usage counter

`total_liters` accumulates on the device and must survive power cuts: batch it
in NVS (Preferences) — e.g. flush every N litres or every few minutes, not on
every drip. If the app sends a `reset_counter` command, zero the counter, save
to NVS, ack the command, then call `confirm_counter_reset`.

### Command handling

Commands arrive from `fetch_pending_commands` as rows:

```json
{ "id": 42, "command": "reload_config", "payload": null, "expires_at": "…" }
```

Known commands in v1:

| `command` | What the ESP32 does |
| --- | --- |
| `reload_config` | Call `get_device_config`, apply new values, ack `done`. |
| `enter_setup_mode` | Start publishing live height to `publish_setup_reading` every 2 s until the session ends/cancels, then ack. |
| `reset_counter` | Zero `total_liters`, persist to NVS, ack, then `confirm_counter_reset`. |

Always ack with `ack_command(id, "done")` or `("failed")` — the app's spinner is
waiting on that status.

---

## 7. ESP32 API reference: endpoints and column names

All device traffic goes through RPC endpoints:

```
POST {SUPABASE_URL}/rest/v1/rpc/<function_name>
Headers: apikey: <anon-key>
         Content-Type: application/json
Body:    { "p_device_id": DEVICE_ID, "p_device_token": DEVICE_TOKEN, ... }
```

> On Lovable Cloud the anon key is a publishable key (`sb_publishable_…`). Send it
> in the `apikey` header, **not** as `Authorization: Bearer`.

### 7.1 `ingest_reading` — save a sensor reading

```json
{
  "p_device_id": "<uuid>",
  "p_device_token": "<token>",
  "p_level_pct": 63.5,
  "p_level_in": 7.2,
  "p_temp_c": 22.4,
  "p_flow_lpm": 0.0,
  "p_total_liters": 148.75,
  "p_firmware": "1.1.0"
}
```

Writes into the **`readings`** table, one row per call:

| readings column | From parameter | Notes |
| --- | --- | --- |
| `device_id` | `p_device_id` | links to `devices.id` |
| `level_pct` | `p_level_pct` | 0–100, computed on-device |
| `level_in` | `p_level_in` | computed water height, inches |
| `temp_c` | `p_temp_c` | °C |
| `flow_lpm` | `p_flow_lpm` | litres/min, 0 when idle |
| `total_liters` | `p_total_liters` | cumulative since last reset |
| `created_at` | automatic | server timestamp |

It also updates **`devices`**:

| devices column | How |
| --- | --- |
| `last_seen` | set to `now()` on every reading → drives the online/offline pill |
| `firmware_version` | set if `p_firmware` was passed |
| `total_liters_reset_at` | auto-bumped if the counter ever decreases (gap/reset protection) |

The low-water trigger may then insert into **`alerts`** (`device_id`,
`type = 'low_water'`, `message`, `level_pct`) if the level crossed the threshold.

### 7.2 `fetch_pending_commands` — poll for work

```json
{ "p_device_id": "<uuid>", "p_device_token": "<token>" }
```

Returns up to 10 rows from **`device_commands`** (`id`, `command`, `payload`,
`status`, `expires_at`, …) with `status = 'pending'`, oldest first. Commands past
their 5-minute `expires_at` are auto-marked `expired`.

### 7.3 `ack_command` — report the result

```json
{ "p_device_id": "<uuid>", "p_device_token": "<token>",
  "p_command_id": 42, "p_status": "done" }
```

Updates `device_commands.status` and `executed_at`. Use `"done"` or `"failed"`.

### 7.4 `publish_setup_reading` — live calibration height

```json
{ "p_device_id": "<uuid>", "p_device_token": "<token>",
  "p_setup_id": "<setup-session-uuid>", "p_height_in": 11.8 }
```

Writes `measured_height_in` on **`setup_sessions`** (the live session the app is
watching) and mirrors it onto `devices.measured_height_in` + `last_seen`.

### 7.5 `get_device_config` — read config

```json
{ "p_device_id": "<uuid>", "p_device_token": "<token>" }
```

Reads (does not write) from **`devices`**: `tank_height_in`,
`sensor_offset_in`, `low_level_pct`.

### 7.6 `confirm_counter_reset` — confirm zeroing

```json
{ "p_device_id": "<uuid>", "p_device_token": "<token>" }
```

Sets `devices.total_liters_reset_at = now()` so the app's "usage today" math
ignores readings from before the reset.

### Column-name cheat sheet

| Direction | Table / columns the ESP32 touches |
| --- | --- |
| Writes | `readings`: `device_id, level_pct, level_in, temp_c, flow_lpm, total_liters` |
| Writes | `devices`: `last_seen, firmware_version` (via RPC side effects) |
| Writes | `device_commands`: `status, executed_at` (via `ack_command`) |
| Writes | `setup_sessions` + `devices`: `measured_height_in` (during setup) |
| Reads | `device_commands`: `id, command, payload, expires_at, status` |
| Reads | `devices`: `tank_height_in, sensor_offset_in, low_level_pct` |
| Never | `alerts` (created by the DB trigger), `owner_id`, anything user-related |

---

## 8. Setup Mode (tank calibration)

The ultrasonic sensor needs to know the full tank height. Setup Mode measures it
live:

1. With the tank **empty**, tap **Setup Mode** in the app (dashboard shows
   "Tank height not configured. Tap to set up." until it's done once).
2. The app creates a `setup_sessions` row (2-minute expiry) and sends an
   `enter_setup_mode` command.
3. The ESP32 publishes the raw distance every 2 s via `publish_setup_reading`;
   the app shows it live with a countdown.
4. Tap **Confirm** to save it as `devices.tank_height_in` (or type your own
   value), which triggers `reload_config` on the device.
5. Timeout or cancel leaves everything in a safe previous state.

---

## 9. Usage counter reset

- PWA-only: Settings → **Reset usage counter** (disabled with a tooltip while
  the dispenser is offline).
- Confirmation dialog → inserts a `reset_counter` command → the app shows a
  spinner polling the command status until `done` / `failed` / `expired`.
- The device zeroes its NVS counter and calls `confirm_counter_reset`; the app
  then sums usage only from `devices.total_liters_reset_at` onward.

---

## 10. Database schema

| Table | Holds | Who can touch it |
| --- | --- | --- |
| `devices` | one row per dispenser: config, token, `last_seen`, firmware | owner via app; ESP32 via RPCs |
| `readings` | time-series sensor rows | owner reads; ESP32 inserts via `ingest_reading` |
| `alerts` | low-water events + `acknowledged` flag | owner reads/acks; created by trigger |
| `device_commands` | pending/done/failed/expired commands with 5-min TTL | owner inserts; ESP32 fetches/acks |
| `setup_sessions` | live calibration sessions (2-min expiry) | owner manages; ESP32 publishes height |
| `device_status` (view) | device + computed online status | owner reads |

All tables have Row-Level Security enabled with owner-only policies
(`devices.owner_id = auth.uid()`), and `readings`, `devices`, `device_commands`,
and `alerts` are published to realtime so the app updates instantly.

---

## 11. Project structure

```text
src/
├── routes/
│   ├── __root.tsx                 # app shell, theme, fonts, meta, auth listener
│   ├── auth.tsx                   # email/password + Google sign-in
│   └── _authenticated/            # everything below requires sign-in
│       ├── route.tsx              # auth gate (redirects to /auth)
│       ├── index.tsx              # Dashboard
│       ├── history.tsx            # charts
│       ├── alerts.tsx             # alert list
│       ├── settings.tsx           # device config, reset, theme, sign out
│       └── setup.tsx              # Setup Mode
├── components/
│   ├── AppShell.tsx               # header + bottom navigation
│   ├── TankGauge.tsx              # vertical SVG tank with wave fill
│   └── PairDevice.tsx             # add dispenser / reveal token once
├── hooks/useDevice.ts             # device + readings queries, realtime, online status
├── integrations/supabase/         # generated client (do not edit)
└── styles.css                     # design tokens (water blue / amber / red)
supabase/migrations/               # full schema, RLS, RPCs, trigger
public/                            # PWA manifest + icons
```

---

## 12. Development

```sh
npm i
npm run dev
```

Built with **TanStack Start, React 19, Tailwind CSS v4, shadcn/ui, Recharts** and
**Lovable Cloud (Supabase)**. The ESP32 firmware is Arduino/C++ and lives outside
this repo — this project is the app + backend side of the contract described in
section 7.
