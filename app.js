// ===== Data setup =====
const STORAGE_KEY = "track_training_data_v1";
let data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
  cycles: [],
  workouts: [],
  dayEntries: [],
  seriesSets: []
};

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function showSection(section) {
  const main = document.getElementById("mainContent");
  if (section === "cycles") renderCycles(main);
  if (section === "workouts") renderWorkouts(main);
  if (section === "dayEntries") renderDayEntries(main);
}

// ===== Helper functions =====
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


// ===== Cycles =====
function renderCycles(main) {
  main.innerHTML = `
    <h2>Training Cycles</h2>
    <form id="cycleForm">
      <input name="name" placeholder="Cycle name (e.g. Pre-Season)" required>
      <input name="start" type="date" required>
      <input name="end" type="date" required>
      <button type="submit">Add Cycle</button>
    </form>
    <div id="cycleList"></div>
  `;
  const list = document.getElementById("cycleList");
  updateCycleList();

  document.getElementById("cycleForm").onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    data.cycles.push({
      id: "CYC-" + Date.now(),
      name: f.name.value,
      start_date: f.start.value,
      end_date: f.end.value
    });
    saveData();
    f.reset();
    updateCycleList();
  };

  function updateCycleList() {
    list.innerHTML = data.cycles.map(c => `
      <div class="card">
        <b>${c.name}</b><br>${c.start_date} → ${c.end_date}<br>
        <button onclick="editCycle('${c.id}')">✏️ Edit</button>
        <button onclick="deleteCycle('${c.id}')">🗑️ Delete</button>
      </div>
    `).join("") || "<p>No cycles yet.</p>";
  }
}

window.editCycle = function(id) {
  const c = data.cycles.find(c => c.id === id);
  if (!c) return;
  const content = `
    <label>Cycle Name</label>
    <input id="editName" value="${c.name}">
    <label>Start Date</label>
    <input id="editStart" type="date" value="${c.start_date}">
    <label>End Date</label>
    <input id="editEnd" type="date" value="${c.end_date}">
  `;
  openModal("Edit Cycle", content, "Save", () => {
    c.name = document.getElementById("editName").value;
    c.start_date = document.getElementById("editStart").value;
    c.end_date = document.getElementById("editEnd").value;
    saveData();
    showSection("cycles");
  });
};

window.deleteCycle = function(id) {
  openDeleteConfirm("Delete this cycle and all related data?", () => {
    const workoutsToDelete = data.workouts.filter(w => w.cycle_id === id).map(w => w.id);
    const dayEntriesToDelete = data.dayEntries.filter(d => workoutsToDelete.includes(d.workout_id)).map(d => d.id);
    
    data.seriesSets = data.seriesSets.filter(s => !dayEntriesToDelete.includes(s.day_entry_id));
    data.dayEntries = data.dayEntries.filter(d => !dayEntriesToDelete.includes(d.id));
    data.workouts = data.workouts.filter(w => w.cycle_id !== id);
    data.cycles = data.cycles.filter(c => c.id !== id);
    
    saveData();
    showSection("cycles");
  });
};

// ===== Workouts =====
function renderWorkouts(main) {
  if (data.cycles.length === 0) {
    main.innerHTML = "<h2>Workouts</h2><p>Please add a training cycle first.</p>";
    return;
  }
  main.innerHTML = `
    <h2>Workouts</h2>
    <form id="workoutForm">
      <select name="cycle">${data.cycles.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}</select>
      <input name="name" placeholder="Workout name (e.g. 3x150m or Squats)" required>
      <select name="type"><option value="track">Track</option><option value="gym">Gym</option></select>
      <button type="submit">Add Workout</button>
    </form>
    <div id="workoutList"></div>
  `;
  const list = document.getElementById("workoutList");
  updateWorkoutList();

  document.getElementById("workoutForm").onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    data.workouts.push({
      id: "WK-" + Date.now(),
      cycle_id: f.cycle.value,
      name: f.name.value,
      type: f.type.value
    });
    saveData();
    f.name.value = ''; 
    updateWorkoutList();
  };

  function updateWorkoutList() {
    list.innerHTML = data.workouts.map(w => {
      const c = data.cycles.find(c => c.id === w.cycle_id);
      return `<div class="card"><b>${w.name}</b> (${w.type})<br><i>${c?.name || "No Cycle"}</i><br>
        <button onclick="editWorkout('${w.id}')">✏️ Edit</button>
        <button onclick="deleteWorkout('${w.id}')">🗑️ Delete</button></div>`;
    }).join("") || "<p>No workouts yet.</p>";
  }
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
    w.name = document.getElementById("editWName").value;
    w.type = document.getElementById("editWType").value;
    saveData();
    showSection("workouts");
  });
};

window.deleteWorkout = function(id) {
  openDeleteConfirm("Delete this workout and its entries?", () => {
    const dayEntriesToDelete = data.dayEntries.filter(d => d.workout_id === id).map(d => d.id);
    data.seriesSets = data.seriesSets.filter(s => !dayEntriesToDelete.includes(s.day_entry_id));
    data.dayEntries = data.dayEntries.filter(d => d.workout_id !== id);
    data.workouts = data.workouts.filter(w => w.id !== id);
    saveData();
    showSection("workouts");
  });
};

// ===== Day Entries =====
function renderDayEntries(main) {
  if (data.workouts.length === 0) {
    main.innerHTML = "<h2>Day Entries</h2><p>Please add a workout first.</p>";
    return;
  }
  main.innerHTML = `
    <h2>Day Entries</h2>
    <form id="dayForm">
      <select name="workout" id="dayWorkoutSelect">${data.workouts.map(w => `<option value="${w.id}">${w.name} (${w.type})</option>`).join("")}</select>
      <input name="date" type="date" value="${new Date().toISOString().split('T')[0]}" required>
      <textarea name="notes" placeholder="Notes (e.g. felt good, windy)"></textarea>
      <div id="seriesContainer" style="width: 100%; display: flex; flex-direction: column; gap: 5px;"></div>
      <button type="button" id="addSeries">+ Add Series/Set</button>
      <button type="submit">Save Day Entry</button>
    </form>
    <div id="dayList"></div>
  `;
  
  const workoutSelect = document.getElementById("dayWorkoutSelect");
  const seriesContainer = document.getElementById("seriesContainer");
  let seriesCount = 0;

  function getWorkoutType() {
      const selectedWorkout = data.workouts.find(w => w.id === workoutSelect.value);
      return selectedWorkout?.type || 'track';
  }

  function addSeriesCard() {
      seriesCount++;
      const sid = "series" + seriesCount;
      const type = getWorkoutType();
      let content = '';

      if (type === 'track') {
          content = `
              <h4>Series ${seriesCount} (Track)</h4>
              <input name="time" placeholder="Running time (e.g. 16.35)" required>
              <input name="recovery" placeholder="Recovery (e.g. 3:30)">
              <label class="checkbox-label"><span>Last set</span><input type="checkbox" name="last"></label>`;
      } else { 
          content = `
              <h4>Set ${seriesCount} (Gym)</h4>
              <input name="reps" placeholder="Reps (e.g. 5x5)" required>
              <input name="weight" placeholder="Weight (e.g. 100kg)" required>`;
      }
      
      seriesContainer.insertAdjacentHTML("beforeend", `
          <div class="card seriesCard" id="${sid}" data-type="${type}">
              <button class="deleteSeries" type="button" onclick="this.parentElement.remove()">✕</button>
              ${content}
          </div>`);
  }
  
  document.getElementById("addSeries").onclick = addSeriesCard;
  workoutSelect.onchange = () => { 
    seriesContainer.innerHTML = "";
    seriesCount = 0;
  };

  document.getElementById("dayForm").onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const dayId = "DE-" + Date.now();
    const seriesArr = [];
    const cards = seriesContainer.querySelectorAll(".seriesCard");

    cards.forEach((card, i) => {
      const type = card.dataset.type;
      let seriesData = {
        id: "S-" + Date.now() + "-" + i,
        day_entry_id: dayId,
        index: i + 1,
        type: type,
      };

      if (type === 'track') {
        const time = card.querySelector('[name=time]').value;
        if (!time) return;
        const rec = card.querySelector('[name=recovery]').value;
        const isLast = card.querySelector('[name=last]').checked;
        
        seriesData.run_time = parseFloat(time);
        seriesData.recovery_seconds = isLast ? null : parseRecovery(rec);
        seriesData.is_last = isLast;
      } else { 
        const reps = card.querySelector('[name=reps]').value;
        if (!reps) return;

        seriesData.reps = reps;
        seriesData.weight = card.querySelector('[name=weight]').value;
      }
      seriesArr.push(seriesData);
    });

    data.dayEntries.push({
      id: dayId,
      workout_id: f.workout.value,
      date: f.date.value,
      notes: f.notes.value
    });
    data.seriesSets.push(...seriesArr);
    saveData();
    showSection("dayEntries");
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

      let seriesContent = "";
      let typeMismatchWarning = "";
      
      if (s.length > 0 && w) {
          const firstSeriesType = s[0].type;
          if (w.type !== firstSeriesType) {
              typeMismatchWarning = `<div class="warning-text">Warning: Workout type is '${w.type}', but entries are for '${firstSeriesType}'. Please edit.</div>`;
          }

          seriesContent = s.map(ss => {
              if (ss.type === 'track') {
                  return `${ss.run_time}s` + (ss.is_last ? " (last)" : ` [rec: ${formatRecoveryForDisplay(ss.recovery_seconds)}]`);
              } else { // gym
                  return `${ss.reps} @ ${ss.weight}`;
              }
          }).join("<br>");
      }

      return `
        <div class="card">
          <b>${w?.name || "Unknown"}</b> — ${d.date}<br>
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

// ===== Edit/Delete Day Entries =====
window.editDayEntry = function(id) {
  const d = data.dayEntries.find(e => e.id === id);
  if (!d) return;
  const series = data.seriesSets.filter(s => s.day_entry_id === id).sort((a,b) => a.index - b.index);
  const workout = data.workouts.find(w => w.id === d.workout_id);

  function getSeriesCardHTML(s, index) {
      if (s.type === 'track') {
          return `
          <div class="card seriesCard" data-type="track">
            <h4>Series ${index + 1}</h4>
            <input class="runTime" value="${s.run_time || ''}" placeholder="Running time (e.g. 16.35)">
            <input class="recTime" value="${s.is_last ? "" : formatRecovery(s.recovery_seconds) || ""}" placeholder="Recovery (e.g. 3:30)">
            <label class="checkbox-label">
                <span>Last set</span><input type="checkbox" class="isLast" ${s.is_last ? "checked" : ""}>
            </label>
            <button type="button" class="deleteSeries" onclick="this.parentElement.remove()">✕</button>
          </div>`;
      } else { // gym
          return `
          <div class="card seriesCard" data-type="gym">
            <h4>Set ${index + 1}</h4>
            <input class="reps" value="${s.reps || ''}" placeholder="Reps">
            <input class="weight" value="${s.weight || ''}" placeholder="Weight">
            <button type="button" class="deleteSeries" onclick="this.parentElement.remove()">✕</button>
          </div>`;
      }
  }

  let html = `
    <label>Date</label>
    <input id="editDate" type="date" value="${d.date}">
    <label>Notes</label>
    <textarea id="editNotes">${d.notes}</textarea>
    <h4>Series/Sets</h4>
    <div id="editSeriesContainer" style="display: flex; flex-direction: column; gap: 5px;">
      ${series.map(getSeriesCardHTML).join("")}
    </div>
    <button id="addSeriesEdit" type="button">+ Add Series/Set</button>
  `;

  openModal("Edit Day Entry", html, "Save", () => {
    d.date = document.getElementById("editDate").value;
    d.notes = document.getElementById("editNotes").value;

    const newSeries = [];
    document.querySelectorAll("#editSeriesContainer .seriesCard").forEach((card, i) => {
        const type = card.dataset.type;
        let seriesData = {
            id: "S-" + Date.now() + "-" + i,
            day_entry_id: d.id,
            index: i + 1,
            type: type
        };
        if (type === 'track') {
            const timeVal = card.querySelector(".runTime").value;
            if (!timeVal) return;
            const t = parseFloat(timeVal);
            const rVal = card.querySelector(".recTime").value;
            const isLast = card.querySelector(".isLast").checked;
            seriesData.run_time = t;
            seriesData.recovery_seconds = isLast ? null : parseRecovery(rVal);
            seriesData.is_last = isLast;
        } else { // gym
            const repsVal = card.querySelector(".reps").value;
            if (!repsVal) return;
            seriesData.reps = repsVal;
            seriesData.weight = card.querySelector(".weight").value;
        }
        newSeries.push(seriesData);
    });

    data.seriesSets = data.seriesSets.filter(s => s.day_entry_id !== d.id);
    data.seriesSets.push(...newSeries);
    saveData();
    showSection("dayEntries");
  });

  document.getElementById("addSeriesEdit").onclick = () => {
    const c = document.getElementById("editSeriesContainer");
    const idx = c.children.length;
    const type = workout?.type || 'track';
    const newCardHTML = getSeriesCardHTML({ type: type, is_last: false, run_time: '', recovery_seconds: null, reps: '', weight: '' }, idx);
    c.insertAdjacentHTML("beforeend", newCardHTML);
  };
};

window.deleteDayEntry = function(id) {
  openDeleteConfirm("Delete this entry?", () => {
    data.seriesSets = data.seriesSets.filter(s => s.day_entry_id !== id);
    data.dayEntries = data.dayEntries.filter(d => d.id !== id);
    saveData();
    showSection("dayEntries");
  });
};

// ===== Start =====
showSection("cycles");
