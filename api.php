<?php
/**
 * api.php — TrafficOS Firebase Firestore sync
 *
 * PIN MAP (matches your ESP32 wiring exactly):
 *   d13 = Red    Left         d12 = Yellow Left        d14 = Green Left
 *   d25 = Red    Middle       d26 = Yellow Middle       d27 = Green Middle
 *   d32 = Red    Right        d33 = Yellow Right        d4  = Green Right
 *   d22 = Blue   Walk Left    d23 = Blue   Walk Right   d21 = Blue  Walk Mid
 *
 * NOTE on Firestore REST + ESP32:
 *   Firestore REST returns integerValue as a STRING, e.g. "integerValue":"1"
 *   Your ESP32 ArduinoJson code must compare with String(), not int.
 *   This file sends every pin as integerValue so the ESP32 can read them.
 */

$projectId  = 'traffic-simulation-b4fc7';
$collection = 'Traffic_led';
$docId      = 'control';

// ─── Firestore REST PATCH ────────────────────────────────────────────────────
function firestorePatch(string $pid, string $col, string $doc, array $fields): bool
{
    $url = "https://firestore.googleapis.com/v1/projects/{$pid}/databases/(default)/documents/{$col}/{$doc}";
    $ch  = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST  => 'PATCH',
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => json_encode(['fields' => $fields]),
        CURLOPT_TIMEOUT        => 8,
    ]);
    $result = curl_exec($ch);
    $err    = curl_errno($ch);
    curl_close($ch);
    return !$err && $result !== false;
}

// ─── Helper: build Firestore field map from a pin-state array ────────────────
// Every pin is sent as integerValue (0 or 1).
// The phase string is also stored so the ESP32 can log it.
function buildFields(string $phase, array $pins): array
{
    $fields = ['phase' => ['stringValue' => $phase]];
    foreach ($pins as $pin => $val) {
        // Force string keys — PHP may coerce numeric-ish keys like 'd4'
        $fields[(string)$pin] = ['integerValue' => (int)$val];
    }
    return $fields;
}

// ─── Phase → pin state map ───────────────────────────────────────────────────
// ALL 12 pins set explicitly on every phase change.
// This prevents the ESP32 from ever seeing a partial / stale state.
//
// Grouped as:  [LEFT R/Y/G]  [MID R/Y/G]  [RIGHT R/Y/G]  [WALK L/M/R]
//              d13 d12 d14    d25 d26 d27    d32 d33  d4    d22 d21 d23
const PHASES = [
    'left_green'    => ['d13'=>0,'d12'=>0,'d14'=>1,  'd25'=>1,'d26'=>0,'d27'=>0,  'd32'=>1,'d33'=>0,'d4'=>0,  'd22'=>0,'d21'=>0,'d23'=>0],
    'left_yellow'   => ['d13'=>0,'d12'=>1,'d14'=>0,  'd25'=>1,'d26'=>0,'d27'=>0,  'd32'=>1,'d33'=>0,'d4'=>0,  'd22'=>0,'d21'=>0,'d23'=>0],
    'left_walk'     => ['d13'=>1,'d12'=>0,'d14'=>0,  'd25'=>1,'d26'=>0,'d27'=>0,  'd32'=>1,'d33'=>0,'d4'=>0,  'd22'=>1,'d21'=>0,'d23'=>0],

    'middle_green'  => ['d13'=>1,'d12'=>0,'d14'=>0,  'd25'=>0,'d26'=>0,'d27'=>1,  'd32'=>1,'d33'=>0,'d4'=>0,  'd22'=>0,'d21'=>0,'d23'=>0],
    'middle_yellow' => ['d13'=>1,'d12'=>0,'d14'=>0,  'd25'=>0,'d26'=>1,'d27'=>0,  'd32'=>1,'d33'=>0,'d4'=>0,  'd22'=>0,'d21'=>0,'d23'=>0],
    'mid_walk'      => ['d13'=>1,'d12'=>0,'d14'=>0,  'd25'=>1,'d26'=>0,'d27'=>0,  'd32'=>1,'d33'=>0,'d4'=>0,  'd22'=>0,'d21'=>1,'d23'=>0],

    'right_green'   => ['d13'=>1,'d12'=>0,'d14'=>0,  'd25'=>1,'d26'=>0,'d27'=>0,  'd32'=>0,'d33'=>0,'d4'=>1,  'd22'=>0,'d21'=>0,'d23'=>0],
    'right_yellow'  => ['d13'=>1,'d12'=>0,'d14'=>0,  'd25'=>1,'d26'=>0,'d27'=>0,  'd32'=>0,'d33'=>1,'d4'=>0,  'd22'=>0,'d21'=>0,'d23'=>0],
    'right_walk'    => ['d13'=>1,'d12'=>0,'d14'=>0,  'd25'=>1,'d26'=>0,'d27'=>0,  'd32'=>1,'d33'=>0,'d4'=>0,  'd22'=>0,'d21'=>0,'d23'=>1],

    'all_red'       => ['d13'=>1,'d12'=>0,'d14'=>0,  'd25'=>1,'d26'=>0,'d27'=>0,  'd32'=>1,'d33'=>0,'d4'=>0,  'd22'=>0,'d21'=>0,'d23'=>0],
    'emergency'     => ['d13'=>1,'d12'=>0,'d14'=>0,  'd25'=>1,'d26'=>0,'d27'=>0,  'd32'=>1,'d33'=>0,'d4'=>0,  'd22'=>0,'d21'=>0,'d23'=>0],
];

// ─── Route POST actions ──────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    header('Content-Type: application/json');

    switch ($_POST['action'] ?? '') {

        // Apply a named traffic phase (green / yellow / walk / all_red …)
        case 'update_lights': {
            $phase  = $_POST['phase'] ?? 'all_red';
            $pins   = PHASES[$phase]  ?? PHASES['all_red'];
            $fields = buildFields($phase, $pins);
            $ok     = firestorePatch($projectId, $collection, $docId, $fields);
            echo json_encode(['success' => $ok, 'phase' => $phase, 'state' => $pins]);
            break;
        }

        // Toggle a single GPIO pin from the manual override panel
        case 'manual_pin': {
            $pin = (string)($_POST['pin'] ?? '');
            $val = (int)($_POST['value'] ?? 0);
            if ($pin === '') { echo json_encode(['success' => false, 'error' => 'missing pin']); break; }
            $fields = buildFields('manual', [$pin => $val]);
            $ok     = firestorePatch($projectId, $collection, $docId, $fields);
            echo json_encode(['success' => $ok, 'pin' => $pin, 'value' => $val]);
            break;
        }

        // Emergency: all traffic red, all crosswalks off immediately
        case 'emergency': {
            $pins   = PHASES['emergency'];
            $fields = buildFields('emergency', $pins);
            $ok     = firestorePatch($projectId, $collection, $docId, $fields);
            echo json_encode(['success' => $ok]);
            break;
        }

        default:
            echo json_encode(['success' => false, 'error' => 'unknown action']);
    }
    exit;
}

// Direct browser GET — redirect to dashboard
header('Location: index.php');
exit;
