#🚦 Traffic Light Simulation (T-Junction) with ESP32 + Firebase

##A web-based traffic light simulation system integrated with ESP32 hardware using Firebase Firestore as the real-time bridge.

##This project simulates a T-junction traffic system where a browser-based frontend controls actual LED traffic lights connected to an ESP32.

#📌 Project Overview

This system consists of three main components:

🌐 Frontend (PHP + JS + CSS)
A web interface that simulates traffic light behavior and sends updates.
☁️ Firebase Firestore
Acts as a real-time database to store traffic states.
⚡ ESP32 Microcontroller
Fetches data from Firebase and controls physical LEDs accordingly.
🧠 How It Works
The web app updates traffic light states in Firebase.

Firebase stores the state in:

Collection: Traffic_led  
Document: control
The ESP32 continuously polls Firebase.
LED outputs change based on Firestore values (binary: 0 or 1).
🔌 Hardware Setup (ESP32 Pin Mapping)
🚗 Traffic Lights

LEFT ROAD

D13 → 🔴 Red
D12 → 🟡 Yellow
D14 → 🟢 Green

MIDDLE ROAD

D27 → 🟢 Green
D26 → 🟡 Yellow
D25 → 🔴 Red

RIGHT ROAD

D4 → 🟢 Green
D33 → 🟡 Yellow
D32 → 🔴 Red
🚶 Crosswalk Signals
D22 → 🔵 Left side pedestrian
D21 → 🔵 Middle (intersection crossing)
D23 → 🔵 Right side pedestrian
🗂️ Project Structure
/htdocs/firebase/
│── api/            # Backend API (PHP)
│── php/            # PHP scripts
│── index.php       # Main UI
│── Sim.js          # Simulation logic (frontend)
│── style.css       # Styling
🔥 Firebase Setup
Project Name: Traffic Simulation
Collection: Traffic_led
Document: control
Example Firestore Fields
{
  "phase": "left_green",
  "d13": 0,
  "d12": 0,
  "d14": 1
}

Each pin uses:

1 → ON
0 → OFF
⚙️ ESP32 Features
📡 Connects to WiFi
🔄 Polls Firebase every 400ms
🧠 Parses JSON using ArduinoJson
🚨 Fallback safety: All RED state
💡 Startup LED test (all lights blink)
🧾 Key Arduino Libraries
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
▶️ How to Run
1. Setup XAMPP

Place project inside:

xampp/htdocs/firebase/
Start Apache
2. Configure Firebase
Create Firestore database

Add:

Traffic_led/control
Insert fields for each LED pin
3. Upload Code to ESP32

Update WiFi credentials:

const char* ssid = "YOUR_WIFI";
const char* password = "YOUR_PASSWORD";
Upload using Arduino IDE
4. Run the Simulation

Open browser:

http://localhost/firebase/index.php
Control traffic lights in real time 🚦
🛡️ Safety Logic

If connection fails:

All traffic lights default to RED
Prevents unsafe traffic conditions
🚀 Features
✅ Real-time cloud-controlled LEDs
✅ T-junction traffic logic simulation
✅ Crosswalk signal integration
✅ Web-to-hardware synchronization
✅ Modular and scalable system
📸 Future Improvements
Add timers & countdown UI
Implement AI-based traffic control
Use WebSockets instead of polling
Mobile app integration 📱
👨‍💻 Author

Mark
Student Developer | IoT & Web Systems
