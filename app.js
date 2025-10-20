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


// ===== Section Rendering =====
function showSection(section) {
  if (!currentUser) return;
  currentView = section; // BUG FIX: Set the current view
  const main = document.getElementById("mainContent");
  if (section === "cycles") renderCycles(main);
  if (section === "workouts") renderWorkouts(main);
  if (section === "dayEntries") renderDayEntries(main);
  if (section === "summary") renderSummary(main); // NEW FEATURE
}

// ===== NEW FEATURE: Summary Page =====
function renderSummary(main) {
    main.innerHTML = `
      <h2>Summary</h2>
      <div id="summaryFilters">
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

    const cycleFilter = document.getElementById('cycleFilter');
    const workoutFilter = document.getElementById('workoutFilter');
    const dateFilter = document.getElementById('dateFilter');
    const typeFilter = document.getElementById('typeFilter');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');

    // Populate cycle dropdown
    const sortedCycles = data.cycles.sort((a,b) => b.start_date.localeCompare(a.start_date));
    cycleFilter.innerHTML += sortedCycles.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    function updateWorkoutOptions() {
        const selectedCycleId = cycleFilter.value;
        let availableWorkouts = data.workouts;
        if (selectedCycleId) {
            availableWorkouts = data.workouts.filter(w => w.cycle_id === selectedCycleId);
        }
        workoutFilter.innerHTML = '<option value="">All Workouts</option>' + 
            availableWorkouts.map(w => `<option value="${w.id}">${w.name}</option>`).join('');
    }
    
    cycleFilter.addEventListener('change', () => {
        updateWorkoutOptions();
        updateSummaryList();
    });
    
    workoutFilter.addEventListener('change', updateSummaryList);
    dateFilter.addEventListener('change', updateSummaryList);
    typeFilter.addEventListener('change', updateSummaryList);

    clearFiltersBtn.addEventListener('click', () => {
        cycleFilter.value = '';
        dateFilter.value = '';
        typeFilter.value = '';
        updateWorkoutOptions();
        workoutFilter.value = '';
        updateSummaryList();
    });

    updateWorkoutOptions();
    updateSummaryList();
}

function updateSummaryList() {
    const list = document.getElementById("summaryList");
    if (!list) return;

    const selectedCycle = document.getElementById('cycleFilter').value;
    const selectedWorkout = document.getElementById('workoutFilter').value;
    const selectedDate = document.getElementById('dateFilter').value;
    const selectedType = document.getElementById('typeFilter').value;

    let filteredEntries = [...data.dayEntries];

    // Apply filters
    if (selectedDate) {
        filteredEntries = filteredEntries.filter(d => d.date === selectedDate);
    }

    if (selectedWorkout) {
        filteredEntries = filteredEntries.filter(d => d.workout_id === selectedWorkout);
    } else if (selectedCycle) {
        const workoutIdsInCycle = data.workouts.filter(w => w.cycle_id === selectedCycle).map(w => w.id);
        filteredEntries = filteredEntries.filter(d => workoutIdsInCycle.includes(d.workout_id));
    }
    
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

      let seriesContent = s.map(ss => {
          if (ss.type === 'track') return `${ss.run_time}s` + (ss.is_last ? " (last)" : ` [rec: ${formatRecoveryForDisplay(ss.recovery_seconds)}]`);
          return `${ss.reps} @ ${ss.weight}`;
      }).join("<br>");

      return `
        <div class="card">
          <b>${w?.name || "Unknown"}</b> (${w?.type || 'N/A'}) — <b>${d.date}</b><br>
          <p>${seriesContent}</p>
          ${d.notes ? `<i>${d.notes}</i><br>` : ''}
        </div>`;
    }).join("") || "<p>No entries match the selected filters.</p>";
}

// ===== Cycles (Refactored for Firebase) =====
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
  updateCycleList();

  document.getElementById("cycleForm").onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const newCycle = {
      name: f.name.value,
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
    list.innerHTML = sortedCycles.map(c => `
      <div class="card">
        <b>${c.name}</b><br>${c.start_date} → ${c.end_date}<br>
        <button onclick="editCycle('${c.id}')">✏️ Edit</button>
        <button onclick="deleteCycle('${c.id}')">🗑️ Delete</button>
      </div>
    `).join("") || "<p>No cycles yet.</p>";
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
    const updatedCycle = {
      name: document.getElementById("editName").value,
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
    return `<div class="card"><b>${w.name}</b> (${w.type})<br><i>${c?.name || "No Cycle"}</i><br>
      <button onclick="editWorkout('${w.id}')">✏️ Edit</button>
      <button onclick="deleteWorkout('${w.id}')">🗑️ Delete</button></div>`;
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


// ===== Day Entries (Refactored for Firebase) =====
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
          content = `<h4>Series ${seriesCount} (Track)</h4><input name="time" placeholder="Running time (e.g. 16.35)" required><input name="recovery" placeholder="Recovery (e.g. 3:30)"><label class="checkbox-label"><span>Last set</span><input type="checkbox" name="last"></label>`;
      } else { 
          content = `<h4>Set ${seriesCount} (Gym)</h4><input name="reps" placeholder="Reps (e.g. 5x5)" required><input name="weight" placeholder="Weight (e.g. 100kg)" required>`;
      }
      
      seriesContainer.insertAdjacentHTML("beforeend", `<div class="card seriesCard" id="${sid}" data-type="${type}"><button class="deleteSeries" type="button" onclick="this.parentElement.remove()">✕</button>${content}</div>`);
  }
  
  document.getElementById("addSeries").onclick = addSeriesCard;
  workoutSelect.onchange = () => { seriesContainer.innerHTML = ""; seriesCount = 0; };

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
        seriesData.run_time = parseFloat(time);
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
    document.getElementById("dayForm").reset();
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
          if (ss.type === 'track') return `${ss.run_time}s` + (ss.is_last ? " (last)" : ` [rec: ${formatRecoveryForDisplay(ss.recovery_seconds)}]`);
          return `${ss.reps} @ ${ss.weight}`;
      }).join("<br>");
      
      let typeMismatchWarning = "";
      if (s.length > 0 && w && w.type !== s[0].type) {
          typeMismatchWarning = `<div class="warning-text">Warning: Workout type is '${w.type}', but entries are for '${s[0].type}'. Please edit.</div>`;
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

window.editDayEntry = function(id) {
  const d = data.dayEntries.find(e => e.id === id);
  if (!d) return;
  const series = data.seriesSets.filter(s => s.day_entry_id === id).sort((a,b) => a.index - b.index);
  const workout = data.workouts.find(w => w.id === d.workout_id);

  function getSeriesCardHTML(s, index) {
      const type = s.type || workout?.type || 'track';
      if (type === 'track') {
          return `<div class="card seriesCard" data-type="track"><h4>Series ${index + 1}</h4><input class="runTime" value="${s.run_time || ''}" placeholder="Time"><input class="recTime" value="${s.is_last ? "" : formatRecovery(s.recovery_seconds) || ""}" placeholder="Recovery"><label class="checkbox-label"><span>Last set</span><input type="checkbox" class="isLast" ${s.is_last ? "checked" : ""}></label><button type="button" class="deleteSeries" onclick="this.parentElement.remove()">✕</button></div>`;
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
            seriesData.run_time = parseFloat(timeVal);
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
