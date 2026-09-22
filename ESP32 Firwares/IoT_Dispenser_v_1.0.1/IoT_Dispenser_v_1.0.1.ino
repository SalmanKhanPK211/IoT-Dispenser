/* ============================================================
 *  AquaSense — IoT Water Dispenser Firmware
 *  Board: ESP32-WROOM
 *  Framework: Arduino ESP32 core
 *  Version: 1.0.1  (rpcCall success-check fix)
 *
 *  Required libraries (Library Manager):
 *    - ArduinoJson        (Benoit Blanchon)  v7.x
 *    - LiquidCrystal_I2C  (Frank de Brabander)
 *    - OneWire            (Paul Stoffregen)
 *    - DallasTemperature  (Miles Burton)
 *
 *  WiFi.h / HTTPClient.h / WiFiClientSecure.h / Wire.h / Preferences.h
 *  ship with the ESP32 Arduino core.
 * ============================================================ */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Preferences.h>

/* ============================================================
 *  SECTION 1 — secrets.h  (EDIT THESE VALUES)
 * ============================================================ */

// ---- WiFi ----
#define WIFI_SSID        "YOUR_WIFI_SSID"
#define WIFI_PASSWORD    "YOUR_WIFI_PASSWORD"

// ---- Supabase / Lovable Cloud ----
// Use the publishable key (sb_publishable_...) in the apikey header.
#define SUPABASE_URL     "https://YOUR_PROJECT.supabase.co"
#define SUPABASE_KEY     "sb_publishable_XXXXXXXXXXXXXXXXXXXX"

// ---- Device identity (from the PWA "Pair dispenser" screen) ----
// IMPORTANT: pair a fresh device in the app and paste the NEW values here.
// Do NOT reuse any UUID/token that has been shared in screenshots or chat.
#define DEVICE_ID        "PASTE-NEW-DEVICE-ID-HERE"
#define DEVICE_TOKEN     "PASTE-NEW-DEVICE-TOKEN-HERE"

#define FIRMWARE_VERSION "1.0.1"

/* ============================================================
 *  SECTION 2 — config.h  (pins, timing, safety limits)
 * ============================================================ */

// ---------------- Pin map ----------------
#define PIN_I2C_SDA          21
#define PIN_I2C_SCL          22
#define PIN_ULTRASONIC_TRIG   5
#define PIN_ULTRASONIC_ECHO  18   // 5V echo -> use a divider to 3.3V
#define PIN_IR_GLASS         19   // INPUT_PULLUP, LOW = glass present
#define PIN_FLOW             27   // YF-S201 pulse output
#define PIN_RELAY            26   // to opto-isolated relay input
#define PIN_BUZZER           25
#define PIN_DS18B20           4   // 4.7k pull-up to 3.3V

// ---------------- Timing ----------------
#define READING_INTERVAL_MS  15000UL   // POST reading every 15s
#define COMMAND_POLL_MS       5000UL   // poll commands every 5s
#define SETUP_PUBLISH_MS      2000UL   // setup mode publishes every 2s
#define SETUP_TIMEOUT_MS    120000UL   // 2-minute setup window
#define NVS_FLUSH_MS        300000UL   // batch total_liters every 5 min
#define NVS_FLUSH_LITERS         0.5f  // or on 0.5 L delta
#define WIFI_RETRY_MIN_MS     1000UL
#define WIFI_RETRY_MAX_MS    60000UL

// ---------------- Pump / safety ----------------
#define GLASS_CONFIRM_MS       500UL   // glass must be present this long
#define MAX_DISPENSE_MS      20000UL   // hard cap on one pour
#define DRY_RUN_CUTOFF_PCT       5.0f  // stop pump below this
#define DRY_RUN_REENABLE_PCT     8.0f  // re-allow above this
#define BUZZER_HYST_PCT          5.0f  // clear alert at low_pct + 5

// ---------------- Sensors ----------------
#define ULTRASONIC_SAMPLES         5
#define FLOW_PULSES_PER_LITER   450.0f // YF-S201 spec
#define ULTRASONIC_TIMEOUT_US  30000UL
#define ULTRASONIC_SETTLE_US      60UL  // between samples

/* ============================================================
 *  SECTION 3 — Shared state
 * ============================================================ */

struct SystemState {
  // sensor values
  float    distance_in       = 0;
  float    level_pct         = 0;
  float    level_in          = 0;
  float    temp_c            = 25;
  float    flow_lpm          = 0;
  double   total_liters      = 0;
  bool     glass_present     = false;
  bool     sensors_valid     = false;

  // control outputs
  bool     pump_on           = false;
  bool     buzzer_on         = false;

  // setup mode
  bool     setup_mode            = false;
  unsigned long setup_started_ms = 0;
  String   setup_session_id      = "";
  float    setup_measured_in     = 0;

  // config (mirrored from NVS)
  float    tank_height_in    = 0;
  float    sensor_offset_in  = 0;
  float    low_level_pct     = 10;

  // network
  bool          wifi_connected        = false;
  unsigned long last_nvs_flush_ms     = 0;
  double        liters_at_last_flush  = 0;
};

static SystemState       gState;
static SemaphoreHandle_t gStateMutex;
static Preferences       prefs;
static LiquidCrystal_I2C lcd(0x27, 16, 2);   // change 0x27 if your LCD is 0x3F
static OneWire           oneWire(PIN_DS18B20);
static DallasTemperature ds18b20(&oneWire);

static volatile uint32_t gFlowPulses = 0;
static portMUX_TYPE      gFlowMux    = portMUX_INITIALIZER_UNLOCKED;

static inline void stateLock()   { xSemaphoreTake(gStateMutex, portMAX_DELAY); }
static inline void stateUnlock() { xSemaphoreGive(gStateMutex); }

/* ============================================================
 *  SECTION 4 — Flow sensor ISR
 * ============================================================ */

void IRAM_ATTR flowISR() {
  portENTER_CRITICAL_ISR(&gFlowMux);
  gFlowPulses++;
  portEXIT_CRITICAL_ISR(&gFlowMux);
}

/* ============================================================
 *  SECTION 5 — NVS helpers
 * ============================================================ */

static void nvsLoad() {
  prefs.begin("aquasense", false);
  stateLock();
  gState.tank_height_in        = prefs.getFloat ("tank_in",   0.0f);
  gState.sensor_offset_in      = prefs.getFloat ("offset_in", 0.0f);
  gState.low_level_pct         = prefs.getFloat ("low_pct",  10.0f);
  gState.total_liters          = prefs.getDouble("total_l",   0.0);
  gState.liters_at_last_flush  = gState.total_liters;
  gState.last_nvs_flush_ms     = millis();
  stateUnlock();

  Serial.printf("[NVS] tank=%.2f offset=%.2f low=%.1f total=%.3f\n",
    gState.tank_height_in, gState.sensor_offset_in,
    gState.low_level_pct,  gState.total_liters);
}

static void nvsSaveConfig() {
  stateLock();
  float tank   = gState.tank_height_in;
  float offset = gState.sensor_offset_in;
  float low    = gState.low_level_pct;
  stateUnlock();
  prefs.putFloat("tank_in",   tank);
  prefs.putFloat("offset_in", offset);
  prefs.putFloat("low_pct",   low);
}

static void nvsFlushIfNeeded(bool force = false) {
  stateLock();
  double current        = gState.total_liters;
  double last           = gState.liters_at_last_flush;
  unsigned long elapsed = millis() - gState.last_nvs_flush_ms;
  stateUnlock();

  bool due = force
          || elapsed >= NVS_FLUSH_MS
          || (current - last) >= NVS_FLUSH_LITERS;

  if (due) {
    prefs.putDouble("total_l", current);
    stateLock();
    gState.liters_at_last_flush = current;
    gState.last_nvs_flush_ms    = millis();
    stateUnlock();
    Serial.printf("[NVS] flushed total=%.3f L\n", current);
  }
}

/* ============================================================
 *  SECTION 6 — Sensor reads
 * ============================================================ */

static float readUltrasonicInches() {
  float samples[ULTRASONIC_SAMPLES];
  for (int i = 0; i < ULTRASONIC_SAMPLES; i++) {
    digitalWrite(PIN_ULTRASONIC_TRIG, LOW);
    delayMicroseconds(2);
    digitalWrite(PIN_ULTRASONIC_TRIG, HIGH);
    delayMicroseconds(10);
    digitalWrite(PIN_ULTRASONIC_TRIG, LOW);

    unsigned long dur = pulseIn(PIN_ULTRASONIC_ECHO, HIGH, ULTRASONIC_TIMEOUT_US);
    samples[i] = (dur == 0) ? -1.0f : (dur / 148.0f);  // µs -> inches
    delayMicroseconds(ULTRASONIC_SETTLE_US);
  }
  // median filter
  for (int i = 0; i < ULTRASONIC_SAMPLES - 1; i++)
    for (int j = i + 1; j < ULTRASONIC_SAMPLES; j++)
      if (samples[j] < samples[i]) {
        float t = samples[i]; samples[i] = samples[j]; samples[j] = t;
      }
  return samples[ULTRASONIC_SAMPLES / 2];
}

static float readTempC() {
  ds18b20.requestTemperatures();
  return ds18b20.getTempCByIndex(0);
}

static void computeLevel() {
  float tank   = gState.tank_height_in;
  float offset = gState.sensor_offset_in;
  float dist   = gState.distance_in;

  if (tank <= 0.5f || dist <= 0) {
    gState.level_pct = 0;
    gState.level_in  = 0;
    return;
  }
  float water = tank - (dist - offset);
  if (water < 0)    water = 0;
  if (water > tank) water = tank;
  gState.level_in  = water;
  gState.level_pct = (water / tank) * 100.0f;
}

/* ============================================================
 *  SECTION 7 — Supabase RPC helpers
 * ============================================================ */

/*  rpcCall:
 *    - returns the HTTP status code (int)
 *    - on 2xx, optionally writes the response body into *out
 *    - on failure, prints the response to Serial and returns the code
 *    - returns -1 if WiFi is down or begin() fails
 *
 *  Fix vs v1.0.0: PostgREST returns an EMPTY body for void-returning
 *  RPCs (ingest_reading, ack_command, ...). Success must be judged by
 *  the HTTP status code, not by the response length.
 */
static int rpcCall(const char* fn, JsonDocument& body, String* out = nullptr) {
  if (WiFi.status() != WL_CONNECTED) return -1;

  WiFiClientSecure client;
  client.setInsecure();   // TODO: pin the cert for production

  HTTPClient http;
  http.setTimeout(10000);
  String url = String(SUPABASE_URL) + "/rest/v1/rpc/" + fn;
  if (!http.begin(client, url)) return -1;

  http.addHeader("Content-Type",  "application/json");
  http.addHeader("apikey",        SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  String payload;
  serializeJson(body, payload);

  int code = http.POST(payload);

  if (code >= 200 && code < 300) {
    if (out) *out = http.getString();   // body may be empty for void RPCs
  } else {
    Serial.printf("[RPC %s] HTTP %d: %s\n", fn, code, http.getString().c_str());
  }
  http.end();
  return code;
}

/*  postReading: success = 2xx, regardless of body length. */
static bool postReading() {
  JsonDocument doc;
  stateLock();
  doc["p_device_id"]    = DEVICE_ID;
  doc["p_device_token"] = DEVICE_TOKEN;
  doc["p_level_pct"]    = gState.level_pct;
  doc["p_level_in"]     = gState.level_in;
  doc["p_temp_c"]       = gState.temp_c;
  doc["p_flow_lpm"]     = gState.flow_lpm;
  doc["p_total_liters"] = gState.total_liters;
  doc["p_firmware"]     = FIRMWARE_VERSION;
  stateUnlock();

  int code = rpcCall("ingest_reading", doc);
  return code >= 200 && code < 300;
}

static void ackCommand(long id, const char* status) {
  JsonDocument req;
  req["p_device_id"]    = DEVICE_ID;
  req["p_device_token"] = DEVICE_TOKEN;
  req["p_command_id"]   = id;
  req["p_status"]       = status;
  rpcCall("ack_command", req);   // void RPC, return discarded
}

static void fetchConfig() {
  JsonDocument req;
  req["p_device_id"]    = DEVICE_ID;
  req["p_device_token"] = DEVICE_TOKEN;

  String resp;
  int code = rpcCall("get_device_config", req, &resp);
  if (code < 200 || code >= 300 || resp.length() == 0) return;

  JsonDocument doc;
  if (deserializeJson(doc, resp)) return;

  JsonObject obj;
  if (doc.is<JsonArray>()) {
    if (doc.as<JsonArray>().size() == 0) return;
    obj = doc.as<JsonArray>()[0];
  } else {
    obj = doc.as<JsonObject>();
  }

  float tank   = obj["tank_height_in"]   | 0.0f;
  float offset = obj["sensor_offset_in"] | 0.0f;
  float lowPct = obj["low_level_pct"]    | 10.0f;

  stateLock();
  if (tank > 0) gState.tank_height_in = tank;
  gState.sensor_offset_in = offset;
  gState.low_level_pct    = lowPct;
  stateUnlock();

  nvsSaveConfig();
  Serial.printf("[CFG] tank=%.2f offset=%.2f low=%.1f\n", tank, offset, lowPct);
}

static void publishSetupReading(float height_in) {
  stateLock();
  String sid = gState.setup_session_id;
  stateUnlock();
  if (sid.length() == 0) return;

  JsonDocument req;
  req["p_device_id"]    = DEVICE_ID;
  req["p_device_token"] = DEVICE_TOKEN;
  req["p_setup_id"]     = sid;
  req["p_height_in"]    = height_in;
  rpcCall("publish_setup_reading", req);   // void RPC
}

static void handleCommand(long id, const char* name, JsonVariant payload) {
  Serial.printf("[CMD] id=%ld name=%s\n", id, name);

  if (strcmp(name, "reload_config") == 0) {
    fetchConfig();
    ackCommand(id, "done");

  } else if (strcmp(name, "enter_setup_mode") == 0) {
    const char* sid = payload.isNull() ? nullptr : payload["setup_id"];
    stateLock();
    gState.setup_mode        = true;
    gState.setup_started_ms  = millis();
    gState.setup_session_id  = sid ? sid : "";
    gState.setup_measured_in = 0;
    stateUnlock();
    ackCommand(id, "done");

  } else if (strcmp(name, "reset_counter") == 0) {
    stateLock();
    gState.total_liters         = 0.0;
    gState.liters_at_last_flush = 0.0;
    stateUnlock();
    prefs.putDouble("total_l", 0.0);
    ackCommand(id, "done");

    JsonDocument req;
    req["p_device_id"]    = DEVICE_ID;
    req["p_device_token"] = DEVICE_TOKEN;
    rpcCall("confirm_counter_reset", req);   // void RPC

  } else {
    ackCommand(id, "failed");
  }
}

static void pollCommands() {
  JsonDocument req;
  req["p_device_id"]    = DEVICE_ID;
  req["p_device_token"] = DEVICE_TOKEN;

  String resp;
  int code = rpcCall("fetch_pending_commands", req, &resp);
  if (code < 200 || code >= 300 || resp.length() == 0) return;

  JsonDocument doc;
  if (deserializeJson(doc, resp)) return;
  if (!doc.is<JsonArray>()) return;

  for (JsonObject cmd : doc.as<JsonArray>()) {
    long id = cmd["id"] | 0L;
    const char* name = cmd["command"] | "";
    handleCommand(id, name, cmd["payload"]);
  }
}

/* ============================================================
 *  SECTION 8 — Task: sensors (Core 1)
 * ============================================================ */

static void sensorTask(void*) {
  unsigned long lastUS     = 0;
  unsigned long lastTemp   = 0;
  unsigned long lastFlow   = 0;
  uint32_t      lastPulses = 0;

  while (true) {
    unsigned long now = millis();

    // Ultrasonic @ 10 Hz
    if (now - lastUS >= 100) {
      lastUS = now;
      float d = readUltrasonicInches();
      stateLock();
      if (d > 0) {
        gState.distance_in   = d;
        gState.sensors_valid = true;
      } else {
        gState.sensors_valid = false;
      }
      computeLevel();
      stateUnlock();
    }

    // IR glass @ 20 Hz
    stateLock();
    gState.glass_present = (digitalRead(PIN_IR_GLASS) == LOW);
    stateUnlock();

    // DS18B20 @ 0.5 Hz
    if (now - lastTemp >= 2000) {
      lastTemp = now;
      float t = readTempC();
      if (t > -50 && t < 100) {
        stateLock();
        gState.temp_c = t;
        stateUnlock();
      }
    }

    // Flow accumulation @ 1 Hz
    if (now - lastFlow >= 1000) {
      unsigned long dt = now - lastFlow;
      lastFlow = now;

      portENTER_CRITICAL(&gFlowMux);
      uint32_t pulses = gFlowPulses;
      portEXIT_CRITICAL(&gFlowMux);
      uint32_t delta = pulses - lastPulses;
      lastPulses = pulses;

      float liters = delta / FLOW_PULSES_PER_LITER;
      float lpm    = liters * (60000.0f / (float)dt);

      stateLock();
      gState.flow_lpm      = lpm;
      gState.total_liters += liters;
      stateUnlock();
    }

    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

/* ============================================================
 *  SECTION 9 — Task: pump / buzzer / setup timer (Core 1)
 * ============================================================ */

static void controlTask(void*) {
  enum PumpState { IDLE, DISPENSING };
  PumpState     pumpState     = IDLE;
  unsigned long glassSeenAt   = 0;
  unsigned long dispenseStart = 0;
  bool          dryRunLocked  = false;
  bool          alertActive   = false;

  while (true) {
    stateLock();
    bool          glass        = gState.glass_present;
    float         level        = gState.level_pct;
    float         lowPct       = gState.low_level_pct;
    bool          setup        = gState.setup_mode;
    unsigned long setupElapsed = millis() - gState.setup_started_ms;
    stateUnlock();

    // Setup mode timeout
    if (setup && setupElapsed >= SETUP_TIMEOUT_MS) {
      Serial.println("[SETUP] timeout — exiting");
      stateLock();
      gState.setup_mode       = false;
      gState.setup_session_id = "";
      stateUnlock();
      setup = false;
    }

    // Dry-run hysteresis
    if (!dryRunLocked && level < DRY_RUN_CUTOFF_PCT)   dryRunLocked = true;
    if ( dryRunLocked && level > DRY_RUN_REENABLE_PCT) dryRunLocked = false;

    // Low-water buzzer with hysteresis
    if (level < lowPct)                        alertActive = true;
    else if (level > lowPct + BUZZER_HYST_PCT) alertActive = false;

    // Pump FSM
    if (setup) {
      digitalWrite(PIN_RELAY, LOW);
      pumpState = IDLE;
    } else if (pumpState == IDLE) {
      if (glass && !dryRunLocked) {
        if (glassSeenAt == 0) glassSeenAt = millis();
        if (millis() - glassSeenAt >= GLASS_CONFIRM_MS) {
          digitalWrite(PIN_RELAY, HIGH);
          pumpState     = DISPENSING;
          dispenseStart = millis();
          Serial.println("[PUMP] on");
        }
      } else {
        glassSeenAt = 0;
      }
    } else {  // DISPENSING
      bool stop = !glass
               || (millis() - dispenseStart >= MAX_DISPENSE_MS)
               || dryRunLocked;
      if (stop) {
        digitalWrite(PIN_RELAY, LOW);
        pumpState   = IDLE;
        glassSeenAt = 0;
        Serial.println("[PUMP] off");
      }
    }

    digitalWrite(PIN_BUZZER, alertActive ? HIGH : LOW);

    stateLock();
    gState.pump_on   = (pumpState == DISPENSING);
    gState.buzzer_on = alertActive;
    stateUnlock();

    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

/* ============================================================
 *  SECTION 10 — Task: LCD (Core 1)
 * ============================================================ */

static void displayTask(void*) {
  unsigned long last = 0;
  int           page = 0;

  while (true) {
    if (millis() - last >= 500) {
      last = millis();

      stateLock();
      bool          setup        = gState.setup_mode;
      float         tank         = gState.tank_height_in;
      float         measured     = gState.setup_measured_in;
      unsigned long setupElapsed = millis() - gState.setup_started_ms;
      float         level        = gState.level_pct;
      float         levelIn      = gState.level_in;
      float         temp         = gState.temp_c;
      double        total        = gState.total_liters;
      bool          wifi         = gState.wifi_connected;
      stateUnlock();

      lcd.clear();
      lcd.setCursor(0, 0);

      if (setup) {
        long remain = (SETUP_TIMEOUT_MS - setupElapsed) / 1000;
        if (remain < 0) remain = 0;
        lcd.printf("TANK: %.1f in", measured);
        lcd.setCursor(0, 1);
        lcd.printf("SETUP %lds", remain);
      } else if (tank <= 0.5f) {
        lcd.print("TANK: -- in");
        lcd.setCursor(0, 1);
        lcd.print("SETUP VIA APP");
      } else {
        switch (page % 3) {
          case 0:
            lcd.printf("Level: %3.0f%%", level);
            lcd.setCursor(0, 1);
            lcd.printf("%.1f / %.1f in", levelIn, tank);
            break;
          case 1:
            lcd.printf("Temp: %.1f C", temp);
            lcd.setCursor(0, 1);
            lcd.printf("WiFi: %s", wifi ? "OK" : "DOWN");
            break;
          case 2:
            lcd.print("Usage:");
            lcd.setCursor(0, 1);
            lcd.printf("%.2f L", total);
            break;
        }
        page++;
      }
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

/* ============================================================
 *  SECTION 11 — Task: network (Core 0)
 * ============================================================ */

static void networkTask(void*) {
  unsigned long lastRead     = 0;
  unsigned long lastPoll     = 0;
  unsigned long lastSetupPub = 0;
  unsigned long lastWifiTry  = 0;
  unsigned long wifiBackoff  = WIFI_RETRY_MIN_MS;

  while (true) {
    unsigned long now = millis();

    if (WiFi.status() != WL_CONNECTED) {
      stateLock();
      gState.wifi_connected = false;
      stateUnlock();

      if (now - lastWifiTry >= wifiBackoff) {
        lastWifiTry = now;
        Serial.printf("[WiFi] reconnect (backoff %lu ms)\n", wifiBackoff);
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        wifiBackoff = min(wifiBackoff * 2, (unsigned long)WIFI_RETRY_MAX_MS);
      }
    } else {
      wifiBackoff = WIFI_RETRY_MIN_MS;
      stateLock();
      gState.wifi_connected = true;
      stateUnlock();

      // POST reading every 15 s
      if (now - lastRead >= READING_INTERVAL_MS) {
        lastRead = now;
        bool ok = postReading();
        if (!ok) Serial.println("[POST] reading failed");
      }

      // Poll commands every 5 s
      if (now - lastPoll >= COMMAND_POLL_MS) {
        lastPoll = now;
        pollCommands();
      }

      // Publish setup reading every 2 s (while in setup mode)
      stateLock();
      bool  setup   = gState.setup_mode;
      float rawDist = gState.distance_in;
      float offset  = gState.sensor_offset_in;
      stateUnlock();

      if (setup && now - lastSetupPub >= SETUP_PUBLISH_MS) {
        lastSetupPub = now;
        float h = rawDist - offset;
        if (h < 0) h = 0;
        stateLock();
        gState.setup_measured_in = h;
        stateUnlock();
        publishSetupReading(h);
      }
    }

    // NVS batch flush
    nvsFlushIfNeeded(false);

    vTaskDelay(pdMS_TO_TICKS(200));
  }
}

/* ============================================================
 *  SECTION 12 — setup() / loop()
 * ============================================================ */

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[AquaSense] booting...");

  // Outputs first — safe state
  pinMode(PIN_RELAY,  OUTPUT); digitalWrite(PIN_RELAY,  LOW);
  pinMode(PIN_BUZZER, OUTPUT); digitalWrite(PIN_BUZZER, LOW);

  pinMode(PIN_ULTRASONIC_TRIG, OUTPUT);
  pinMode(PIN_ULTRASONIC_ECHO, INPUT);
  pinMode(PIN_IR_GLASS,        INPUT_PULLUP);
  pinMode(PIN_FLOW,            INPUT_PULLUP);

  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), flowISR, RISING);

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0); lcd.print("AquaSense v" FIRMWARE_VERSION);
  lcd.setCursor(0, 1); lcd.print("booting...");

  gStateMutex = xSemaphoreCreateMutex();

  ds18b20.begin();
  nvsLoad();

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // Tasks — Core 0: network only; Core 1: everything real-time
  xTaskCreatePinnedToCore(networkTask, "net",  8192, nullptr, 2, nullptr, 0);
  xTaskCreatePinnedToCore(sensorTask,  "sens", 4096, nullptr, 3, nullptr, 1);
  xTaskCreatePinnedToCore(controlTask, "ctrl", 4096, nullptr, 4, nullptr, 1);
  xTaskCreatePinnedToCore(displayTask, "disp", 4096, nullptr, 1, nullptr, 1);

  Serial.println("[AquaSense] ready");
}

void loop() {
  // All work lives in tasks. Keep the Arduino loop idle.
  vTaskDelay(pdMS_TO_TICKS(1000));
}