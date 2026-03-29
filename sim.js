/**
 * sim.js — TrafficOS T-Junction Simulation Engine v6
 *
 * FIXES in this version:
 *  1. Crosswalks are CLOSE to the intersection (CW_MARGIN = 14px from box edge).
 *     All three crosswalks are equidistant from their intersection edge → symmetric.
 *  2. Stop lines are placed BEFORE the crosswalk stripe (car stops, THEN
 *     pedestrians cross in the clear gap between car nose and stripe).
 *  3. Each road arm uses its own independent live closure for lightGo,
 *     so all three roads respond to their own signals.
 *  4. Phase sequence: green → yellow → crosswalk window (all red) × 3, loops.
 */

'use strict';

// ════════════════════════════════════════════════════════════════
// CANVAS
// ════════════════════════════════════════════════════════════════
const canvas = document.getElementById('sim');
const ctx    = canvas.getContext('2d');
const CW = 720, CH = 600;

// ════════════════════════════════════════════════════════════════
// ROAD GEOMETRY
// ════════════════════════════════════════════════════════════════
const LANE    = 22;             // single lane width (px)
const ROAD_HH = LANE * 4 + 8;  // horizontal road total height (4 lanes + median gap)
const ROAD_VW = LANE * 4 + 8;  // vertical road total width

// Centered positions — T-junction sits more in the middle of the canvas
const HMID = 255;   // y-center of horizontal road
const VMID = 390;   // x-center of vertical road

const HY1 = HMID - ROAD_HH / 2;   // top edge of horizontal road
const HY2 = HMID + ROAD_HH / 2;   // bottom edge of horizontal road
const VX1 = VMID - ROAD_VW / 2;   // left edge of vertical road
const VX2 = VMID + ROAD_VW / 2;   // right edge of vertical road

// ── Lane centre helpers ───────────────────────────────────────────
//
// HORIZONTAL ROAD — matching your diagram orientation:
//   TOP half of road    = cars going LEFT  (←)  lanes 0, 1
//   BOTTOM half of road = cars going RIGHT (→)  lanes 2, 3
//
//   Lane 0 = outer top    (← traffic, far from median)
//   Lane 1 = inner top    (← traffic, KEEP-RIGHT = inner = hLY(1), closest to median)
//   Lane 2 = inner bottom (→ traffic, KEEP-RIGHT = inner = hLY(2), closest to median)
//   Lane 3 = outer bottom (→ traffic, far from median)
//
// A car coming from the LEFT  and going RIGHT uses the BOTTOM half = hLY(2) or hLY(3)
//   Keep-right for → = hLY(2)  (inner bottom, closest to the yellow median)
// A car coming from the RIGHT and going LEFT  uses the TOP half = hLY(0) or hLY(1)
//   Keep-right for ← = hLY(1)  (inner top, closest to the yellow median)
//
// This matches your diagram where:
//   top arrow goes ←  (right-side origin)
//   bottom arrow goes → (left-side origin)
function hLY(i) { return HMID + [-LANE*1.5-4, -LANE*0.5-2, LANE*0.5+2, LANE*1.5+4][i]; }

// VERTICAL ROAD (below junction, cars come UP from bottom):
//   LEFT  half (vLX 0,1) = cars going DOWN ↓  (not used — T-junction has no top)
//   RIGHT half (vLX 2,3) = cars going UP   ↑  (KEEP-RIGHT for ↑ = right half)
//   Keep-right for ↑ = vLX(2) inner-right, vLX(3) outer-right
function vLX(i) { return VMID + [-LANE*1.5-4, -LANE*0.5-2, LANE*0.5+2, LANE*1.5+4][i]; }

// ── Crosswalk placement ──────────────────────────────────────────
// CW_MARGIN = distance from intersection box edge to the NEAR edge of the stripe.
// Small value → crosswalk is right next to the junction on all three arms.
const CW_MARGIN  = 14;   // px from intersection edge to near edge of stripe
const CW_STRIPE  = 14;   // stripe band width/height (px)

// Left crosswalk: stripe straddles CWL_X (horizontal road, left of intersection)
const CWL_X = VX1 - CW_MARGIN - CW_STRIPE / 2;   // stripe centre x

// Right crosswalk: symmetric on right side
const CWR_X = VX2 + CW_MARGIN + CW_STRIPE / 2;   // stripe centre x

// Mid crosswalk: stripe just below intersection on vertical road
const CWM_Y = HY2 + CW_MARGIN + CW_STRIPE / 2;   // stripe centre y

// ── Stop lines (always BEFORE the crosswalk, with a safe gap) ───
// Gap between the stop line and the near edge of the crosswalk stripe.
// This is the space pedestrians walk in — cars must not enter it when red.
const STOP_GAP = 8;   // minimum clear space between car nose and crosswalk

// Left-road cars travel RIGHT → stop line is to the LEFT of the left stripe near-edge
const STOP_L = CWL_X - CW_STRIPE / 2 - STOP_GAP;

// Right-road cars travel LEFT → stop line is to the RIGHT of the right stripe near-edge
const STOP_R = CWR_X + CW_STRIPE / 2 + STOP_GAP;

// Mid-road cars travel UP → stop line is BELOW the mid stripe near-edge
const STOP_M = CWM_Y + CW_STRIPE / 2 + STOP_GAP;

// Braking begins this many px before the stop line
const BRAKE_DIST = 80;

// ════════════════════════════════════════════════════════════════
// PIN STATE  — single source of truth for all LED signals
// ════════════════════════════════════════════════════════════════
const ps = {
    // Left road  (d13=Red, d12=Yellow, d14=Green)
    d13: 1, d12: 0, d14: 0,
    // Middle road (d25=Red, d26=Yellow, d27=Green)
    d25: 1, d26: 0, d27: 0,
    // Right road  (d32=Red, d33=Yellow, d4=Green)
    d32: 1, d33: 0, d4:  0,
    // Crosswalk blues (d22=Left, d21=Mid, d23=Right)
    d22: 0, d21: 0, d23: 0,
};

// Live helpers — closures read ps at the moment they're called
const L = {
    leftGo:  () => !!ps.d14 || !!ps.d12,  // green or yellow
    midGo:   () => !!ps.d27 || !!ps.d26,
    rightGo: () => !!ps.d4  || !!ps.d33,
    walkL:   () => !!ps.d22,
    walkM:   () => !!ps.d21,
    walkR:   () => !!ps.d23,
};

// ════════════════════════════════════════════════════════════════
// SIMULATION STATE
// ════════════════════════════════════════════════════════════════
let simRunning    = false;
let simSpeed      = 1.0;
let emergencyMode = false;
let simCycles     = 0;
let carsPassed    = 0;
let simUptime     = 0;
let uptimeInt     = null;
let lastFrame     = 0;
let lastSpawn     = 0;
let nextSpawnGap  = 1400;
let cars = [], peds = [];
let carId = 0, pedId = 0;

// Phase runner
let phaseSeq     = [];
let phaseStep    = 0;
let phaseTimer   = null;
let phaseBInt    = null;
let phaseElap    = 0;
let walkCountInt = null;

// ════════════════════════════════════════════════════════════════
// PHASE SEQUENCE
// Order: LEFT green→yellow→walk  |  MID green→yellow→walk  |  RIGHT green→yellow→walk
// During every *_walk phase: ALL traffic lights are RED, crosswalk LED is ON.
// ════════════════════════════════════════════════════════════════
function buildSeq() {
    const g = id => +document.getElementById(id).value * 1000;
    return [
        // ── LEFT ──────────────────────────────────────────────────
        { name:'left_green',   barId:'tl_left_bar',  barColor:'var(--green)',
          dur: g('t_left_green'),
          pins:{d13:0,d12:0,d14:1, d25:1,d26:0,d27:0, d32:1,d33:0,d4:0, d22:0,d21:0,d23:0} },

        { name:'left_yellow',  barId:'tl_left_bar',  barColor:'var(--yellow)',
          dur: g('t_left_yellow'),
          pins:{d13:0,d12:1,d14:0, d25:1,d26:0,d27:0, d32:1,d33:0,d4:0, d22:0,d21:0,d23:0} },

        { name:'left_walk',    barId:'tl_left_bar',  barColor:'var(--blue)',
          dur: g('t_left_walk'), isWalk:true,
          // All traffic RED, D22 (walk-left blue LED) ON
          pins:{d13:1,d12:0,d14:0, d25:1,d26:0,d27:0, d32:1,d33:0,d4:0, d22:1,d21:0,d23:0} },

        // ── MIDDLE ────────────────────────────────────────────────
        { name:'middle_green', barId:'tl_mid_bar',   barColor:'var(--green)',
          dur: g('t_mid_green'),
          pins:{d13:1,d12:0,d14:0, d25:0,d26:0,d27:1, d32:1,d33:0,d4:0, d22:0,d21:0,d23:0} },

        { name:'middle_yellow',barId:'tl_mid_bar',   barColor:'var(--yellow)',
          dur: g('t_mid_yellow'),
          pins:{d13:1,d12:0,d14:0, d25:0,d26:1,d27:0, d32:1,d33:0,d4:0, d22:0,d21:0,d23:0} },

        { name:'mid_walk',     barId:'tl_mid_bar',   barColor:'var(--blue)',
          dur: g('t_mid_walk'), isWalk:true,
          // All traffic RED, D21 (walk-mid blue LED) ON
          pins:{d13:1,d12:0,d14:0, d25:1,d26:0,d27:0, d32:1,d33:0,d4:0, d22:0,d21:1,d23:0} },

        // ── RIGHT ─────────────────────────────────────────────────
        { name:'right_green',  barId:'tl_right_bar', barColor:'var(--green)',
          dur: g('t_right_green'),
          pins:{d13:1,d12:0,d14:0, d25:1,d26:0,d27:0, d32:0,d33:0,d4:1, d22:0,d21:0,d23:0} },

        { name:'right_yellow', barId:'tl_right_bar', barColor:'var(--yellow)',
          dur: g('t_right_yellow'),
          pins:{d13:1,d12:0,d14:0, d25:1,d26:0,d27:0, d32:0,d33:1,d4:0, d22:0,d21:0,d23:0} },

        { name:'right_walk',   barId:'tl_right_bar', barColor:'var(--blue)',
          dur: g('t_right_walk'), isWalk:true,
          // All traffic RED, D23 (walk-right blue LED) ON
          pins:{d13:1,d12:0,d14:0, d25:1,d26:0,d27:0, d32:1,d33:0,d4:0, d22:0,d21:0,d23:1} },
    ];
}

// ════════════════════════════════════════════════════════════════
// PHASE RUNNER
// ════════════════════════════════════════════════════════════════
function runStep() {
    if (!simRunning || emergencyMode) return;

    const step = phaseSeq[phaseStep];
    const dur  = Math.max(300, step.dur / simSpeed);

    // Apply all pins at once
    Object.assign(ps, step.pins);
    updateAllUI(step);

    // Progress bar
    clearInterval(phaseBInt);
    phaseElap = 0;
    const bEl = document.getElementById(step.barId);
    bEl.style.width      = '0%';
    bEl.style.background = step.barColor;
    phaseBInt = setInterval(() => {
        phaseElap += 50;
        bEl.style.width = Math.min(100, phaseElap / dur * 100) + '%';
    }, 50);

    // Walk countdown badge
    clearInterval(walkCountInt);
    const badge     = document.getElementById('walkBadge');
    const countdown = document.getElementById('walkCountdown');
    if (step.isWalk) {
        badge.style.display = 'block';
        let rem = Math.ceil(step.dur / 1000);
        countdown.textContent = rem + 's';
        walkCountInt = setInterval(() => {
            rem = Math.max(0, rem - 1);
            countdown.textContent = rem + 's';
        }, 1000);
    } else {
        badge.style.display = 'none';
    }

    // Cycle counter increments on the first step of each full loop
    if (phaseStep === 0) {
        simCycles++;
        document.getElementById('statCycles').textContent = simCycles;
    }

    addLog(step.name);
    syncFB(step.name);

    phaseTimer = setTimeout(() => {
        phaseStep = (phaseStep + 1) % phaseSeq.length;
        runStep();
    }, dur);
}

// ════════════════════════════════════════════════════════════════
// UI UPDATE
// ════════════════════════════════════════════════════════════════
function updateAllUI(step) {
    const s = step ? step.pins : ps;   // use step.pins if available, else live ps

    // ── Traffic-light panel bulbs ─────────────────────────────
    sb('tl_left_r', s.d13); sb('tl_left_y', s.d12); sb('tl_left_g', s.d14);
    document.getElementById('tl_left_txt').textContent =
        s.d14 ? '● GREEN' : s.d12 ? '● YELLOW' : '● RED';

    sb('tl_mid_g', s.d27); sb('tl_mid_y', s.d26); sb('tl_mid_r', s.d25);
    document.getElementById('tl_mid_txt').textContent =
        s.d27 ? '● GREEN' : s.d26 ? '● YELLOW' : '● RED';

    sb('tl_right_g', s.d4); sb('tl_right_y', s.d33); sb('tl_right_r', s.d32);
    document.getElementById('tl_right_txt').textContent =
        s.d4  ? '● GREEN' : s.d33 ? '● YELLOW' : '● RED';

    sb('tl_cw_l', s.d22); sb('tl_cw_m', s.d21); sb('tl_cw_r', s.d23);

    // ── Phase chips ───────────────────────────────────────────
    setChip('chip_left',  s.d14, s.d12, 'LEFT:');
    setChip('chip_mid',   s.d27, s.d26, 'MID:');
    setChip('chip_right', s.d4,  s.d33, 'RIGHT:');

    const wOn = s.d22 || s.d21 || s.d23;
    const cw  = document.getElementById('chip_walk');
    cw.className = 'phase-chip ' + (wOn ? 'aw' : 'ax');
    cw.textContent = 'CROSSWALK: ' + (wOn ? 'ACTIVE' : 'OFF');

    // ── Stat label ────────────────────────────────────────────
    const name = step ? step.name : 'all_red';
    document.getElementById('statPhase').textContent =
        name.replace(/_/g, ' ').slice(0, 8).toUpperCase();

    // ── Pin-override buttons ──────────────────────────────────
    ['d13','d12','d14','d25','d26','d27','d32','d33','d4','d22','d21','d23']
        .forEach(pin => {
            const b = document.getElementById('pin_' + pin);
            if (b) b.className = 'pin-btn tooltip' + (ps[pin] ? ' on' : '');
        });
}

function sb(id, on) {
    const e = document.getElementById(id);
    if (e) on ? e.classList.add('on') : e.classList.remove('on');
}

function setChip(id, green, yellow, prefix) {
    const el = document.getElementById(id);
    el.className  = 'phase-chip ' + (green ? 'al' : yellow ? 'am' : 'ax');
    el.textContent = prefix + (green ? 'GREEN' : yellow ? 'YELLOW' : 'RED');
}

// ════════════════════════════════════════════════════════════════
// CAR TYPES
// ════════════════════════════════════════════════════════════════
const CTYPES = [
    { body:'#e63946', roof:'#9d1b22', len:24, wid:13 },  // red sedan
    { body:'#2196f3', roof:'#1254a0', len:28, wid:14 },  // blue SUV
    { body:'#ff9800', roof:'#b56300', len:36, wid:14 },  // orange truck
    { body:'#4caf50', roof:'#2d6e30', len:23, wid:12 },  // green compact
    { body:'#9c27b0', roof:'#5c0e74', len:43, wid:15 },  // purple bus
    { body:'#00bcd4', roof:'#006d80', len:24, wid:12 },  // cyan EV
    { body:'#f5f5f5', roof:'#888',    len:26, wid:13 },  // white police
    { body:'#ff5722', roof:'#9b2400', len:30, wid:13 },  // deep orange
];

// ════════════════════════════════════════════════════════════════
// CAR ROUTES  — KEEP-RIGHT RULE (matches your diagram)
//
// HORIZONTAL ROAD orientation (from your diagram):
//   TOP half (hLY 0,1)    = going LEFT ←   (cars from right side)
//   BOTTOM half (hLY 2,3) = going RIGHT →  (cars from left side)
//
// KEEP-RIGHT means use the lane closest to the centre median:
//   Cars going → use hLY(2)  (inner bottom, just below yellow median)
//   Cars going ← use hLY(1)  (inner top,    just above yellow median)
//
// VERTICAL ROAD:
//   Cars going ↑ use right half: vLX(2) and vLX(3)
//
// TURNS:
//   Left arm → turn ↓: enters hLY(2), pivots down into vLX(1) [left↓ lane]
//   Right arm → turn ↓: enters hLY(1), pivots down into vLX(0) [left↓ lane]
//   Mid arm → turn ←: vLX(2) goes ↑, exits onto hLY(1) [← lane]
//   Mid arm → turn →: vLX(3) goes ↑, exits onto hLY(2) [→ lane]
// ════════════════════════════════════════════════════════════════
function makeRoutes() {
    return [
        // ── LEFT ARM (spawn x=-60) → straight RIGHT ──────────────
        // Diagram 3: car comes from left, stays in bottom half (→), keep-right = hLY(2)
        { sx:-60, sy:hLY(2), dir:'r', stopX:STOP_L, lightGo:()=>L.leftGo(), weight:5,
          wps:[{x:STOP_L, y:hLY(2)}, {x:CW+60, y:hLY(2)}] },

        // ── LEFT ARM → turn DOWN into middle road ─────────────────
        // Diagram 1: car from left, turns ↓ into vertical road
        // Travels on hLY(2), then turns into left↓ side of vertical = vLX(1)
        { sx:-60, sy:hLY(2), dir:'r', stopX:STOP_L, lightGo:()=>L.leftGo(), weight:2,
          wps:[{x:STOP_L, y:hLY(2)}, {x:vLX(1), y:hLY(2)}, {x:vLX(1), y:CH+60}] },

        // ── RIGHT ARM (spawn x=CW+60) → straight LEFT ────────────
        // Diagram 3: car comes from right, stays in top half (←), keep-right = hLY(1)
        { sx:CW+60, sy:hLY(1), dir:'l', stopX:STOP_R, lightGo:()=>L.rightGo(), weight:5,
          wps:[{x:STOP_R, y:hLY(1)}, {x:-60, y:hLY(1)}] },

        // ── RIGHT ARM → turn DOWN into middle road ────────────────
        // Diagram 2: car from right, turns ↓ into vertical road
        // Travels on hLY(1), then turns into left↓ side = vLX(0)
        { sx:CW+60, sy:hLY(1), dir:'l', stopX:STOP_R, lightGo:()=>L.rightGo(), weight:2,
          wps:[{x:STOP_R, y:hLY(1)}, {x:vLX(0), y:hLY(1)}, {x:vLX(0), y:CH+60}] },

        // ── MIDDLE ARM (spawn bottom) → turn LEFT ─────────────────
        // Diagram 1 & 2: car from bottom goes ↑, exits ← onto top half = hLY(1)
        // Keep-right going ↑ = right half of vertical = vLX(2)
        { sx:vLX(2), sy:CH+60, dir:'u', stopY:STOP_M, lightGo:()=>L.midGo(), weight:3,
          wps:[{x:vLX(2), y:STOP_M}, {x:vLX(2), y:hLY(1)}, {x:-60, y:hLY(1)}] },

        // ── MIDDLE ARM → turn RIGHT ───────────────────────────────
        // Car from bottom goes ↑, exits → onto bottom half = hLY(2)
        // Keep-right going ↑ = right half = vLX(3)
        { sx:vLX(3), sy:CH+60, dir:'u', stopY:STOP_M, lightGo:()=>L.midGo(), weight:3,
          wps:[{x:vLX(3), y:STOP_M}, {x:vLX(3), y:hLY(2)}, {x:CW+60, y:hLY(2)}] },
    ];
}

function pickRoute() {
    const routes = makeRoutes();
    const total  = routes.reduce((s, r) => s + (r.weight || 1), 0);
    let roll = Math.random() * total;
    for (const r of routes) { roll -= (r.weight || 1); if (roll <= 0) return r; }
    return routes[0];
}

// ════════════════════════════════════════════════════════════════
// SPAWN CAR
// ════════════════════════════════════════════════════════════════
function spawnCar() {
    if (!simRunning || emergencyMode) return;
    const r   = pickRoute();
    const t   = CTYPES[Math.floor(Math.random() * CTYPES.length)];
    const wp0 = r.wps[0];
    const spd = 1.0 + Math.random() * 0.9;

    cars.push({
        id: carId++,
        x: r.sx, y: r.sy,
        angle: Math.atan2(wp0.y - r.sy, wp0.x - r.sx),
        t, route: r, wpIdx: 0,
        speed: spd, maxSpeed: spd,
        state: 'moving',  // 'moving' | 'braking' | 'stopped'
        done: false,
    });
}

// ════════════════════════════════════════════════════════════════
// UPDATE CARS  — braking, following, movement
// ════════════════════════════════════════════════════════════════
function updateCars(dt) {
    for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        if (car.done) continue;

        const wp = car.route.wps[car.wpIdx];
        if (!wp) { car.done = true; continue; }

        const dx   = wp.x - car.x;
        const dy   = wp.y - car.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // ── STOP-LINE CHECK ───────────────────────────────────────
        // Only applies while the car is approaching its first waypoint
        // (which is exactly the stop-line coordinate).
        if (car.wpIdx === 0) {
            const canGo = car.route.lightGo();

            if (car.route.stopX !== undefined) {
                const facingRight = car.route.dir === 'r';
                // Distance from car's front bumper to the stop line
                const distToStop = facingRight
                    ? (car.route.stopX - car.x) - car.t.len / 2
                    : (car.x - car.route.stopX) - car.t.len / 2;

                if (!canGo && distToStop > 0 && distToStop < BRAKE_DIST) {
                    const f = Math.max(0, distToStop / BRAKE_DIST);
                    car.speed = car.maxSpeed * f * f;
                    car.state = distToStop < 3 ? 'stopped' : 'braking';
                } else if (canGo || distToStop <= 0) {
                    car.speed = car.maxSpeed;
                    car.state = 'moving';
                }

            } else if (car.route.stopY !== undefined) {
                // Vertical car going UP — front bumper is at the TOP (y decreasing)
                const distToStop = (car.y - car.route.stopY) - car.t.len / 2;
                const canGoM     = car.route.lightGo();

                if (!canGoM && distToStop > 0 && distToStop < BRAKE_DIST) {
                    const f = Math.max(0, distToStop / BRAKE_DIST);
                    car.speed = car.maxSpeed * f * f;
                    car.state = distToStop < 3 ? 'stopped' : 'braking';
                } else if (canGoM || distToStop <= 0) {
                    car.speed = car.maxSpeed;
                    car.state = 'moving';
                }
            }

        } else {
            // Past stop line — always drive at full speed
            car.speed = car.maxSpeed;
            car.state = 'moving';
        }

        // ── FOLLOWING DISTANCE (collision avoidance) ──────────────
        for (let j = 0; j < cars.length; j++) {
            if (i === j || cars[j].done) continue;
            const o = cars[j];

            // Must be traveling in roughly the same direction
            if (Math.abs(car.angle - o.angle) > 0.55) continue;

            // Must be in the same lane (within half a lane width)
            const perpH = Math.abs(car.y - o.y) < LANE * 0.65;
            const perpV = Math.abs(car.x - o.x) < LANE * 0.65;
            if (!perpH && !perpV) continue;

            let gap = Infinity;
            const d = car.route.dir;
            if (d === 'r' && o.x > car.x) gap = (o.x - car.x) - o.t.len / 2 - car.t.len / 2;
            if (d === 'l' && o.x < car.x) gap = (car.x - o.x) - o.t.len / 2 - car.t.len / 2;
            if (d === 'u' && o.y < car.y) gap = (car.y - o.y) - o.t.len / 2 - car.t.len / 2;

            const minGap = 5;
            if (gap >= 0 && gap < 46) {
                const ff  = Math.max(0, (gap - minGap) / 46);
                const spd = o.speed * ff;
                if (spd < car.speed) {
                    car.speed = Math.max(0, spd);
                    if (gap < minGap + 2) car.state = 'stopped';
                }
            }
        }

        // ── MOVE ──────────────────────────────────────────────────
        const step = car.speed * simSpeed * dt * 60;
        if (dist <= step + 0.4) {
            car.x = wp.x; car.y = wp.y;
            car.wpIdx++;
            if (car.wpIdx >= car.route.wps.length) {
                car.done = true;
            } else {
                const nwp = car.route.wps[car.wpIdx];
                car.angle = Math.atan2(nwp.y - car.y, nwp.x - car.x);
            }
        } else {
            car.angle = Math.atan2(dy, dx);
            car.x += Math.cos(car.angle) * step;
            car.y += Math.sin(car.angle) * step;
        }
    }

    // Remove finished cars & count them
    const before = cars.length;
    cars = cars.filter(c => !c.done);
    const gone = before - cars.length;
    if (gone > 0) {
        carsPassed += gone;
        document.getElementById('statCars').textContent = carsPassed;
    }
}

// ════════════════════════════════════════════════════════════════
// PEDESTRIANS
// ════════════════════════════════════════════════════════════════
const PED_COLORS = [
    '#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#ffb347',
    '#c3a6ff','#ff9ff3','#54a0ff','#ff6348','#eccc68',
];

// Three crosswalk zones, each tied to its own walk signal
const CWZ = [
    { id:'cwL', axis:'v',
      cx: CWL_X,
      y1: HY1 - 10,  // sidewalk top edge (pedestrian start)
      y2: HY2 + 10,  // sidewalk bottom edge (pedestrian end)
      light: () => L.walkL() },

    { id:'cwR', axis:'v',
      cx: CWR_X,
      y1: HY1 - 10,
      y2: HY2 + 10,
      light: () => L.walkR() },

    { id:'cwM', axis:'h',
      cy: CWM_Y,
      x1: VX1 - 10,  // sidewalk left edge
      x2: VX2 + 10,  // sidewalk right edge
      light: () => L.walkM() },
];

function spawnPed() {
    if (!simRunning) return;
    CWZ.forEach(cw => {
        if (!cw.light()) return;
        if (peds.filter(p => p.cw === cw.id).length >= 8) return;
        if (Math.random() > 0.015 * simSpeed) return;

        const color = PED_COLORS[Math.floor(Math.random() * PED_COLORS.length)];
        const flip  = Math.random() > 0.5;
        let px, py, tx, ty;

        if (cw.axis === 'v') {
            px = cw.cx + (Math.random() - 0.5) * 8; tx = px;
            py = flip ? cw.y1 : cw.y2;
            ty = flip ? cw.y2 : cw.y1;
        } else {
            py = cw.cy + (Math.random() - 0.5) * 8; ty = py;
            px = flip ? cw.x1 : cw.x2;
            tx = flip ? cw.x2 : cw.x1;
        }

        peds.push({
            id: pedId++, x: px, y: py, tx, ty,
            color, sz: 4 + Math.random() * 1.5,
            spd: 0.42 + Math.random() * 0.36,
            phase: Math.random() * Math.PI * 2,
            cw: cw.id, done: false,
        });
    });
}

function updatePeds(dt) {
    spawnPed();
    peds.forEach(p => {
        if (p.done) return;
        const cw = CWZ.find(c => c.id === p.cw);

        // Freeze at sidewalk edge if light is off and ped hasn't entered road yet
        if (cw && !cw.light()) {
            if (cw.axis === 'v' && !(p.y > HY1 && p.y < HY2)) return;
            if (cw.axis === 'h' && !(p.x > VX1 && p.x < VX2)) return;
        }

        const dx = p.tx - p.x, dy = p.ty - p.y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        const step = p.spd * simSpeed * dt * 60;
        p.phase += 0.17 * simSpeed;
        if (d < step + 0.3) p.done = true;
        else { p.x += dx / d * step; p.y += dy / d * step; }
    });
    peds = peds.filter(p => !p.done);
}

// ════════════════════════════════════════════════════════════════
// DRAW ROAD
// ════════════════════════════════════════════════════════════════
function drawRoad() {
    // Grass / ground — warm green
    ctx.fillStyle = '#2a4e14';
    ctx.fillRect(0, 0, CW, CH);

    // Horizontal road body — warm asphalt
    ctx.fillStyle = '#4a4540';
    ctx.fillRect(0, HY1, CW, ROAD_HH);

    // Vertical road body
    ctx.fillStyle = '#4a4540';
    ctx.fillRect(VX1, HY2, ROAD_VW, CH - HY2);

    // Intersection box — slightly lighter
    ctx.fillStyle = '#3e3a36';
    ctx.fillRect(VX1, HY1, ROAD_VW, ROAD_HH);

    // ── Sidewalks — warm sandy ─────────────────────────────────
    ctx.fillStyle = '#c8b882';
    ctx.fillRect(0,    HY1 - 13, CW, 13);
    ctx.fillRect(0,    HY2,      VX1 - 9, 13);
    ctx.fillRect(VX2 + 9, HY2,  CW - VX2 - 9, 13);
    ctx.fillRect(VX1 - 13, HY2, 13, CH - HY2);
    ctx.fillRect(VX2,      HY2, 13, CH - HY2);

    // ── Crosswalk stripes ─────────────────────────────────────
    // Left crosswalk  (vertical stripes across horizontal road)
    drawCWStripes('v', CWL_X, HY1, CW_STRIPE, ROAD_HH, L.walkL());
    // Right crosswalk (vertical stripes across horizontal road)
    drawCWStripes('v', CWR_X, HY1, CW_STRIPE, ROAD_HH, L.walkR());
    // Mid crosswalk   (horizontal stripes across vertical road)
    drawCWStripes('h', VX1, CWM_Y, ROAD_VW, CW_STRIPE, L.walkM());

    // ── Double-yellow medians ──────────────────────────────────
    ctx.strokeStyle = '#f5c400';
    ctx.lineWidth   = 2.2;
    ctx.setLineDash([]);

    ctx.beginPath();
    // Horizontal median
    ctx.moveTo(0,   HMID - 1.5); ctx.lineTo(VX1, HMID - 1.5);
    ctx.moveTo(VX2, HMID - 1.5); ctx.lineTo(CW,  HMID - 1.5);
    ctx.moveTo(0,   HMID + 1.5); ctx.lineTo(VX1, HMID + 1.5);
    ctx.moveTo(VX2, HMID + 1.5); ctx.lineTo(CW,  HMID + 1.5);
    // Vertical median
    ctx.moveTo(VMID - 1.5, HY2); ctx.lineTo(VMID - 1.5, CH);
    ctx.moveTo(VMID + 1.5, HY2); ctx.lineTo(VMID + 1.5, CH);
    ctx.stroke();

    // ── Dashed lane dividers ───────────────────────────────────
    ctx.strokeStyle = '#ffffff33';
    ctx.lineWidth   = 1.2;
    ctx.setLineDash([13, 10]);

    [[hLY(0), hLY(1)], [hLY(2), hLY(3)]].forEach(([a, b]) => {
        const y = (a + b) / 2;
        ctx.beginPath();
        ctx.moveTo(0,   y); ctx.lineTo(VX1, y);
        ctx.moveTo(VX2, y); ctx.lineTo(CW,  y);
        ctx.stroke();
    });
    [[vLX(0), vLX(1)], [vLX(2), vLX(3)]].forEach(([a, b]) => {
        const x = (a + b) / 2;
        ctx.beginPath();
        ctx.moveTo(x, HY2); ctx.lineTo(x, CH);
        ctx.stroke();
    });
    ctx.setLineDash([]);

    // ── Road outer edges ───────────────────────────────────────
    ctx.strokeStyle = '#ffffff20';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(0,   HY1); ctx.lineTo(VX1, HY1);
    ctx.moveTo(VX2, HY1); ctx.lineTo(CW,  HY1);
    ctx.moveTo(0,   HY2); ctx.lineTo(VX1, HY2);
    ctx.moveTo(VX2, HY2); ctx.lineTo(CW,  HY2);
    ctx.moveTo(VX1, HY2); ctx.lineTo(VX1, CH);
    ctx.moveTo(VX2, HY2); ctx.lineTo(VX2, CH);
    ctx.stroke();

    // ── Stop lines ────────────────────────────────────────────
    // Drawn BEFORE (further from intersection than) the crosswalk stripe.
    // A stopped car's nose touches this line; the crosswalk is clear ahead.
    ctx.strokeStyle = '#ffffffaa';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.moveTo(STOP_L, HY1); ctx.lineTo(STOP_L, HY2);   // left arm
    ctx.moveTo(STOP_R, HY1); ctx.lineTo(STOP_R, HY2);   // right arm
    ctx.moveTo(VX1, STOP_M); ctx.lineTo(VX2, STOP_M);   // mid arm
    ctx.stroke();

    // ── Direction arrows — lanes actually used ────────────────
    ctx.fillStyle = '#00000030';
    dArrow(80,      hLY(2),   1,  0);   // left arm  → on bottom half (hLY 2)
    dArrow(CW - 80, hLY(1),  -1,  0);  // right arm ← on top half    (hLY 1)
    dArrow(vLX(2),  CH - 55,  0, -1);  // mid arm   ↑ right half
    dArrow(vLX(3),  CH - 55,  0, -1);  // mid arm   ↑ right half

    // ── Labels ────────────────────────────────────────────────
    ctx.font      = 'bold 8px "Share Tech Mono"';
    ctx.fillStyle = '#ffffff22';
    ctx.textAlign = 'center';
    ctx.fillText('← LEFT ROAD',  120,     HY1 - 2);
    ctx.fillText('RIGHT ROAD →', CW - 90, HY1 - 2);
    ctx.save();
    ctx.translate(VX1 - 2, HY2 + 70);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('MIDDLE ROAD', 0, 0);
    ctx.restore();
}

/**
 * Draw crosswalk zebra stripes.
 * axis='v': stripe band is vertical (crossing horizontal road) — cx is the band centre x
 * axis='h': stripe band is horizontal (crossing vertical road) — cy is the band centre y
 */
function drawCWStripes(axis, cx_or_x1, cy_or_y1, w, h, lit) {
    let bx, by;
    if (axis === 'v') { bx = cx_or_x1 - w / 2; by = cy_or_y1; }
    else              { bx = cx_or_x1;           by = cy_or_y1 - h / 2; }

    const n  = 5;
    ctx.fillStyle = lit ? '#ffffff26' : '#ffffff0e';
    for (let i = 0; i < n; i++) {
        if (axis === 'v') ctx.fillRect(bx + i * (w / n) + 1, by, w / n - 2, h);
        else              ctx.fillRect(bx, by + i * (h / n) + 1, w, h / n - 2);
    }
    if (lit) {
        ctx.fillStyle = '#1a73e822';
        ctx.fillRect(bx, by, w, h);
    }
}

function dArrow(x, y, dx, dy) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.moveTo(11, 0); ctx.lineTo(-7, 6); ctx.lineTo(-7, -6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
}

// ════════════════════════════════════════════════════════════════
// DRAW TRAFFIC SIGNALS
// ════════════════════════════════════════════════════════════════
function drawSignals() {
    // Signal posts sit at the stop line, on the sidewalk side
    drawPost(STOP_L - 6, HY1 - 6, ps.d13, ps.d12, ps.d14, 'L', true);
    drawPost(STOP_R + 6, HY1 - 6, ps.d32, ps.d33, ps.d4,  'R', true);
    drawPost(VX1 - 7,    STOP_M + 6, ps.d25, ps.d26, ps.d27, 'M', false);

    // Walk LEDs sit above/beside the crosswalk stripes on the sidewalk
    if (ps.d22) drawWalkLED(CWL_X, HY1 - 17, '#2979ff');  // left walk
    if (ps.d23) drawWalkLED(CWR_X, HY1 - 17, '#2979ff');  // right walk
    if (ps.d21) drawWalkLED(VMID,  CWM_Y + CW_STRIPE, '#2979ff'); // mid walk
}

function drawPost(x, y, r, yel, g, label, above) {
    ctx.fillStyle = '#445566';
    if (above) ctx.fillRect(x - 2, y - 36, 4, 36);
    else       ctx.fillRect(x - 2, y,      4, 36);

    const by = above ? y - 92 : y + 36;
    ctx.fillStyle   = '#181830';
    ctx.strokeStyle = '#2a3d55';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.roundRect(x - 12, by, 24, 56, 4); ctx.fill(); ctx.stroke();

    glowB(x, by + 10, 8, r,   '#ff2244');
    glowB(x, by + 28, 8, yel, '#ffd600');
    glowB(x, by + 46, 8, g,   '#00ff88');

    ctx.font      = '5px "Share Tech Mono"';
    ctx.fillStyle = '#ffffff44';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, above ? y - 1 : y + 50);
}

function glowB(x, y, r, on, color) {
    if (on) {
        const gr = ctx.createRadialGradient(x, y, 1, x, y, r * 3);
        gr.addColorStop(0, color + '99');
        gr.addColorStop(1, 'transparent');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = on ? color : color + '1a';
    ctx.fill();
    if (on) { ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0; }
}

function drawWalkLED(x, y, color) {
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle   = color;
    ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.fill(); ctx.shadowBlur = 0;
    ctx.font        = '5px "Share Tech Mono"';
    ctx.fillStyle   = color;
    ctx.textAlign   = 'center';
    ctx.fillText('WALK', x, y + 14);
}

// ════════════════════════════════════════════════════════════════
// DRAW CARS
// ════════════════════════════════════════════════════════════════
function drawCar(c) {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);

    const hl = c.t.len / 2, hw = c.t.wid / 2;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(2, 2.5, hl * .85, hw * .6, 0, 0, Math.PI * 2); ctx.fill();

    // Body
    ctx.fillStyle = c.t.body;
    ctx.beginPath(); ctx.roundRect(-hl, -hw, c.t.len, c.t.wid, 3); ctx.fill();

    // Roof
    ctx.fillStyle = c.t.roof;
    ctx.beginPath(); ctx.roundRect(-hl * .38, -hw * .72, c.t.len * .5, c.t.wid * .58, 2); ctx.fill();

    // Windscreens
    ctx.fillStyle = 'rgba(180,230,255,0.65)';
    ctx.beginPath(); ctx.roundRect(-hl * .35, -hw * .62, c.t.len * .18, c.t.wid * .38, 1); ctx.fill();
    ctx.beginPath(); ctx.roundRect( hl * .08, -hw * .62, c.t.len * .18, c.t.wid * .38, 1); ctx.fill();

    // Headlights
    ctx.fillStyle   = '#fffde7';
    ctx.shadowColor = '#fffde7'; ctx.shadowBlur = 5;
    ctx.fillRect(hl - 4, -hw + 2, 3, 3);
    ctx.fillRect(hl - 4,  hw - 5, 3, 3);
    ctx.shadowBlur = 0;

    // Tail / brake lights
    const brk = c.state === 'braking' || c.state === 'stopped';
    ctx.fillStyle   = brk ? '#ff3333' : '#ff224477';
    ctx.shadowColor = '#ff2244'; ctx.shadowBlur = brk ? 9 : 2;
    ctx.fillRect(-hl + 1, -hw + 2, 3, 3);
    ctx.fillRect(-hl + 1,  hw - 5, 3, 3);
    ctx.shadowBlur = 0;

    if (brk) {
        ctx.fillStyle = 'rgba(255,50,50,0.11)';
        ctx.beginPath(); ctx.ellipse(-hl, 0, 9, hw, 0, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
}

// ════════════════════════════════════════════════════════════════
// DRAW PEDESTRIANS
// ════════════════════════════════════════════════════════════════
function drawPed(p) {
    ctx.save();
    ctx.translate(p.x, p.y);

    const bob = Math.sin(p.phase) * 1.1;
    const leg = Math.sin(p.phase) * p.sz * 0.55;

    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath(); ctx.ellipse(1, p.sz + 1, p.sz * .6, p.sz * .26, 0, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.ellipse(0, bob, p.sz * .48, p.sz * .82, 0, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#f5cba7';
    ctx.beginPath(); ctx.arc(0, -p.sz * .68 + bob, p.sz * .45, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = p.color; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-0.5, p.sz * .44 + bob); ctx.lineTo(-p.sz * .33 + leg, p.sz * 1.22 + bob); ctx.stroke();
    ctx.beginPath(); ctx.moveTo( 0.5, p.sz * .44 + bob); ctx.lineTo( p.sz * .33 - leg, p.sz * 1.22 + bob); ctx.stroke();

    ctx.restore();
}

// ════════════════════════════════════════════════════════════════
// ANIMATION LOOP
// ════════════════════════════════════════════════════════════════
function loop(ts = 0) {
    const dt = Math.min((ts - lastFrame) / 1000, 0.05);
    lastFrame = ts;

    if (simRunning && !emergencyMode && ts - lastSpawn > nextSpawnGap / simSpeed) {
        spawnCar();
        lastSpawn    = ts;
        nextSpawnGap = 1200 + Math.random() * 900;
    }

    updateCars(dt);
    updatePeds(dt);

    ctx.clearRect(0, 0, CW, CH);
    drawRoad();
    drawSignals();
    peds.forEach(drawPed);
    cars.forEach(drawCar);

    requestAnimationFrame(loop);
}

// ════════════════════════════════════════════════════════════════
// SIMULATION CONTROLS  (called from index.php)
// ════════════════════════════════════════════════════════════════
function startSim() {
    if (simRunning) return;
    simRunning    = true;
    emergencyMode = false;
    phaseSeq      = buildSeq();
    phaseStep     = 0;
    phaseElap     = 0;
    document.getElementById('simStatusDot').style.cssText =
        'background:var(--green);box-shadow:0 0 8px var(--green)';
    document.getElementById('simStatusText').textContent = 'RUNNING';
    uptimeInt = setInterval(() => {
        simUptime++;
        document.getElementById('statTime').textContent = simUptime + 's';
    }, 1000);
    runStep();
}

function stopSim() {
    simRunning = false;
    clearTimeout(phaseTimer);
    clearInterval(phaseBInt);
    clearInterval(uptimeInt);
    clearInterval(walkCountInt);
    document.getElementById('simStatusDot').style.cssText =
        'background:var(--red);box-shadow:0 0 8px var(--red)';
    document.getElementById('simStatusText').textContent = 'STOPPED';
    document.getElementById('walkBadge').style.display   = 'none';
    applyAllRed();
    ['tl_left_bar','tl_mid_bar','tl_right_bar'].forEach(id => {
        document.getElementById(id).style.width = '0%';
    });
}

function toggleEmergency() {
    emergencyMode = !emergencyMode;
    const btn = document.getElementById('emergBtn');
    if (emergencyMode) {
        stopSim();
        btn.classList.add('active');
        btn.textContent = '⚠ EMERGENCY ACTIVE — CLICK TO CLEAR';
        const f = new FormData(); f.append('action', 'emergency');
        fetch('api.php', { method:'POST', body:f });
    } else {
        btn.classList.remove('active');
        btn.textContent = '⚠ EMERGENCY STOP';
    }
}

function applyAllRed() {
    Object.assign(ps, {
        d13:1,d12:0,d14:0,
        d25:1,d26:0,d27:0,
        d32:1,d33:0,d4:0,
        d22:0,d21:0,d23:0,
    });
    updateAllUI(null);
}

function updateSpeed(v) {
    simSpeed = parseFloat(v);
    document.getElementById('speedVal').textContent = simSpeed.toFixed(1) + 'x';
    if (simRunning) {
        clearTimeout(phaseTimer);
        clearInterval(phaseBInt);
        phaseSeq = buildSeq();
        runStep();
    }
}

function togglePin(pin) {
    const v = ps[pin] ? 0 : 1;
    ps[pin] = v;
    const b = document.getElementById('pin_' + pin);
    if (b) b.className = 'pin-btn tooltip' + (v ? ' on' : '');
    const f = new FormData();
    f.append('action', 'manual_pin');
    f.append('pin',   pin);
    f.append('value', v);
    fetch('api.php', { method:'POST', body:f });
    setFbS('ok', 'MANUAL: ' + pin.toUpperCase() + '=' + v);
    updateAllUI(null);
}

// ════════════════════════════════════════════════════════════════
// FIREBASE SYNC
// ════════════════════════════════════════════════════════════════
async function syncFB(phaseName) {
    try {
        const f = new FormData();
        f.append('action', 'update_lights');
        f.append('phase',  phaseName);
        const r = await fetch('api.php', { method:'POST', body:f });
        const d = await r.json();
        setFbS(d.success ? 'ok' : 'err',
               d.success ? 'SYNCED: ' + phaseName.toUpperCase() : 'SYNC ERROR');
    } catch {
        setFbS('err', 'CONN ERROR');
    }
}

function setFbS(t, m) {
    document.getElementById('fbDot').className    = 'fb-dot ' + t;
    document.getElementById('fbText').textContent = m;
}

// ════════════════════════════════════════════════════════════════
// LOG & CLOCK
// ════════════════════════════════════════════════════════════════
function addLog(name) {
    const box = document.getElementById('phaseLogBox');
    const n   = new Date();
    const t   = [n.getHours(), n.getMinutes(), n.getSeconds()]
                .map(x => String(x).padStart(2,'0')).join(':');
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = `<span class="log-time">${t}</span><span> ${name.toUpperCase()}</span>`;
    box.insertBefore(div, box.firstChild);
    if (box.children.length > 30) box.removeChild(box.lastChild);
}

setInterval(() => {
    const n = new Date();
    document.getElementById('clockDisplay').textContent =
        [n.getHours(), n.getMinutes(), n.getSeconds()]
        .map(x => String(x).padStart(2,'0')).join(':');
}, 1000);

// ── Boot ──────────────────────────────────────────────────────
applyAllRed();
loop();