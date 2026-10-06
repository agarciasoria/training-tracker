// ===== FIREBASE: Setup =====
const auth = firebase.auth();
const db = firebase.firestore();
let currentUser = null;
let listeners = [];
let currentView = 'cycles'; // BUG FIX: Track the current active view

// This will hold our local data, synced from Firestore in real-time
let data = {
  cycles: [],
  workouts: [],
  dayEntries: [],
  seriesSets: []
};

// ===== FIREBASE: Authentication Logic =====
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userInfo = document.getElementById('userInfo');
const mainContent = document.getElementById('mainContent');
const headerButtons = document.querySelector('header div:first-child'); 

loginBtn.onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
logoutBtn.onclick = () => {
    listeners.forEach(unsubscribe => unsubscribe());
    listeners = [];
    auth.signOut();
};

auth.onAuthStateChanged(user => {
  if (user) {
    currentUser = user;
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-block';
    headerButtons.style.display = 'flex';
    userInfo.textContent = `Hi, ${user.displayName.split(' ')[0]}`;
    userInfo.style.display = 'inline-block';
    
    db.enablePersistence().catch(err => console.error("Firestore persistence error: ", err));
    
    loadUserData();
    showSection(currentView);
  } else {
    currentUser = null;
    data = { cycles: [], workouts: [], dayEntries: [], seriesSets: [] };
    mainContent.innerHTML = '<h2>Welcome! Please sign in to track your training.</h2>';
    loginBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';
    headerButtons.style.display = 'none';
    userInfo.style.display = 'none';
  }
});

// ===== FIREBASE: Real-time Data Loading =====
function loadUserData() {
  if (!currentUser) return;
  const uid = currentUser.uid;

  listeners.forEach(unsubscribe => unsubscribe());
  listeners = [];

  const collections = ['cycles', 'workouts', 'dayEntries', 'seriesSets'];

  collections.forEach(collectionName => {
    const unsubscribe = db.collection(`users/${uid}/${collectionName}`).onSnapshot(snapshot => {
      data[collectionName] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // BUG FIX: Intelligently re-render the current view when data changes.
      showSection(currentView);
    });
    listeners.push(unsubscribe);
  });
}

// ===== Helper functions (no changes needed) =====
function parseRecovery(input) {
  if (!input) return null;
  const cleanedInput = input.replace(":", "");
  const num = parseInt(cleanedInput);
  if (isNaN(num)) return null;
  const s = num % 100;
  const m = Math.floor(num / 100);
  return m * 60 + s;
}

function formatRecovery(sec) {
    if (sec == null) return null;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatRecoveryForDisplay(sec) {
    const formatted = formatRecovery(sec);
    return formatted === null ? "—" : formatted;
}

// ===== Season Management Helpers =====
function getCycleSeason(cycle) {
  if (!cycle) return '2026';
  if (cycle.season && String(cycle.season).trim()) {
    return String(cycle.season).trim();
  }
  // Backward compatibility: If season is not set, infer from start_date year or default to '2026'
  if (cycle.start_date) {
    const year = String(cycle.start_date).split('-')[0];
    if (year && !isNaN(parseInt(year))) {
      return year;
    }
  }
  return '2026';
}

function getSeasonForWorkout(workoutId) {
  const w = data.workouts.find(w => w.id === workoutId);
  if (!w) return '2026';
  const c = data.cycles.find(c => c.id === w.cycle_id);
  return getCycleSeason(c);
}

function getAllSeasons() {
  const seasons = new Set();
  data.cycles.forEach(c => {
    seasons.add(getCycleSeason(c));
  });
  if (seasons.size === 0) {
    seasons.add('2026');
    seasons.add('2027');
  }
  // Sort seasons descending (e.g. 2027, 2026)
  return Array.from(seasons).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

function getSuggestedNewSeason() {
  const seasons = getAllSeasons();
  const numYears = seasons
    .map(s => parseInt(s))
    .filter(n => !isNaN(n));
  if (numYears.length > 0) {
    const maxYear = Math.max(...numYears);
    // If maximum recorded is 2026, suggest 2027
    if (maxYear <= 2026) return '2027';
    return String(maxYear);
  }
  return '2027';
}

const SEASON_PALETTE = [
  { line: '#3b82f6', bg: 'rgba(59, 130, 246, 0.22)', border: '#60a5fa', name: 'Blue' },
  { line: '#10b981', bg: 'rgba(16, 185, 129, 0.22)', border: '#34d399', name: 'Emerald' },
  { line: '#f59e0b', bg: 'rgba(245, 158, 11, 0.22)', border: '#fbbf24', name: 'Amber' },
  { line: '#ec4899', bg: 'rgba(236, 72, 153, 0.22)', border: '#f472b6', name: 'Pink' },
  { line: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.22)', border: '#a78bfa', name: 'Purple' },
  { line: '#06b6d4', bg: 'rgba(6, 182, 212, 0.22)', border: '#22d3ee', name: 'Cyan' }
];

function getSeasonColor(season, allSeasons) {
  const index = allSeasons.indexOf(season);
  if (index >= 0) {
    return SEASON_PALETTE[index % SEASON_PALETTE.length];
  }
  return SEASON_PALETTE[0];
}


// ===== Section Rendering =====
function showSection(section) {
  if (!currentUser) return;
  currentView = section; // BUG FIX: Set the current view
  const main = document.getElementById("mainContent");
  if (section === "cycles") renderCycles(main);
  if (section === "workouts") renderWorkouts(main);
  if (section === "dayEntries") renderDayEntries(main);
  if (section === "summary") renderSummary(main);
  if (section === "stats") renderStats(main);
}
window.showSection = showSection; // BUG FIX: Expose showSection to window

// ===== Stats Page (Chart.js) with Multi-Season Comparison =====
let myChart = null;
let selectedSeasons = new Set();
let statsComparisonMode = 'timeline'; // 'timeline' | 'overlay'
let recoveryGradientEnabled = true; // Toggle for recovery gradient points in comparison & single graphs

function renderStats(main) {
    const allSeasons = getAllSeasons();
    // Default to all seasons if none selected yet
    if (selectedSeasons.size === 0) {
        allSeasons.forEach(s => selectedSeasons.add(s));
    }

    main.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px;">
            <h2>Progress Analytics</h2>
            <div id="statsSeasonSummary" style="font-size: 0.85rem; color: #bbb;"></div>
        </div>
        <div id="statsWarningContainer"></div>
        <div id="statsControls">
            <select id="statsType">
                <option value="track">Track (Time vs Distance)</option>
                <option value="gym">Gym (Weight vs Date)</option>
            </select>
            <select id="statsParameter">
                <option value="">Select Parameter...</option>
            </select>

            <div style="width: 100%; display: flex; flex-direction: column; gap: 8px; margin-top: 4px; padding-top: 10px; border-top: 1px solid #333;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                    <div style="font-weight: 600; font-size: 0.9rem; color: var(--text); display: flex; align-items: center; gap: 6px;">
                        <span>🏷️ Seasons:</span>
                        <span id="seasonCountLabel" style="font-size: 0.8rem; font-weight: normal; color: #aaa;"></span>
                    </div>
                    <div style="display: flex; gap: 6px;">
                        <button type="button" id="selectAllSeasonsBtn" style="background:#262932; color:#ccc; border:1px solid #444; border-radius:4px; padding:3px 8px; font-size:0.75rem; cursor:pointer;">Select All</button>
                        <button type="button" id="selectLatestSeasonBtn" style="background:#262932; color:#ccc; border:1px solid #444; border-radius:4px; padding:3px 8px; font-size:0.75rem; cursor:pointer;">Latest Only</button>
                    </div>
                </div>
                <div id="seasonPillsContainer" style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                    <!-- Season pills rendered dynamically -->
                </div>
            </div>

            <div id="modeToggleSection" style="width: 100%; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 4px; padding-top: 8px; border-top: 1px solid #2d313b;">
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <span style="font-size: 0.85rem; color: #aaa;">Comparison Mode:</span>
                    <div style="display: flex; background: #202229; border-radius: 6px; padding: 2px; gap: 2px;">
                        <button type="button" id="modeTimelineBtn" class="mode-btn ${statsComparisonMode === 'timeline' ? 'active' : ''}">📅 Chronological Timeline</button>
                        <button type="button" id="modeOverlayBtn" class="mode-btn ${statsComparisonMode === 'overlay' ? 'active' : ''}">🔄 Side-by-Side Progression</button>
                    </div>
                </div>
                
                <div id="gradientToggleContainer" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <button type="button" id="toggleRecoveryGradientBtn" class="mode-btn ${recoveryGradientEnabled ? 'active' : ''}" style="border: 1px solid ${recoveryGradientEnabled ? 'var(--accent)' : '#444'}; display: inline-flex; align-items: center; gap: 6px;">
                        ⏱️ Recovery Gradients: <b style="color:${recoveryGradientEnabled ? 'var(--accent)' : '#aaa'};">${recoveryGradientEnabled ? 'ON' : 'OFF'}</b>
                        <span style="font-size: 0.75rem; opacity: 0.85;">(&lt;3m / 3-8m / +8m)</span>
                    </button>
                </div>
            </div>
        </div>

        <div id="seasonComparisonGrid"></div>

        <div id="chartContainer">
            <div id="chartCanvasWrapper">
                <canvas id="progressChart"></canvas>
            </div>
            <div id="chartLegend" style="display:none; flex-direction:column; align-items:center; margin-top:12px; padding-top:10px; border-top:1px solid #333; color:#bbb;">
                <!-- Legend Content Injected Dynamically -->
            </div>
        </div>
    `;

    const statsType = document.getElementById('statsType');
    const statsParameter = document.getElementById('statsParameter');
    const warningContainer = document.getElementById('statsWarningContainer');
    const pillsContainer = document.getElementById('seasonPillsContainer');
    const seasonCountLabel = document.getElementById('seasonCountLabel');
    const ctx = document.getElementById('progressChart').getContext('2d');
    const modeTimelineBtn = document.getElementById('modeTimelineBtn');
    const modeOverlayBtn = document.getElementById('modeOverlayBtn');
    const toggleRecoveryGradientBtn = document.getElementById('toggleRecoveryGradientBtn');
    const gradientToggleContainer = document.getElementById('gradientToggleContainer');

    function renderSeasonPills() {
        const seasons = getAllSeasons();
        pillsContainer.innerHTML = '';
        
        seasons.forEach(s => {
            const isActive = selectedSeasons.has(s);
            const color = getSeasonColor(s, seasons);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `season-pill-btn ${isActive ? 'active' : ''}`;
            btn.innerHTML = `<span class="color-indicator" style="background:${color.line};"></span>${isActive ? '✓ ' : ''}${s} Season`;
            btn.onclick = () => {
                if (selectedSeasons.has(s)) {
                    if (selectedSeasons.size > 1) {
                        selectedSeasons.delete(s);
                    }
                } else {
                    selectedSeasons.add(s);
                }
                renderSeasonPills();
                triggerChartUpdate();
            };
            pillsContainer.appendChild(btn);
        });

        const activeCount = selectedSeasons.size;
        seasonCountLabel.textContent = activeCount === 1 
            ? `(Viewing ${Array.from(selectedSeasons)[0]})` 
            : `(Comparing ${activeCount} seasons)`;
    }

    document.getElementById('selectAllSeasonsBtn').onclick = () => {
        getAllSeasons().forEach(s => selectedSeasons.add(s));
        renderSeasonPills();
        triggerChartUpdate();
    };

    document.getElementById('selectLatestSeasonBtn').onclick = () => {
        const seasons = getAllSeasons();
        selectedSeasons.clear();
        if (seasons.length > 0) selectedSeasons.add(seasons[0]);
        renderSeasonPills();
        triggerChartUpdate();
    };

    modeTimelineBtn.onclick = () => {
        statsComparisonMode = 'timeline';
        modeTimelineBtn.classList.add('active');
        modeOverlayBtn.classList.remove('active');
        triggerChartUpdate();
    };

    modeOverlayBtn.onclick = () => {
        statsComparisonMode = 'overlay';
        modeOverlayBtn.classList.add('active');
        modeTimelineBtn.classList.remove('active');
        triggerChartUpdate();
    };

    if (toggleRecoveryGradientBtn) {
        toggleRecoveryGradientBtn.onclick = () => {
            recoveryGradientEnabled = !recoveryGradientEnabled;
            toggleRecoveryGradientBtn.className = `mode-btn ${recoveryGradientEnabled ? 'active' : ''}`;
            toggleRecoveryGradientBtn.style.border = `1px solid ${recoveryGradientEnabled ? 'var(--accent)' : '#444'}`;
            toggleRecoveryGradientBtn.innerHTML = `
                ⏱️ Recovery Gradients: <b style="color:${recoveryGradientEnabled ? 'var(--accent)' : '#aaa'};">${recoveryGradientEnabled ? 'ON' : 'OFF'}</b>
                <span style="font-size: 0.75rem; opacity: 0.85;">(&lt;3m / 3-8m / +8m)</span>
            `;
            triggerChartUpdate();
        };
    }

    function triggerChartUpdate() {
        if (!statsParameter.value) return;
        updateChart(ctx, statsType.value, statsParameter.value);
    }

    function updateOptions() {
        const type = statsType.value;
        statsParameter.innerHTML = '<option value="">Select...</option>';
        statsParameter.disabled = false;
        warningContainer.innerHTML = '';

        if (gradientToggleContainer) {
            gradientToggleContainer.style.display = type === 'track' ? 'flex' : 'none';
        }

        if (type === 'track') {
            const distances = new Set();
            let missingDistCount = 0;
            
            data.seriesSets.forEach(s => {
                if (s.type === 'track') {
                    if (s.distance_meters) distances.add(s.distance_meters);
                    else missingDistCount++;
                }
            });
            
            if (missingDistCount > 0) {
                warningContainer.innerHTML = `<div style="background: #332b00; border: 1px solid #ffb300; padding: 10px; border-radius: 6px; margin-bottom: 10px; color: #ffe082;">
                    ⚠️ <b>Legacy Data:</b> ${missingDistCount} track runs have no distance. Edit them in Day Entries.
                </div>`;
            }

            const sorted = Array.from(distances).sort((a,b) => a-b);
            if (sorted.length === 0) {
                statsParameter.innerHTML = '<option>No track data found</option>';
                statsParameter.disabled = true;
            } else {
                statsParameter.innerHTML += sorted.map(d => `<option value="${d}">${d}m</option>`).join('');
            }
        } else {
            const names = new Set();
            data.workouts.forEach(w => {
                if (w.type === 'gym' && w.name) {
                    names.add(w.name.trim());
                }
            });
            
            const sorted = Array.from(names).sort();
            if (sorted.length === 0) {
                statsParameter.innerHTML = '<option>No gym workouts found</option>';
                statsParameter.disabled = true;
            } else {
                statsParameter.innerHTML += sorted.map(n => `<option value="${n}">${n}</option>`).join('');
            }
        }
    }

    statsType.addEventListener('change', () => {
        updateOptions();
        if (myChart) {
            myChart.destroy();
            myChart = null;
        }
        document.getElementById('chartLegend').style.display = 'none';
        document.getElementById('seasonComparisonGrid').innerHTML = '';
    });

    statsParameter.addEventListener('change', () => {
        triggerChartUpdate();
    });

    renderSeasonPills();
    updateOptions();
}

function getRepColor(repsString) {
    const r = parseInt(repsString);
    if (isNaN(r)) return '#2196F3'; 
    
    // Continuous scale from Red (0 deg) to Green (120 deg)
    const maxReps = 12;
    const hue = Math.min(120, Math.max(0, (r - 1) * (120 / (maxReps - 1))));
    return `hsl(${Math.round(hue)}, 100%, 45%)`;
}

function getRecoveryColor(seconds, isLast) {
    if (isLast) return '#E040FB'; // Distinct Magenta for Final Rep
    if (seconds == null || isNaN(seconds)) return '#888';

    // Gradients rule:
    // < 3 mins (< 180s): Short (Red to warm Amber/Orange, Hue 0° to ~40°)
    // Between 3 and 8 mins (180s to 480s): Medium (Yellow to Lime-Green, Hue 50° to ~95°)
    // +8 mins (>= 480s): Long (Pure Green, Hue 120°)
    const shortSec = 180; // 3 min
    const longSec = 480;  // 8 min

    let hue = 0;
    if (seconds < shortSec) {
        // Red (0°) smoothly moving to Orange/Amber (~40°) at 179s
        hue = (Math.max(0, seconds) / shortSec) * 40;
    } else if (seconds <= longSec) {
        // Yellow (50°) smoothly moving to Lime-Green (~95°) at 480s
        const progress = (seconds - shortSec) / (longSec - shortSec);
        hue = 50 + progress * 45;
    } else {
        // +8 mins is Long: Pure Green (120°)
        hue = 120;
    }

    return `hsl(${Math.round(hue)}, 100%, 45%)`;
}

function getRecoveryCategory(seconds, isLast) {
    if (isLast) return 'Final Rep';
    if (seconds == null || isNaN(seconds)) return 'No Recovery';
    if (seconds < 180) return 'Short (<3m)';
    if (seconds <= 480) return 'Medium (3-8m)';
    return 'Long (+8m)';
}

function updateChart(ctx, type, param) {
    const allSeasonsArray = getAllSeasons();
    const rawPoints = [];

    if (type === 'track') {
        const distance = parseFloat(param);
        data.dayEntries.forEach(entry => {
            const season = getSeasonForWorkout(entry.workout_id);
            const sets = data.seriesSets.filter(s => s.day_entry_id === entry.id && s.distance_meters === distance);
            sets.forEach(s => {
                const workout = data.workouts.find(w => w.id === entry.workout_id);
                const recCat = s.is_last ? "Final Rep" : (s.recovery_seconds != null ? ` [${getRecoveryCategory(s.recovery_seconds, false)}]` : '');
                rawPoints.push({
                    x: entry.date,
                    y: s.run_time,
                    season: season,
                    workoutName: workout ? workout.name : 'Unknown',
                    extra: s.is_last ? "Final Rep" : `Rec: ${formatRecoveryForDisplay(s.recovery_seconds)}${recCat}`,
                    recRaw: s.recovery_seconds,
                    isLast: s.is_last,
                    index: s.index
                });
            });
        });
    } else {
        const workoutName = param;
        const targetWorkouts = data.workouts.filter(w => w.type === 'gym' && w.name.trim() === workoutName);
        const targetWorkoutIds = new Set(targetWorkouts.map(w => w.id));

        data.dayEntries.forEach(entry => {
            if (!targetWorkoutIds.has(entry.workout_id)) return;
            const season = getSeasonForWorkout(entry.workout_id);
            const sets = data.seriesSets
                .filter(s => s.day_entry_id === entry.id)
                .sort((a, b) => a.index - b.index);

            sets.forEach(s => {
                const w = parseFloat(s.weight);
                if (!isNaN(w)) {
                    rawPoints.push({
                        x: entry.date,
                        y: w,
                        season: season,
                        workoutName: workoutName,
                        extra: `${s.reps} reps`, 
                        repsRaw: s.reps,
                        index: s.index
                    });
                }
            });
        });
    }

    // Filter points by currently selected seasons
    const filteredPoints = rawPoints.filter(p => selectedSeasons.has(p.season));

    // Sort chronologically by date and intraday index
    filteredPoints.sort((a, b) => {
        const comp = a.x.localeCompare(b.x);
        if (comp !== 0) return comp;
        return (a.index || 0) - (b.index || 0);
    });

    // ===== Render Season Comparison Summary Cards =====
    const comparisonGrid = document.getElementById('seasonComparisonGrid');
    if (comparisonGrid) {
        const sortedActiveSeasons = Array.from(selectedSeasons).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        const seasonStatsMap = {};

        sortedActiveSeasons.forEach(s => {
            const sPoints = filteredPoints.filter(p => p.season === s);
            if (sPoints.length > 0) {
                const values = sPoints.map(p => p.y);
                const best = type === 'track' ? Math.min(...values) : Math.max(...values);
                const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
                seasonStatsMap[s] = {
                    count: values.length,
                    best: best,
                    avg: avg,
                    points: sPoints
                };
            } else {
                seasonStatsMap[s] = { count: 0, best: null, avg: null, points: [] };
            }
        });

        // Compute deltas between seasons if 2 or more exist
        const cardsHTML = sortedActiveSeasons.map((s, idx) => {
            const stats = seasonStatsMap[s];
            const color = getSeasonColor(s, allSeasonsArray);
            const unit = type === 'track' ? 's' : 'kg';

            if (stats.count === 0) {
                return `
                    <div class="comparison-card" style="border-left: 4px solid ${color.line};">
                        <div class="comparison-card-header">
                            <span style="display:flex; align-items:center; gap:6px;">
                                <span style="width:10px; height:10px; border-radius:50%; background:${color.line}; display:inline-block;"></span>
                                <b>${s} Season</b>
                            </span>
                        </div>
                        <div class="comparison-card-sub" style="margin-top:6px;">No entries logged for this parameter yet.</div>
                    </div>
                `;
            }

            // Compare with the next older season if available
            let deltaHTML = '';
            const nextSeason = sortedActiveSeasons[idx + 1];
            if (nextSeason && seasonStatsMap[nextSeason] && seasonStatsMap[nextSeason].best !== null) {
                const prevBest = seasonStatsMap[nextSeason].best;
                const diff = stats.best - prevBest;
                if (type === 'track') {
                    if (diff < 0) {
                        deltaHTML = `<div class="comparison-card-delta delta-positive">⚡ ${Math.abs(diff).toFixed(2)}s faster than ${nextSeason}</div>`;
                    } else if (diff > 0) {
                        deltaHTML = `<div class="comparison-card-delta delta-negative">+${diff.toFixed(2)}s vs ${nextSeason}</div>`;
                    } else {
                        deltaHTML = `<div class="comparison-card-delta delta-neutral">Matched ${nextSeason} PB</div>`;
                    }
                } else {
                    if (diff > 0) {
                        deltaHTML = `<div class="comparison-card-delta delta-positive">💪 +${diff.toFixed(1)}kg vs ${nextSeason}</div>`;
                    } else if (diff < 0) {
                        deltaHTML = `<div class="comparison-card-delta delta-negative">${diff.toFixed(1)}kg vs ${nextSeason}</div>`;
                    } else {
                        deltaHTML = `<div class="comparison-card-delta delta-neutral">Matched ${nextSeason} PB</div>`;
                    }
                }
            }

            return `
                <div class="comparison-card highlight" style="border-left: 4px solid ${color.line};">
                    <div class="comparison-card-header">
                        <span style="display:flex; align-items:center; gap:6px;">
                            <span style="width:10px; height:10px; border-radius:50%; background:${color.line}; display:inline-block;"></span>
                            <b>${s} Season</b>
                        </span>
                        <span style="font-size:0.75rem; color:#aaa;">${stats.count} ${type === 'track' ? 'runs' : 'sets'}</span>
                    </div>
                    <div class="comparison-card-stat">
                        ${stats.best.toFixed(2)}<span class="unit">${unit} PB</span>
                    </div>
                    <div class="comparison-card-sub">
                        Average: <b>${stats.avg.toFixed(2)}${unit}</b>
                    </div>
                    ${deltaHTML}
                </div>
            `;
        }).join('');

        comparisonGrid.innerHTML = cardsHTML;
    }

    if (myChart) myChart.destroy();

    const legend = document.getElementById('chartLegend');
    const isMultiSeason = selectedSeasons.size > 1;

    let chartLabels = [];
    let datasets = [];

    // Helper to render the recovery scale legend with the new thresholds
    function renderRecoveryLegend() {
        if (!legend) return;
        legend.style.display = 'flex';
        legend.innerHTML = `
            <div style="font-size:0.85rem; margin-bottom:5px; font-weight:600; color:#fff;">Time Recovery Gradient Scale</div>
            <div style="width:100%; max-width:340px; height:12px; background:linear-gradient(to right, hsl(0,100%,45%), hsl(40,100%,45%), hsl(70,100%,45%), hsl(120,100%,45%)); border-radius:6px;"></div>
            <div style="display:flex; justify-content:space-between; width:100%; max-width:340px; font-size:0.75rem; margin-top:5px; color:#ddd;">
                <span>🔴 Short (&lt; 3m)</span>
                <span>🟡 Medium (3 - 8m)</span>
                <span>🟢 Long (+8m)</span>
            </div>
            <div style="display:flex; align-items:center; gap:6px; margin-top:8px; font-size:0.8rem; color:#bbb;">
                <span style="width:10px; height:10px; background:#E040FB; border-radius:50%; display:inline-block;"></span>
                <span>Final Rep (No Recovery)</span>
            </div>
        `;
    }

    if (statsComparisonMode === 'timeline') {
        chartLabels = filteredPoints.map(p => p.x);

        if (!isMultiSeason) {
            const singleSeason = Array.from(selectedSeasons)[0];
            const color = getSeasonColor(singleSeason, allSeasonsArray);
            let pointColors = color.line;

            if (type === 'track') {
                if (recoveryGradientEnabled) {
                    pointColors = filteredPoints.map(p => getRecoveryColor(p.recRaw, p.isLast));
                    renderRecoveryLegend();
                } else {
                    if (legend) legend.style.display = 'none';
                }
            } else {
                pointColors = filteredPoints.map(p => getRepColor(p.repsRaw));
                if (legend) {
                    legend.style.display = 'flex';
                    legend.innerHTML = `
                        <div style="font-size:0.85rem; margin-bottom:5px;">Reps Intensity Scale (${singleSeason} Season)</div>
                        <div style="width:100%; max-width:300px; height:12px; background:linear-gradient(to right, hsl(0,100%,45%), hsl(60,100%,45%), hsl(120,100%,45%)); border-radius:6px;"></div>
                        <div style="display:flex; justify-content:space-between; width:100%; max-width:300px; font-size:0.75rem; margin-top:4px;">
                            <span>1 (Max)</span>
                            <span>6 (Str)</span>
                            <span>12+ (End)</span>
                        </div>
                    `;
                }
            }

            datasets.push({
                label: `${singleSeason} Season (${param}${type === 'track' ? 'm' : ''})`,
                data: filteredPoints.map(p => p.y),
                borderColor: color.line,
                backgroundColor: color.bg,
                pointBackgroundColor: pointColors,
                pointBorderColor: recoveryGradientEnabled && type === 'track' ? '#ffffff' : pointColors,
                borderWidth: 2.5,
                pointRadius: 6,
                pointHoverRadius: 8,
                tension: 0.1,
                showLine: true,
                _rawPoints: filteredPoints
            });

        } else {
            // Multi-season timeline comparison
            if (type === 'track' && recoveryGradientEnabled) {
                renderRecoveryLegend();
            } else {
                if (legend) legend.style.display = 'none';
            }

            Array.from(selectedSeasons).sort().forEach(s => {
                const color = getSeasonColor(s, allSeasonsArray);
                const sData = filteredPoints.map(p => p.season === s ? p.y : null);
                const count = filteredPoints.filter(p => p.season === s).length;
                
                let pointBgColors = color.line;
                let pointBorderColors = '#fff';

                if (type === 'track' && recoveryGradientEnabled) {
                    pointBgColors = filteredPoints.map(p => p.season === s ? getRecoveryColor(p.recRaw, p.isLast) : '#888');
                    pointBorderColors = '#ffffff';
                }

                datasets.push({
                    label: `${s} Season (${count} pts)`,
                    data: sData,
                    borderColor: color.line,
                    backgroundColor: color.bg,
                    pointBackgroundColor: pointBgColors,
                    pointBorderColor: pointBorderColors,
                    pointHoverRadius: 8,
                    pointRadius: 6,
                    borderWidth: 2.5,
                    tension: 0.1,
                    showLine: true,
                    spanGaps: true,
                    _rawPoints: filteredPoints
                });
            });
        }

    } else {
        // ===== OVERLAY COMPARISON MODE =====
        if (type === 'track' && recoveryGradientEnabled) {
            renderRecoveryLegend();
        } else {
            if (legend) legend.style.display = 'none';
        }

        const seasonsList = Array.from(selectedSeasons).sort();
        let maxCount = 0;

        const seasonPointsMap = {};
        seasonsList.forEach(s => {
            const sPoints = filteredPoints.filter(p => p.season === s);
            seasonPointsMap[s] = sPoints;
            if (sPoints.length > maxCount) maxCount = sPoints.length;
        });

        chartLabels = Array.from({ length: Math.max(maxCount, 1) }, (_, i) => `${type === 'track' ? 'Run' : 'Set'} #${i + 1}`);

        seasonsList.forEach(s => {
            const color = getSeasonColor(s, allSeasonsArray);
            const sPoints = seasonPointsMap[s] || [];

            let pointBgColors = color.line;
            let pointBorderColors = '#fff';

            if (type === 'track' && recoveryGradientEnabled) {
                pointBgColors = sPoints.map(p => getRecoveryColor(p.recRaw, p.isLast));
                pointBorderColors = '#ffffff';
            }
            
            datasets.push({
                label: `${s} Season (${sPoints.length} pts)`,
                data: sPoints.map(p => p.y),
                borderColor: color.line,
                backgroundColor: color.bg,
                pointBackgroundColor: pointBgColors,
                pointBorderColor: pointBorderColors,
                pointHoverRadius: 8,
                pointRadius: 6,
                borderWidth: 2.5,
                tension: 0.1,
                showLine: true,
                _rawPoints: sPoints
            });
        });
    }

    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartLabels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: { color: '#bbb' },
                    grid: { color: '#333' },
                    title: {
                        display: true,
                        text: statsComparisonMode === 'timeline' ? 'Date' : `${type === 'track' ? 'Run' : 'Set'} Sequence (Overlay)`,
                        color: '#bbb'
                    }
                },
                y: {
                    ticks: { color: '#bbb' },
                    grid: { color: '#333' },
                    title: {
                        display: true,
                        text: type === 'track' ? 'Time (seconds)' : 'Weight (kg)',
                        color: '#bbb'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#fff',
                        font: { size: 12, weight: 'bold' }
                    }
                },
                tooltip: {
                    callbacks: {
                        title: function(items) {
                            const item = items[0];
                            return `${item.dataset.label} — ${item.label}`;
                        },
                        label: function(context) {
                            const val = context.parsed.y;
                            if (val === null || val === undefined) return '';
                            const unit = type === 'track' ? 's' : 'kg';
                            return ` ${type === 'track' ? 'Time' : 'Weight'}: ${val}${unit}`;
                        },
                        afterLabel: function(context) {
                            const raw = context.dataset._rawPoints?.[context.dataIndex];
                            if (raw) {
                                return [
                                    `Date: ${raw.x}`,
                                    `Workout: ${raw.workoutName}`,
                                    raw.extra
                                ];
                            }
                            return [];
                        }
                    }
                }
            }
        }
    });
}

// ===== Summary Page (UPDATED: Season Filter) =====
function renderSummary(main) {
    const seasons = getAllSeasons();
    main.innerHTML = `
      <h2>Summary</h2>
      <div id="summaryFilters">
        <select id="seasonFilter">
          <option value="">All Seasons</option>
          ${seasons.map(s => `<option value="${s}">Season ${s}</option>`).join('')}
        </select>
        <select id="cycleFilter"><option value="">All Cycles</option></select>
        <select id="workoutFilter"><option value="">All Workouts</option></select>
        <input type="date" id="dateFilter">
        <select id="typeFilter">
          <option value="">All Types</option>
          <option value="track">Track</option>
          <option value="gym">Gym</option>
        </select>
        <button id="clearFiltersBtn">Clear</button>
      </div>
      <div id="summaryList"></div>
    `;

    const seasonFilter = document.getElementById('seasonFilter');
    const cycleFilter = document.getElementById('cycleFilter');
    const workoutFilter = document.getElementById('workoutFilter');
    const dateFilter = document.getElementById('dateFilter');
    const typeFilter = document.getElementById('typeFilter');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');

    function updateCycleOptions() {
        const selectedSeason = seasonFilter.value;
        let availableCycles = data.cycles;
        if (selectedSeason) {
            availableCycles = data.cycles.filter(c => getCycleSeason(c) === selectedSeason);
        }
        const sorted = availableCycles.sort((a,b) => b.start_date.localeCompare(a.start_date));
        cycleFilter.innerHTML = '<option value="">All Cycles</option>' + 
            sorted.map(c => `<option value="${c.id}">${c.name} (${getCycleSeason(c)})</option>`).join('');
    }

    function updateWorkoutOptions() {
        const selectedSeason = seasonFilter.value;
        const selectedCycleId = cycleFilter.value;
        let availableWorkouts = data.workouts;

        if (selectedCycleId) {
            availableWorkouts = data.workouts.filter(w => w.cycle_id === selectedCycleId);
        } else if (selectedSeason) {
            const seasonCycleIds = new Set(data.cycles.filter(c => getCycleSeason(c) === selectedSeason).map(c => c.id));
            availableWorkouts = data.workouts.filter(w => seasonCycleIds.has(w.cycle_id));
        }

        workoutFilter.innerHTML = '<option value="">All Workouts</option>' + 
            availableWorkouts.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
    }
    
    seasonFilter.addEventListener('change', () => {
        updateCycleOptions();
        updateWorkoutOptions();
        updateSummaryList();
    });

    cycleFilter.addEventListener('change', () => {
        updateWorkoutOptions();
        updateSummaryList();
    });
    
    workoutFilter.addEventListener('change', updateSummaryList);
    dateFilter.addEventListener('change', updateSummaryList);
    typeFilter.addEventListener('change', updateSummaryList);

    clearFiltersBtn.addEventListener('click', () => {
        seasonFilter.value = '';
        updateCycleOptions();
        cycleFilter.value = '';
        dateFilter.value = '';
        typeFilter.value = '';
        updateWorkoutOptions();
        workoutFilter.value = '';
        updateSummaryList();
    });

    updateCycleOptions();
    updateWorkoutOptions();
    updateSummaryList();
}

function updateSummaryList() {
    const list = document.getElementById("summaryList");
    if (!list) return;

    const selectedSeason = document.getElementById('seasonFilter')?.value;
    const selectedCycle = document.getElementById('cycleFilter')?.value;
    const selectedWorkout = document.getElementById('workoutFilter')?.value;
    const selectedDate = document.getElementById('dateFilter')?.value;
    const selectedType = document.getElementById('typeFilter')?.value;

    let filteredEntries = [...data.dayEntries];

    // Filter by season
    if (selectedSeason) {
        filteredEntries = filteredEntries.filter(d => getSeasonForWorkout(d.workout_id) === selectedSeason);
    }

    // Filter by date
    if (selectedDate) {
        filteredEntries = filteredEntries.filter(d => d.date === selectedDate);
    }

    // Filter by workout or cycle
    if (selectedWorkout) {
        filteredEntries = filteredEntries.filter(d => d.workout_id === selectedWorkout);
    } else if (selectedCycle) {
        const workoutIdsInCycle = data.workouts.filter(w => w.cycle_id === selectedCycle).map(w => w.id);
        filteredEntries = filteredEntries.filter(d => workoutIdsInCycle.includes(d.workout_id));
    }
    
    // Filter by type
    if (selectedType) {
        filteredEntries = filteredEntries.filter(d => {
            const workout = data.workouts.find(w => w.id === d.workout_id);
            return workout && workout.type === selectedType;
        });
    }

    const sortedEntries = filteredEntries.sort((a, b) => b.date.localeCompare(a.date));

    list.innerHTML = sortedEntries.map(d => {
      const w = data.workouts.find(w => w.id === d.workout_id);
      const s = data.seriesSets.filter(s => s.day_entry_id === d.id).sort((a,b) => a.index - b.index);
      const season = getSeasonForWorkout(d.workout_id);

      let seriesContent = s.map(ss => {
          if (ss.type === 'track') {
              const dist = ss.distance_meters ? `<b>${ss.distance_meters}m</b> in ` : '';
              return `${dist}${ss.run_time}s` + (ss.is_last ? " (last)" : ` [rec: ${formatRecoveryForDisplay(ss.recovery_seconds)}]`);
          }
          return `${ss.reps} @ ${ss.weight}`;
      }).join("<br>");

      return `
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px; margin-bottom:4px;">
            <span><b>${w?.name || "Unknown"}</b> (${w?.type || 'N/A'})</span>
            <span class="season-badge">🏷️ Season: ${season}</span>
          </div>
          <div style="font-size:0.85rem; color:#bbb; margin-bottom:6px;">📅 ${d.date}</div>
          <p>${seriesContent}</p>
          ${d.notes ? `<i>${d.notes}</i><br>` : ''}
        </div>`;
    }).join("") || "<p>No entries match the selected filters.</p>";
}

// ===== Cycles (Refactored for Firebase) =====
function renderCycles(main) {
  const suggestedSeason = getSuggestedNewSeason();
  const seasons = getAllSeasons();
  main.innerHTML = `
    <h2>Training Cycles</h2>
    <form id="cycleForm">
      <input name="name" placeholder="Cycle name (e.g. Pre-Season)" required>
      <input name="season" id="cycleSeasonInput" list="seasonSuggestions" placeholder="Season (e.g. 2026 or 2027)" value="${suggestedSeason}" required>
      <input name="start" type="date" required>
      <input name="end" type="date" required>
      <button type="submit">Add Cycle</button>
      <datalist id="seasonSuggestions">
        ${seasons.map(s => `<option value="${s}">`).join('')}
        <option value="2027">
        <option value="2026">
      </datalist>
    </form>
    <div id="cycleList"></div>
  `;
  updateCycleList();

  document.getElementById("cycleForm").onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const newCycle = {
      name: f.name.value.trim(),
      season: f.season.value.trim() || '2027',
      start_date: f.start.value,
      end_date: f.end.value
    };
    db.collection(`users/${currentUser.uid}/cycles`).add(newCycle);
    f.reset();
  };
}

function updateCycleList() {
    const list = document.getElementById("cycleList");
    if(!list) return;
    const sortedCycles = data.cycles.sort((a,b) => b.start_date.localeCompare(a.start_date));
    list.innerHTML = sortedCycles.map(c => {
      const season = getCycleSeason(c);
      return `
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
            <b>${c.name}</b>
            <span class="season-badge">🏷️ Season: ${season}</span>
          </div>
          <div style="margin-top:4px; font-size:0.9rem; color:#ccc;">${c.start_date} → ${c.end_date}</div>
          <div style="margin-top:8px;">
            <button onclick="editCycle('${c.id}')">✏️ Edit</button>
            <button onclick="deleteCycle('${c.id}')">🗑️ Delete</button>
          </div>
        </div>
      `;
    }).join("") || "<p>No cycles yet.</p>";
}

window.editCycle = function(id) {
  const c = data.cycles.find(c => c.id === id);
  if (!c) return;
  const seasons = getAllSeasons();
  const currentSeason = c.season || getCycleSeason(c);
  const content = `
    <label>Cycle Name</label>
    <input id="editName" value="${c.name}">
    <label>Season Tag</label>
    <input id="editSeason" list="editSeasonSuggestions" value="${currentSeason}" placeholder="Season (e.g. 2026 or 2027)">
    <datalist id="editSeasonSuggestions">
      ${seasons.map(s => `<option value="${s}">`).join('')}
    </datalist>
    <label>Start Date</label>
    <input id="editStart" type="date" value="${c.start_date}">
    <label>End Date</label>
    <input id="editEnd" type="date" value="${c.end_date}">
  `;
  openModal("Edit Cycle", content, "Save", () => {
    const updatedCycle = {
      name: document.getElementById("editName").value.trim(),
      season: document.getElementById("editSeason").value.trim() || '2026',
      start_date: document.getElementById("editStart").value,
      end_date: document.getElementById("editEnd").value
    };
    db.doc(`users/${currentUser.uid}/cycles/${id}`).update(updatedCycle);
  });
};

window.deleteCycle = function(id) {
    openDeleteConfirm("Delete this cycle and ALL related data (workouts, entries)?", async () => {
        const uid = currentUser.uid;
        const batch = db.batch();

        const workoutsSnapshot = await db.collection(`users/${uid}/workouts`).where('cycle_id', '==', id).get();
        for (const workoutDoc of workoutsSnapshot.docs) {
            const dayEntriesSnapshot = await db.collection(`users/${uid}/dayEntries`).where('workout_id', '==', workoutDoc.id).get();
            for (const dayEntryDoc of dayEntriesSnapshot.docs) {
                const seriesSetsSnapshot = await db.collection(`users/${uid}/seriesSets`).where('day_entry_id', '==', dayEntryDoc.id).get();
                seriesSetsSnapshot.forEach(doc => batch.delete(doc.ref));
                batch.delete(dayEntryDoc.ref);
            }
            batch.delete(workoutDoc.ref);
        }
        
        batch.delete(db.doc(`users/${uid}/cycles/${id}`));
        await batch.commit().catch(err => console.error("Error deleting cycle data: ", err));
    });
};


// ===== Workouts (Refactored for Firebase) =====
function renderWorkouts(main) {
  if (data.cycles.length === 0) {
    main.innerHTML = "<h2>Workouts</h2><p>Please add a training cycle first.</p>";
    return;
  }
  const sortedCycles = data.cycles.sort((a,b) => b.start_date.localeCompare(a.start_date));
  main.innerHTML = `
    <h2>Workouts</h2>
    <form id="workoutForm">
      <select name="cycle">${sortedCycles.map(c => `<option value="${c.id}">${c.name} [Season ${getCycleSeason(c)}]</option>`).join("")}</select>
      <input name="name" placeholder="Workout name (e.g. 3x150m or Squats)" required>
      <select name="type"><option value="track">Track</option><option value="gym">Gym</option></select>
      <button type="submit">Add Workout</button>
    </form>
    <div id="workoutList"></div>
  `;
  updateWorkoutList();

  document.getElementById("workoutForm").onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const newWorkout = {
      cycle_id: f.cycle.value,
      name: f.name.value,
      type: f.type.value
    };
    db.collection(`users/${currentUser.uid}/workouts`).add(newWorkout);
    f.name.value = '';
  };
}

function updateWorkoutList() {
  const list = document.getElementById("workoutList");
  if(!list) return;
  list.innerHTML = data.workouts.map(w => {
    const c = data.cycles.find(c => c.id === w.cycle_id);
    const season = getCycleSeason(c);
    return `<div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
        <b>${w.name}</b> (${w.type})
        <span class="season-badge" style="font-size:0.75rem;">Season: ${season}</span>
      </div>
      <i>Cycle: ${c?.name || "No Cycle"}</i><br>
      <div style="margin-top:8px;">
        <button onclick="editWorkout('${w.id}')">✏️ Edit</button>
        <button onclick="deleteWorkout('${w.id}')">🗑️ Delete</button>
      </div>
    </div>`;
  }).join("") || "<p>No workouts yet.</p>";
}

window.editWorkout = function(id) {
  const w = data.workouts.find(w => w.id === id);
  if (!w) return;
  const content = `
    <label>Workout Name</label>
    <input id="editWName" value="${w.name}">
    <label>Workout Type</label>
    <select id="editWType">
      <option value="track" ${w.type === "track" ? "selected" : ""}>Track</option>
      <option value="gym" ${w.type === "gym" ? "selected" : ""}>Gym</option>
    </select>
  `;
  openModal("Edit Workout", content, "Save", () => {
    const updatedWorkout = {
      name: document.getElementById("editWName").value,
      type: document.getElementById("editWType").value,
    };
    db.doc(`users/${currentUser.uid}/workouts/${id}`).update(updatedWorkout);
  });
};

window.deleteWorkout = function(id) {
    openDeleteConfirm("Delete this workout and its entries?", async () => {
        const uid = currentUser.uid;
        const batch = db.batch();

        const dayEntriesSnapshot = await db.collection(`users/${uid}/dayEntries`).where('workout_id', '==', id).get();
        for (const dayEntryDoc of dayEntriesSnapshot.docs) {
            const seriesSetsSnapshot = await db.collection(`users/${uid}/seriesSets`).where('day_entry_id', '==', dayEntryDoc.id).get();
            seriesSetsSnapshot.forEach(doc => batch.delete(doc.ref));
            batch.delete(dayEntryDoc.ref);
        }

        batch.delete(db.doc(`users/${uid}/workouts/${id}`));
        await batch.commit().catch(err => console.error("Error deleting workout data: ", err));
    });
};


// ===== Day Entries (UPDATED: Cycle Filtering) =====
function renderDayEntries(main) {
  if (data.cycles.length === 0) {
    main.innerHTML = "<h2>Day Entries</h2><p>Please add a training cycle first.</p>";
    return;
  }
  
  main.innerHTML = `
    <h2>Day Entries</h2>
    <form id="dayForm">
      <select id="dayCycleSelect">
        <option value="">1. Select Cycle...</option>
        ${data.cycles.sort((a,b) => b.start_date.localeCompare(a.start_date))
          .map(c => `<option value="${c.id}">[Season ${getCycleSeason(c)}] ${c.name}</option>`).join("")}
      </select>
      
      <select name="workout" id="dayWorkoutSelect" disabled required>
        <option value="">2. Select Cycle First...</option>
      </select>
      
      <input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" required>
      <textarea name="notes" placeholder="Notes (e.g. felt good, windy)"></textarea>
      
      <div id="seriesContainer" style="width: 100%; display: flex; flex-direction: column; gap: 5px;"></div>
      
      <div id="entryActions" style="display:none; gap:10px; margin-top:10px; flex-wrap: wrap;">
        <button type="button" id="addSeries">+ Add Series/Set</button>
        <button type="submit">Save Day Entry</button>
      </div>
    </form>
    <div id="dayList"></div>
  `;
  
  const cycleSelect = document.getElementById("dayCycleSelect");
  const workoutSelect = document.getElementById("dayWorkoutSelect");
  const seriesContainer = document.getElementById("seriesContainer");
  const entryActions = document.getElementById("entryActions");
  let seriesCount = 0;

  // Listener for Cycle Change
  cycleSelect.onchange = () => {
      const cycleId = cycleSelect.value;
      seriesContainer.innerHTML = "";
      seriesCount = 0;
      entryActions.style.display = "none"; 
      
      if (!cycleId) {
          workoutSelect.innerHTML = '<option value="">2. Select Cycle First...</option>';
          workoutSelect.disabled = true;
          return;
      }

      const filteredWorkouts = data.workouts.filter(w => w.cycle_id === cycleId);
      
      if (filteredWorkouts.length === 0) {
          workoutSelect.innerHTML = '<option value="">No workouts in this cycle</option>';
          workoutSelect.disabled = true;
      } else {
          workoutSelect.innerHTML = '<option value="">2. Select Workout...</option>' + 
              filteredWorkouts.map(w => `<option value="${w.id}">${w.name} (${w.type})</option>`).join("");
          workoutSelect.disabled = false;
      }
  };

  // NEW: Listener for Workout Change
  workoutSelect.onchange = () => {
      seriesContainer.innerHTML = "";
      seriesCount = 0;
      if (workoutSelect.value) {
          entryActions.style.display = "flex";
      } else {
          entryActions.style.display = "none";
      }
  };

  function getWorkoutType() {
      const selectedWorkout = data.workouts.find(w => w.id === workoutSelect.value);
      return selectedWorkout?.type || 'track';
  }

  function addSeriesCard() {
      seriesCount++;
      const sid = "series" + seriesCount;
      const type = getWorkoutType();
      let content = '';

      // UPDATED: Track series now asks for Distance (m)
      if (type === 'track') {
          content = `
            <h4>Series ${seriesCount} (Track)</h4>
            <div style="display:flex; gap:5px; flex-wrap:wrap;">
                <input name="distance" type="number" placeholder="Distance (m)" style="flex:1;">
                <input name="time" placeholder="Time (e.g. 16.35)" required style="flex:1;">
                <input name="recovery" placeholder="Recovery (e.g. 3:30)" style="flex:1;">
            </div>
            <label class="checkbox-label"><span>Last set</span><input type="checkbox" name="last"></label>
          `;
      } else { 
          content = `
            <h4>Set ${seriesCount} (Gym)</h4>
            <input name="reps" placeholder="Reps (e.g. 5x5)" required>
            <input name="weight" placeholder="Weight (e.g. 100kg)" required>
          `;
      }
      
      seriesContainer.insertAdjacentHTML("beforeend", `<div class="card seriesCard" id="${sid}" data-type="${type}"><button class="deleteSeries" type="button" onclick="this.parentElement.remove()">✕</button>${content}</div>`);
  }
  
  document.getElementById("addSeries").onclick = addSeriesCard;

  document.getElementById("dayForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const uid = currentUser.uid;
    
    const dayEntry = { workout_id: f.workout.value, date: f.date.value, notes: f.notes.value };
    const dayEntryRef = await db.collection(`users/${uid}/dayEntries`).add(dayEntry);
    
    const batch = db.batch();
    const cards = seriesContainer.querySelectorAll(".seriesCard");

    cards.forEach((card, i) => {
      const type = card.dataset.type;
      let seriesData = { day_entry_id: dayEntryRef.id, index: i + 1, type: type };

      if (type === 'track') {
        const time = card.querySelector('[name=time]').value; if (!time) return;
        const dist = card.querySelector('[name=distance]').value;
        
        seriesData.run_time = parseFloat(time);
        seriesData.distance_meters = dist ? parseFloat(dist) : null; // Save Distance
        seriesData.recovery_seconds = card.querySelector('[name=last]').checked ? null : parseRecovery(card.querySelector('[name=recovery]').value);
        seriesData.is_last = card.querySelector('[name=last]').checked;
      } else { 
        const reps = card.querySelector('[name=reps]').value; if (!reps) return;
        seriesData.reps = reps; seriesData.weight = card.querySelector('[name=weight]').value;
      }
      const newSeriesRef = db.collection(`users/${uid}/seriesSets`).doc();
      batch.set(newSeriesRef, seriesData);
    });
    
    await batch.commit();
    f.notes.value = "";
    document.getElementById("seriesContainer").innerHTML = "";
    seriesCount = 0;
  };

  updateDayList();
}

function updateDayList() {
    const list = document.getElementById("dayList");
    if (!list) return;

    const sortedEntries = data.dayEntries.sort((a, b) => b.date.localeCompare(a.date));

    list.innerHTML = sortedEntries.map(d => {
      const w = data.workouts.find(w => w.id === d.workout_id);
      const s = data.seriesSets.filter(s => s.day_entry_id === d.id).sort((a,b) => a.index - b.index);

      let seriesContent = s.map(ss => {
          if (ss.type === 'track') {
              // UPDATED: Display distance in list with Visual Cue for missing data
              const dist = ss.distance_meters 
                  ? `<b>${ss.distance_meters}m</b> in ` 
                  : `<span style="color:#ffb300; font-size:0.8em; border:1px solid #ffb300; padding:1px 4px; border-radius:4px;">⚠️ Set Dist</span> `;
                  
              return `${dist}${ss.run_time}s` + (ss.is_last ? " (last)" : ` [rec: ${formatRecoveryForDisplay(ss.recovery_seconds)}]`);
          }
          return `${ss.reps} @ ${ss.weight}`;
      }).join("<br>");
      
      let typeMismatchWarning = "";
      if (s.length > 0 && w && w.type !== s[0].type) {
          typeMismatchWarning = `<div class="warning-text">Warning: Workout type is '${w.type}', but entries are for '${s[0].type}'. Please edit.</div>`;
      }

      const season = getSeasonForWorkout(d.workout_id);

      return `
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px; margin-bottom:4px;">
            <b>${w?.name || "Unknown"}</b> — ${d.date}
            <span class="season-badge">🏷️ Season: ${season}</span>
          </div>
          <p>${seriesContent}</p>
          ${d.notes ? `<i>${d.notes}</i><br>` : ''}
          ${typeMismatchWarning}
          <div style="margin-top: 10px;">
            <button onclick="editDayEntry('${d.id}')">✏️ Edit</button>
            <button onclick="deleteDayEntry('${d.id}')">🗑️ Delete</button>
          </div>
        </div>`;
    }).join("") || "<p>No day entries yet.</p>";
}

window.editDayEntry = function(id) {
  const d = data.dayEntries.find(e => e.id === id);
  if (!d) return;
  const series = data.seriesSets.filter(s => s.day_entry_id === id).sort((a,b) => a.index - b.index);
  const workout = data.workouts.find(w => w.id === d.workout_id);

  function getSeriesCardHTML(s, index) {
      const type = s.type || workout?.type || 'track';
      if (type === 'track') {
          // UPDATED: Edit form includes Distance
          return `
            <div class="card seriesCard" data-type="track">
                <h4>Series ${index + 1}</h4>
                <input class="distInput" value="${s.distance_meters || ''}" placeholder="Dist (m)" type="number">
                <input class="runTime" value="${s.run_time || ''}" placeholder="Time">
                <input class="recTime" value="${s.is_last ? "" : formatRecovery(s.recovery_seconds) || ""}" placeholder="Recovery">
                <label class="checkbox-label"><span>Last set</span><input type="checkbox" class="isLast" ${s.is_last ? "checked" : ""}></label>
                <button type="button" class="deleteSeries" onclick="this.parentElement.remove()">✕</button>
            </div>`;
      } else {
          return `<div class="card seriesCard" data-type="gym"><h4>Set ${index + 1}</h4><input class="reps" value="${s.reps || ''}" placeholder="Reps"><input class="weight" value="${s.weight || ''}" placeholder="Weight"><button type="button" class="deleteSeries" onclick="this.parentElement.remove()">✕</button></div>`;
      }
  }

  let html = `<label>Date</label><input id="editDate" type="date" value="${d.date}"><label>Notes</label><textarea id="editNotes">${d.notes}</textarea><h4>Series/Sets</h4><div id="editSeriesContainer" style="display: flex; flex-direction: column; gap: 5px;">${series.map(getSeriesCardHTML).join("")}</div><button id="addSeriesEdit" type="button">+ Add Series/Set</button>`;

  openModal("Edit Day Entry", html, "Save", async () => {
    const uid = currentUser.uid;
    const batch = db.batch();

    const updatedEntry = { date: document.getElementById("editDate").value, notes: document.getElementById("editNotes").value };
    batch.update(db.doc(`users/${uid}/dayEntries/${d.id}`), updatedEntry);

    const oldSeriesSnapshot = await db.collection(`users/${uid}/seriesSets`).where('day_entry_id', '==', d.id).get();
    oldSeriesSnapshot.forEach(doc => batch.delete(doc.ref));
    
    document.querySelectorAll("#editSeriesContainer .seriesCard").forEach((card, i) => {
        let seriesData = { day_entry_id: d.id, index: i + 1, type: card.dataset.type };
        if (seriesData.type === 'track') {
            const timeVal = card.querySelector(".runTime").value; if (!timeVal) return;
            const distVal = card.querySelector(".distInput").value;
            
            seriesData.run_time = parseFloat(timeVal);
            seriesData.distance_meters = distVal ? parseFloat(distVal) : null; // Save updated distance
            seriesData.is_last = card.querySelector(".isLast").checked;
            seriesData.recovery_seconds = seriesData.is_last ? null : parseRecovery(card.querySelector(".recTime").value);
        } else {
            const repsVal = card.querySelector(".reps").value; if (!repsVal) return;
            seriesData.reps = repsVal; seriesData.weight = card.querySelector(".weight").value;
        }
        const newSeriesRef = db.collection(`users/${uid}/seriesSets`).doc();
        batch.set(newSeriesRef, seriesData);
    });
    
    await batch.commit();
  });

  document.getElementById("addSeriesEdit").onclick = () => {
    const c = document.getElementById("editSeriesContainer");
    c.insertAdjacentHTML("beforeend", getSeriesCardHTML({}, c.children.length));
  };
};

window.deleteDayEntry = function(id) {
  openDeleteConfirm("Delete this entry?", async () => {
    const uid = currentUser.uid;
    const batch = db.batch();
    
    const seriesSnapshot = await db.collection(`users/${uid}/seriesSets`).where('day_entry_id', '==', id).get();
    seriesSnapshot.forEach(doc => batch.delete(doc.ref));
    
    batch.delete(db.doc(`users/${uid}/dayEntries/${id}`));
    
    await batch.commit();
  });
};