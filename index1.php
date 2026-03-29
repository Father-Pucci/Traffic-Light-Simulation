<?php
/**
 * index.php — TrafficOS T-Junction Dashboard (HTML shell only)
 *
 * All PHP logic  → api.php
 * All JS logic   → sim.js
 * All CSS styles → style.css
 *
 * This file is pure HTML + form structure.
 * No PHP business logic lives here.
 */
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TrafficOS — T-Junction v6</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>

<!-- ═══════════════════════════════════════════════════════ HEADER -->
<header>
  <div class="logo">
    TRAFFIC<span class="acc">OS</span>
    <span class="dim">// T-JUNCTION v6.0</span>
  </div>
  <div class="status-bar">
    <div class="status-dot" id="simStatusDot"
         style="background:var(--red);box-shadow:0 0 8px var(--red)"></div>
    <span id="simStatusText">STOPPED</span>
    <div class="fb-status">
      <div class="fb-dot" id="fbDot"></div>
      <span id="fbText">FIREBASE IDLE</span>
    </div>
    <div class="time-display" id="clockDisplay">00:00:00</div>
  </div>
</header>

<!-- ═══════════════════════════════════════════════ MAIN 3-COLUMN -->
<div class="main-layout">

  <!-- ══════════════════════════════════════════ LEFT PANEL -->
  <div class="side-panel">

    <div class="panel-title">⬡ SIMULATION CONTROL</div>
    <div class="btn-group">
      <button class="btn btn-start"     onclick="startSim()">▶ START SIMULATION</button>
      <button class="btn btn-stop"      onclick="stopSim()">■ STOP SIMULATION</button>
      <button class="btn btn-emergency" id="emergBtn" onclick="toggleEmergency()">
        ⚠ EMERGENCY STOP
      </button>
    </div>

    <div class="divider"></div>
    <div class="panel-title">⬡ PHASE TIMING</div>
    <div class="seq-editor">
      <div class="seq-row"><label>Left Green</label>
        <input type="number" id="t_left_green"   value="10" min="3" max="60"><span>s</span></div>
      <div class="seq-row"><label>Left Yellow</label>
        <input type="number" id="t_left_yellow"  value="3"  min="1" max="10"><span>s</span></div>
      <div class="seq-row"><label>Left Walk</label>
        <input type="number" id="t_left_walk"    value="15" min="5" max="30"><span>s</span></div>

      <div class="seq-row"><label>Mid Green</label>
        <input type="number" id="t_mid_green"    value="10" min="3" max="60"><span>s</span></div>
      <div class="seq-row"><label>Mid Yellow</label>
        <input type="number" id="t_mid_yellow"   value="3"  min="1" max="10"><span>s</span></div>
      <div class="seq-row"><label>Mid Walk</label>
        <input type="number" id="t_mid_walk"     value="15" min="5" max="30"><span>s</span></div>

      <div class="seq-row"><label>Right Green</label>
        <input type="number" id="t_right_green"  value="10" min="3" max="60"><span>s</span></div>
      <div class="seq-row"><label>Right Yellow</label>
        <input type="number" id="t_right_yellow" value="3"  min="1" max="10"><span>s</span></div>
      <div class="seq-row"><label>Right Walk</label>
        <input type="number" id="t_right_walk"   value="15" min="5" max="30"><span>s</span></div>
    </div>

    <div class="divider"></div>
    <div class="panel-title">⬡ SPEED</div>
    <div class="slider-wrap">
      <div class="slider-label">
        <span>Speed</span><span id="speedVal">1.0x</span>
      </div>
      <input type="range" id="simSpeed" min="0.5" max="4" value="1" step="0.5"
             oninput="updateSpeed(this.value)">
    </div>

    <div class="divider"></div>
    <div class="panel-title">⬡ STATS</div>
    <div class="stat-grid">
      <div class="stat-box">
        <div class="stat-val" id="statCycles">0</div>
        <div class="stat-lbl">CYCLES</div>
      </div>
      <div class="stat-box">
        <div class="stat-val" id="statCars">0</div>
        <div class="stat-lbl">CARS PASSED</div>
      </div>
      <div class="stat-box">
        <div class="stat-val" id="statPhase">—</div>
        <div class="stat-lbl">PHASE</div>
      </div>
      <div class="stat-box">
        <div class="stat-val" id="statTime">0s</div>
        <div class="stat-lbl">UPTIME</div>
      </div>
    </div>

    <!-- Walk countdown (visible only during crosswalk phases) -->
    <div class="walk-badge" id="walkBadge" style="display:none">
      🚶 CROSSWALK ACTIVE<br>
      <span id="walkCountdown">15s</span>
    </div>

  </div><!-- /left panel -->

  <!-- ══════════════════════════════════════════ CENTRE (CANVAS) -->
  <div class="sim-area">
    <div class="sim-title">// 4-LANE T-JUNCTION — PHYSICS SIM v6 //</div>

    <div class="phase-strip">
      <div class="phase-chip ax" id="chip_left">LEFT: RED</div>
      <div class="phase-chip ax" id="chip_mid">MID: RED</div>
      <div class="phase-chip ax" id="chip_right">RIGHT: RED</div>
      <div class="phase-chip ax" id="chip_walk">CROSSWALK: OFF</div>
    </div>

    <canvas id="sim" width="720" height="600"></canvas>
  </div>

  <!-- ══════════════════════════════════════════ RIGHT PANEL -->
  <div class="side-panel right">

    <div class="panel-title">⬡ TRAFFIC LIGHTS</div>

    <!-- LEFT road -->
    <div class="tl-widget">
      <div class="tl-label">🔴 LEFT ROAD — D13 / D12 / D14</div>
      <div class="tl-lights">
        <div class="tl-bulb r" id="tl_left_r"></div>
        <div class="tl-bulb y" id="tl_left_y"></div>
        <div class="tl-bulb g" id="tl_left_g"></div>
      </div>
      <div class="tl-phase-text" id="tl_left_txt">● RED</div>
      <div class="phase-bar">
        <div class="phase-bar-fill" id="tl_left_bar" style="width:0%"></div>
      </div>
    </div>

    <!-- MIDDLE road -->
    <div class="tl-widget">
      <div class="tl-label">🟡 MIDDLE ROAD — D27 / D26 / D25</div>
      <div class="tl-lights">
        <div class="tl-bulb g" id="tl_mid_g"></div>
        <div class="tl-bulb y" id="tl_mid_y"></div>
        <div class="tl-bulb r" id="tl_mid_r"></div>
      </div>
      <div class="tl-phase-text" id="tl_mid_txt">● RED</div>
      <div class="phase-bar">
        <div class="phase-bar-fill" id="tl_mid_bar"
             style="width:0%;background:var(--green)"></div>
      </div>
    </div>

    <!-- RIGHT road -->
    <div class="tl-widget">
      <div class="tl-label">🔵 RIGHT ROAD — D4 / D33 / D32</div>
      <div class="tl-lights">
        <div class="tl-bulb g" id="tl_right_g"></div>
        <div class="tl-bulb y" id="tl_right_y"></div>
        <div class="tl-bulb r" id="tl_right_r"></div>
      </div>
      <div class="tl-phase-text" id="tl_right_txt">● RED</div>
      <div class="phase-bar">
        <div class="phase-bar-fill" id="tl_right_bar"
             style="width:0%;background:var(--blue)"></div>
      </div>
    </div>

    <!-- Crosswalk blues -->
    <div class="tl-widget">
      <div class="tl-label">🚶 CROSSWALK — D22 / D21 / D23</div>
      <div class="tl-lights">
        <div class="tl-bulb b" id="tl_cw_l"></div>
        <div class="tl-bulb b" id="tl_cw_m"></div>
        <div class="tl-bulb b" id="tl_cw_r"></div>
      </div>
      <div class="tl-phase-text">LEFT &nbsp;|&nbsp; MID &nbsp;|&nbsp; RIGHT</div>
    </div>

    <div class="divider"></div>
    <div class="panel-title">⬡ MANUAL PIN OVERRIDE</div>
    <p class="pin-warn">⚠ Overrides the auto sequence</p>

    <!--
      Pin layout matches your wiring diagram:
        d13=Red-L   d12=Yel-L   d14=Grn-L
        d27=Grn-M   d26=Yel-M   d25=Red-M
        d4=Grn-R    d33=Yel-R   d32=Red-R
        d22=Walk-L  d21=Walk-M  d23=Walk-R
    -->
    <div class="pin-grid">
      <button class="pin-btn tooltip" id="pin_d13"
              onclick="togglePin('d13')" data-tip="Red Left (D13)">D13 RED-L</button>
      <button class="pin-btn tooltip" id="pin_d12"
              onclick="togglePin('d12')" data-tip="Yellow Left (D12)">D12 YEL-L</button>
      <button class="pin-btn tooltip" id="pin_d14"
              onclick="togglePin('d14')" data-tip="Green Left (D14)">D14 GRN-L</button>

      <button class="pin-btn tooltip" id="pin_d27"
              onclick="togglePin('d27')" data-tip="Green Middle (D27)">D27 GRN-M</button>
      <button class="pin-btn tooltip" id="pin_d26"
              onclick="togglePin('d26')" data-tip="Yellow Middle (D26)">D26 YEL-M</button>
      <button class="pin-btn tooltip" id="pin_d25"
              onclick="togglePin('d25')" data-tip="Red Middle (D25)">D25 RED-M</button>

      <button class="pin-btn tooltip" id="pin_d4"
              onclick="togglePin('d4')"  data-tip="Green Right (D4)">D4 GRN-R</button>
      <button class="pin-btn tooltip" id="pin_d33"
              onclick="togglePin('d33')" data-tip="Yellow Right (D33)">D33 YEL-R</button>
      <button class="pin-btn tooltip" id="pin_d32"
              onclick="togglePin('d32')" data-tip="Red Right (D32)">D32 RED-R</button>

      <button class="pin-btn tooltip" id="pin_d22"
              onclick="togglePin('d22')" data-tip="Walk Left (D22)">D22 WALK-L</button>
      <button class="pin-btn tooltip" id="pin_d21"
              onclick="togglePin('d21')" data-tip="Walk Mid (D21)">D21 WALK-M</button>
      <button class="pin-btn tooltip" id="pin_d23"
              onclick="togglePin('d23')" data-tip="Walk Right (D23)">D23 WALK-R</button>
    </div>

    <div class="divider"></div>
    <div class="panel-title">⬡ PHASE LOG</div>
    <div class="phase-log-box" id="phaseLogBox">
      <div class="log-entry">
        <span class="log-time">00:00:00</span>
        <span> System Ready</span>
      </div>
    </div>

  </div><!-- /right panel -->

</div><!-- /main-layout -->

<!-- sim.js loaded last so the DOM is ready -->
<script src="sim.js"></script>
</body>
</html>
