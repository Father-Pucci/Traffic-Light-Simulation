/**
 * traffic_esp32.ino — TrafficOS ESP32 Firmware
 *
 * Reads the Firestore document Traffic_led/control every 400 ms
 * and drives 12 GPIO pins (3 traffic lights + 3 crosswalk LEDs).
 *
 * PIN MAP (matches dashboard wiring diagram):
 *   D13 = Red    Left        D12 = Yellow Left       D14 = Green Left
 *   D25 = Red    Middle      D26 = Yellow Middle      D27 = Green Middle
 *   D32 = Red    Right       D33 = Yellow Right       D4  = Green Right
 *   D22 = Blue   Walk Left   D21 = Blue  Walk Mid     D23 = Blue Walk Right
 *
 * IMPORTANT — Firestore REST API quirk:
 *   integerValue is returned as a JSON STRING, not a number.
 *   e.g.  "d14": { "integerValue": "1" }   ← value is the string "1"
 *   So we compare with String(field["integerValue"]) == "1", NOT == 1.
 *   This was the reason your LEDs were not responding before.
 *
 * Required library: ArduinoJson by Benoit Blanchon
 *   Install via Arduino IDE → Sketch → Library Manager → search "ArduinoJson"
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ─── WiFi credentials ────────────────────────────────────────────────────────
const char* WIFI_SSID = "Lag kayo";
const char* WIFI_PASS = "Encrypted_password@2000";

// ─── Firestore REST endpoint ─────────────────────────────────────────────────
const char* FIRESTORE_URL =
    "https://firestore.googleapis.com/v1/projects/traffic-simulation-b4fc7"
    "/databases/(default)/documents/Traffic_led/control";

// ─── Poll interval (ms) ──────────────────────────────────────────────────────
const unsigned long POLL_MS = 300;

// ─── GPIO pin definitions ────────────────────────────────────────────────────
// LEFT road traffic light
#define PIN_LEFT_RED    13
#define PIN_LEFT_YELLOW 12
#define PIN_LEFT_GREEN  14

// MIDDLE road traffic light
#define PIN_MID_RED     25
#define PIN_MID_YELLOW  26
#define PIN_MID_GREEN   27

// RIGHT road traffic light
#define PIN_RIGHT_RED    32
#define PIN_RIGHT_YELLOW 33
#define PIN_RIGHT_GREEN   4

// Crosswalk blue LEDs
#define PIN_WALK_LEFT  22   // D22 — left side of horizontal road
#define PIN_WALK_MID   21   // D21 — vertical road (middle junction)
#define PIN_WALK_RIGHT 23   // D23 — right side of horizontal road

// ─── All pins in one array for bulk operations ───────────────────────────────
const int ALL_PINS[] = {
    PIN_LEFT_RED, PIN_LEFT_YELLOW, PIN_LEFT_GREEN,
    PIN_MID_RED,  PIN_MID_YELLOW,  PIN_MID_GREEN,
    PIN_RIGHT_RED, PIN_RIGHT_YELLOW, PIN_RIGHT_GREEN,
    PIN_WALK_LEFT, PIN_WALK_MID, PIN_WALK_RIGHT
};
const int PIN_COUNT = sizeof(ALL_PINS) / sizeof(ALL_PINS[0]);

// ─── State tracking ──────────────────────────────────────────────────────────
String lastPhase = "";

// ════════════════════════════════════════════════════════════════════════════
// SETUP
// ════════════════════════════════════════════════════════════════════════════
void setup() {
    Serial.begin(115200);
    delay(200);
    Serial.println("\n=== TrafficOS ESP32 Firmware ===");

    // Configure all pins as OUTPUT and start LOW
    for (int i = 0; i < PIN_COUNT; i++) {
        pinMode(ALL_PINS[i], OUTPUT);
        digitalWrite(ALL_PINS[i], LOW);
    }

    // Startup blink — flash all LEDs once to confirm wiring
    Serial.println("Startup: flashing all LEDs...");
    for (int i = 0; i < PIN_COUNT; i++) digitalWrite(ALL_PINS[i], HIGH);
    delay(600);
    for (int i = 0; i < PIN_COUNT; i++) digitalWrite(ALL_PINS[i], LOW);
    delay(300);

    // Safe default: all traffic RED, crosswalks OFF
    digitalWrite(PIN_LEFT_RED,   HIGH);
    digitalWrite(PIN_MID_RED,    HIGH);
    digitalWrite(PIN_RIGHT_RED,  HIGH);

    // Connect to WiFi
    Serial.printf("Connecting to WiFi: %s\n", WIFI_SSID);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print('.');
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\nConnected! IP: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\nWiFi failed — will retry in loop.");
    }
}

// ════════════════════════════════════════════════════════════════════════════
// LOOP
// ════════════════════════════════════════════════════════════════════════════
void loop() {
    // Reconnect if WiFi dropped
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi disconnected — reconnecting...");
        WiFi.reconnect();
        delay(3000);
        return;
    }

    // Fetch Firestore document
    HTTPClient http;
    http.begin(FIRESTORE_URL);
    http.setTimeout(4000);
    int httpCode = http.GET();

    if (httpCode == HTTP_CODE_OK) {
        String payload = http.getString();
        parseAndApply(payload);
    } else {
        Serial.printf("HTTP error: %d\n", httpCode);
    }

    http.end();
    delay(POLL_MS);
}

// ════════════════════════════════════════════════════════════════════════════
// PARSE FIRESTORE RESPONSE AND DRIVE LEDS
//
// Firestore REST response shape:
// {
//   "fields": {
//     "phase": { "stringValue": "left_green" },
//     "d13":  { "integerValue": "0" },   ← NOTE: string "0", not integer 0
//     "d14":  { "integerValue": "1" },
//     ...
//   }
// }
//
// We read each pin field and compare its integerValue STRING to "1".
// ════════════════════════════════════════════════════════════════════════════
void parseAndApply(const String& payload) {
    // Use a generous document size — Firestore responses can be verbose
    StaticJsonDocument<3072> doc;
    DeserializationError err = deserializeJson(doc, payload);

    if (err) {
        Serial.printf("JSON parse error: %s\n", err.c_str());
        return;
    }

    JsonObject fields = doc["fields"];
    if (fields.isNull()) {
        Serial.println("No 'fields' key in Firestore response.");
        return;
    }

    // ── Phase name (for logging) ──────────────────────────────
    String phase = "unknown";
    if (fields.containsKey("phase")) {
        phase = fields["phase"]["stringValue"].as<String>();
    }
    if (phase != lastPhase) {
        Serial.printf("Phase: %s → %s\n", lastPhase.c_str(), phase.c_str());
        lastPhase = phase;
    }

    // ── Read a pin from Firestore fields ──────────────────────
    // CRITICAL: integerValue is a STRING in the REST API response.
    // We must compare the string value to "1", NOT cast to int.
    auto readPin = [&](const char* key) -> bool {
        if (!fields.containsKey(key)) return false;
        JsonObject field = fields[key];

        if (field.containsKey("integerValue")) {
            // integerValue comes as a JSON string: "0" or "1"
            String val = field["integerValue"].as<String>();
            return val == "1";
        }
        if (field.containsKey("booleanValue")) {
            return field["booleanValue"].as<bool>();
        }
        return false;
    };

    // ── Apply all 12 pins ────────────────────────────────────
    digitalWrite(PIN_LEFT_RED,     readPin("d13") ? HIGH : LOW);
    digitalWrite(PIN_LEFT_YELLOW,  readPin("d12") ? HIGH : LOW);
    digitalWrite(PIN_LEFT_GREEN,   readPin("d14") ? HIGH : LOW);

    digitalWrite(PIN_MID_RED,      readPin("d25") ? HIGH : LOW);
    digitalWrite(PIN_MID_YELLOW,   readPin("d26") ? HIGH : LOW);
    digitalWrite(PIN_MID_GREEN,    readPin("d27") ? HIGH : LOW);

    digitalWrite(PIN_RIGHT_RED,    readPin("d32") ? HIGH : LOW);
    digitalWrite(PIN_RIGHT_YELLOW, readPin("d33") ? HIGH : LOW);
    digitalWrite(PIN_RIGHT_GREEN,  readPin("d4")  ? HIGH : LOW);

    digitalWrite(PIN_WALK_LEFT,    readPin("d22") ? HIGH : LOW);
    digitalWrite(PIN_WALK_MID,     readPin("d21") ? HIGH : LOW);
    digitalWrite(PIN_WALK_RIGHT,   readPin("d23") ? HIGH : LOW);

    // ── Debug serial output ──────────────────────────────────
    Serial.printf(
        "[%s] L:%d%d%d | M:%d%d%d | R:%d%d%d | WALK:%d%d%d\n",
        phase.c_str(),
        readPin("d13"), readPin("d12"), readPin("d14"),   // Left  R/Y/G
        readPin("d25"), readPin("d26"), readPin("d27"),   // Mid   R/Y/G
        readPin("d32"), readPin("d33"), readPin("d4"),    // Right R/Y/G
        readPin("d22"), readPin("d21"), readPin("d23")    // Walk  L/M/R
    );
}
