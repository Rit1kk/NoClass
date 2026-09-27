// app.js
import { db } from "./firebase-config.js";
import { collection, getDocs, addDoc, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ===== GRAB HTML ELEMENTS =====
const dateInput = document.getElementById("date-input");
const timeInput = document.getElementById("time-input");
const searchBtn = document.getElementById("search-btn");
const resultsContainer = document.getElementById("results-container");
const resultsTitle = document.getElementById("results-title");

// ===== SET TODAY'S DATE AND CURRENT TIME AS DEFAULT =====
const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, "0");
const dd = String(today.getDate()).padStart(2, "0");
dateInput.value = `${yyyy}-${mm}-${dd}`;

const hh = String(today.getHours()).padStart(2, "0");
const min = String(today.getMinutes()).padStart(2, "0");
timeInput.value = `${hh}:${min}`;

// ===== SEARCH BUTTON CLICK =====
searchBtn.addEventListener("click", checkAvailability);

async function checkAvailability() {
  const selectedDate = dateInput.value;
  const selectedTime = timeInput.value;

  if (!selectedDate || !selectedTime) {
    resultsContainer.innerHTML = `<p class="msg">Please select a date and time.</p>`;
    return;
  }

  resultsTitle.textContent = "Checking...";
  resultsContainer.innerHTML = `<p class="loading">Looking for free classrooms...</p>`;

  const dayName = new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });

  // Reports run on their own — must show even if zero rooms are free
  showReportsForDate(selectedDate);

  try {
    const roomsSnapshot = await getDocs(collection(db, "rooms"));
    const allRooms = [];
    roomsSnapshot.forEach(doc => allRooms.push({ id: doc.id, ...doc.data() }));

    if (allRooms.length === 0) {
      resultsTitle.textContent = "";
      resultsContainer.innerHTML = `<p class="msg">No rooms found in database.</p>`;
      return;
    }

    const ttQuery = query(collection(db, "timetable"), where("day", "==", dayName));
    const ttSnapshot = await getDocs(ttQuery);
    const entries = [];
    ttSnapshot.forEach(doc => entries.push(doc.data()));

    const occupiedRoomIds = new Set();
    entries.forEach(entry => {
      if (selectedTime >= entry.startTime && selectedTime < entry.endTime) {
        occupiedRoomIds.add(entry.roomId);
      }
    });

    const freeRooms = allRooms.filter(room => !occupiedRoomIds.has(room.roomId));

    resultsTitle.textContent = `Free Rooms — ${dayName} at ${selectedTime}`;

    if (freeRooms.length === 0) {
      resultsContainer.innerHTML = `<p class="msg">No free classrooms at this time.</p>`;
      return;
    }

    resultsContainer.innerHTML = freeRooms.map(room => `
      <div class="room-card">
        <span class="room-icon">🚪</span>
        <div>
          <div class="room-name">${room.name}${room.isLab ? ' <span style="color:#f0a500;font-size:11px;">[Lab]</span>' : ''}</div>
          <div class="room-status">✓ Free as per timetable</div>
        </div>
      </div>
    `).join("");

  } catch (error) {
    resultsTitle.textContent = "";
    resultsContainer.innerHTML = `<p class="msg">Error: ${error.message}</p>`;
    console.error(error);
  }
}

// Reports are independent of room availability — always checked
async function showReportsForDate(selectedDate) {
  try {
    const reportsQuery = query(collection(db, "reports"), where("date", "==", selectedDate));
    const reportsSnapshot = await getDocs(reportsQuery);
    const reports = [];
    reportsSnapshot.forEach(doc => reports.push(doc.data()));

    if (reports.length === 0) {
      reportsSection.style.display = "none";
      return;
    }

    reportsSection.style.display = "block";
    reportsTitle.textContent = `Recent Reports — ${selectedDate}`;
    const typeLabels = { cancelled: "🚫 Class Cancelled", absent: "👤 Teacher Absent", "room-changed": "🔁 Room Changed" };
    reportsContainer.innerHTML = reports.map(r => `
      <div class="report-badge">
        <div class="room-name">${r.roomId} — ${typeLabels[r.type] || r.type}</div>
        ${r.note ? `<div class="report-note">${r.note}</div>` : ""}
      </div>
    `).join("");
  } catch (error) {
    console.error("Reports error:", error);
  }
}
async function findTeacher() {
  const nameQuery = teacherInput.value.trim().toLowerCase();
  const selectedDate = dateInput.value;
  const selectedTime = timeInput.value;

  if (!nameQuery) {
    teacherResultsContainer.innerHTML = `<p class="msg">Type a teacher's name.</p>`;
    return;
  }
  if (!selectedDate || !selectedTime) {
    teacherResultsContainer.innerHTML = `<p class="msg">Select a date and time above first.</p>`;
    return;
  }

  teacherResultsTitle.textContent = "Searching...";
  teacherResultsContainer.innerHTML = `<p class="loading">Looking up teacher...</p>`;

  const dayName = new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });

  try {
    // STEP 1: Find teacher docs whose name matches the search (partial, case-insensitive)
    const teachersSnapshot = await getDocs(collection(db, "teachers"));
    const matchedTeachers = [];
    teachersSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.name.toLowerCase().includes(nameQuery)) {
        matchedTeachers.push(data);
      }
    });

    if (matchedTeachers.length === 0) {
      teacherResultsTitle.textContent = "";
      teacherResultsContainer.innerHTML = `<p class="msg">No teacher found matching "${teacherInput.value}".</p>`;
      return;
    }



    // STEP 2: Get timetable entries for that day
    const ttQuery = query(collection(db, "timetable"), where("day", "==", dayName));
    const ttSnapshot = await getDocs(ttQuery);
    const entries = [];
    ttSnapshot.forEach(doc => entries.push(doc.data()));
    

    // STEP 3: For each matched teacher, find their class at the selected time (if any)
    teacherResultsTitle.textContent = `Results — ${dayName} at ${selectedTime}`;

    teacherResultsContainer.innerHTML = matchedTeachers.map(teacher => {
      const currentClass = entries.find(e =>
        (
          e.teacherCode === teacher.teacherCode ||
          (Array.isArray(e.teacherCodes) && e.teacherCodes.includes(teacher.teacherCode))
        ) &&
        selectedTime >= e.startTime &&
        selectedTime < e.endTime
      );
      
      
      
      if (currentClass) {
        return `
          <div class="room-card">
            <span class="room-icon">📍</span>
            <div>
              <div class="room-name">${teacher.name}</div>
              <div class="room-status">In ${currentClass.roomId} — ${currentClass.subject}</div>
            </div>
          </div>
        `;
      } else {
        return `
          <div class="room-card">
            <span class="room-icon">👤</span>
            <div>
              <div class="room-name">${teacher.name}</div>
              <div class="room-status" style="color:#888;">No scheduled class at this time</div>
            </div>
          </div>
        `;
      }
    }).join("");

  } catch (error) {
    teacherResultsTitle.textContent = "";
    teacherResultsContainer.innerHTML = `<p class="msg">Error: ${error.message}</p>`;
    console.error(error);
  }
}
const teacherInput = document.getElementById("teacher-input");
const teacherBtn = document.getElementById("teacher-btn");
const teacherResultsContainer = document.getElementById("teacher-results-container");
const teacherResultsTitle = document.getElementById("teacher-results-title");

teacherBtn.addEventListener("click", findTeacher);

const reportsSection = document.getElementById("reports-section");
const reportsTitle = document.getElementById("reports-title");
const reportsContainer = document.getElementById("reports-container");

const reportRoomSelect = document.getElementById("report-room");
const reportDateInput = document.getElementById("report-date");
const reportTypeSelect = document.getElementById("report-type");
const reportNoteInput = document.getElementById("report-note");
const reportBtn = document.getElementById("report-btn");
const reportStatus = document.getElementById("report-status");

reportDateInput.value = dateInput.value; // default to today, reusing what you already computed
reportBtn.addEventListener("click", submitReport);

populateRoomDropdown();

// Fill the report form's room dropdown from Firestore, once on page load
async function populateRoomDropdown() {
  const roomsSnapshot = await getDocs(collection(db, "rooms"));
  const options = [];
  roomsSnapshot.forEach(doc => {
    const room = doc.data();
    options.push(`<option value="${room.roomId}">${room.name}</option>`);
  });
  reportRoomSelect.innerHTML = options.join("");
}

async function submitReport() {
  const roomId = reportRoomSelect.value;
  const date = reportDateInput.value;
  const type = reportTypeSelect.value;
  const note = reportNoteInput.value.trim();

  if (!roomId || !date) {
    reportStatus.style.display = "block";
    reportStatus.textContent = "Please select a room and date.";
    return;
  }

  reportBtn.disabled = true;
  reportStatus.style.display = "none";

  try {
    await addDoc(collection(db, "reports"), {
      roomId,
      date,
      type,
      note,
      createdAt: new Date().toISOString()
    });

    reportStatus.style.display = "block";
    reportStatus.textContent = "✓ Report submitted. Thanks!";
    reportNoteInput.value = "";
  } catch (error) {
    reportStatus.style.display = "block";
    reportStatus.textContent = "Error: " + error.message;
  } finally {
    reportBtn.disabled = false;
  }
}

// ===== LOST & FOUND =====
const lfRoomSelect = document.getElementById("lf-room");
const lfTypeSelect = document.getElementById("lf-type");
const lfDescInput = document.getElementById("lf-desc");
const lfBtn = document.getElementById("lf-btn");
const lfStatus = document.getElementById("lf-status");
const lfResultsContainer = document.getElementById("lostfound-results-container");

lfBtn.addEventListener("click", submitLostFound);
populateLFRoomDropdown();
showRecentLostFound();

async function populateLFRoomDropdown() {
  const roomsSnapshot = await getDocs(collection(db, "rooms"));
  const options = [];
  roomsSnapshot.forEach(doc => {
    const room = doc.data();
    options.push(`<option value="${room.roomId}">${room.name}</option>`);
  });
  lfRoomSelect.innerHTML = options.join("");
}

async function submitLostFound() {
  const roomId = lfRoomSelect.value;
  const type = lfTypeSelect.value;
  const description = lfDescInput.value.trim();

  if (!roomId || !description) {
    lfStatus.style.display = "block";
    lfStatus.textContent = "Please select a room and write a description.";
    return;
  }

  lfBtn.disabled = true;
  lfStatus.style.display = "none";

  try {
    await addDoc(collection(db, "lostFound"), {
      roomId,
      type,
      description,
      createdAt: new Date().toISOString()
    });

    lfStatus.style.display = "block";
    lfStatus.textContent = "✓ Posted. Thanks!";
    lfDescInput.value = "";
    showRecentLostFound();
  } catch (error) {
    lfStatus.style.display = "block";
    lfStatus.textContent = "Error: " + error.message;
  } finally {
    lfBtn.disabled = false;
  }
}

async function showRecentLostFound() {
  try {
    const lfQuery = query(collection(db, "lostFound"), orderBy("createdAt", "desc"), limit(20));
    const snapshot = await getDocs(lfQuery);
    const posts = [];
    snapshot.forEach(doc => posts.push(doc.data()));

    if (posts.length === 0) {
      lfResultsContainer.innerHTML = `<p class="msg">Nothing posted yet.</p>`;
      return;
    }

    lfResultsContainer.innerHTML = posts.map(p => `
      <div class="report-badge">
        <div class="room-name">${p.type === "lost" ? "🔍 Lost" : "📦 Found"} — ${p.roomId}</div>
        <div class="report-note">${p.description}</div>
      </div>
    `).join("");
  } catch (error) {
    lfResultsContainer.innerHTML = `<p class="msg">Error loading posts: ${error.message}</p>`;
    console.error(error);
  }
}