"use strict";

/* ================= 1. STATE & ARCHITECTURE REFS ================= */
let studentList = [];              // All students in database
let liveAttendanceList = [];       // Today's scanned attendance logs
let attendanceUnsubscriber = null;
let currentActiveExam = "";        // Active session loaded from cloud
let currentFeedMode = "feed";      // 'feed' (scanned) OR 'absent'
let selectedCandidateFilter = "ALL";

/* ================= 2. LIVING CANVAS ANIMATION ================= */
(function setupAnimatedBackground() {
    const canvas = document.getElementById("stageCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let nodes = [];
    const nodeCount = 30; // Optimized node count

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    for (let i = 0; i < nodeCount; i++) {
        nodes.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.45,
            vy: (Math.random() - 0.5) * 0.45,
            radius: Math.random() * 2 + 1
        });
    }

    function renderStage() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const isDark = document.documentElement.getAttribute("data-theme") === "dark";
        const dotColor = isDark ? "rgba(93, 30, 230, 0.4)" : "rgba(37, 30, 230, 0.94)";
        const lineColor = isDark ? "rgba(255, 255, 255, 0.010)" : "rgba(0, 0, 0, 0.40)";

        nodes.forEach((n, i) => {
            n.x += n.vx;
            n.y += n.vy;

            if (n.x < 0 || n.x > canvas.width) n.vx *= -1;
            if (n.y < 0 || n.y > canvas.height) n.vy *= -1;

            ctx.beginPath();
            ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
            ctx.fillStyle = dotColor;
            ctx.fill();

            for (let j = i + 1; j < nodes.length; j++) {
                const n2 = nodes[j];
                const dist = Math.hypot(n.x - n2.x, n.y - n2.y);
                if (dist < 120) {
                    ctx.beginPath();
                    ctx.moveTo(n.x, n.y);
                    ctx.lineTo(n2.x, n2.y);
                    ctx.strokeStyle = lineColor;
                    ctx.lineWidth = 1.2;
                    ctx.stroke();
                }
            }
        });
        requestAnimationFrame(renderStage);
    }
    renderStage();
})();

/* ================= 3. THEME MANAGEMENT WITH LOCALSTORAGE ================= */
(function initTheme() {
    const savedTheme = localStorage.getItem("app_theme") || "light";
    document.documentElement.setAttribute("data-theme", savedTheme);
    const icon = document.getElementById("themeIcon");
    if (icon) icon.textContent = savedTheme === "dark" ? "☀️" : "🌙";
})();

function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute("data-theme") || "light";
    const next = current === "light" ? "dark" : "light";
    html.setAttribute("data-theme", next);
    localStorage.setItem("app_theme", next);

    const icon = document.getElementById("themeIcon");
    if (icon) icon.textContent = next === "dark" ? "☀️" : "🌙";
}

/* ================= 4. DYNAMIC ROLE-BASED AUTHENTICATION (NO HARDCODED EMAIL) ================= */
window.addEventListener("DOMContentLoaded", () => {
    window.addEventListener("online", () => updateNetStatus(true));
    window.addEventListener("offline", () => updateNetStatus(false));

    const checkAuthInterval = setInterval(() => {
        if (window.firebaseAuth && window.fAuth) {
            clearInterval(checkAuthInterval);
            
            window.fAuth.onAuthStateChanged(window.firebaseAuth, async (user) => {
                const loginSection = document.getElementById("loginSection");
                const appSection = document.getElementById("appSection");

                if (user) {
                    try {
                        // Dynamic check: User UID ki 'admins' collection-e ache?
                        const adminDocRef = window.fs.doc(window.firebaseDB, "admins", user.uid);
                        const adminDocSnap = await window.fs.getDoc(adminDocRef);

                        if (!adminDocSnap.exists()) {
                            alert("Unauthorized! Ei account-er Admin privileges nei.");
                            await window.fAuth.signOut(window.firebaseAuth);
                            return;
                        }

                        // Valid Admin
                        if (loginSection) loginSection.classList.add("hidden");
                        if (appSection) appSection.classList.remove("hidden");
                        initializeSystemSession();

                    } catch (err) {
                        console.error("Admin verification error:", err);
                        alert("Permission verification failed: " + err.message);
                        await window.fAuth.signOut(window.firebaseAuth);
                    }
                } else {
                    if (loginSection) loginSection.classList.remove("hidden");
                    if (appSection) appSection.classList.add("hidden");
                    clearSessionState();
                }
            });
        }
    }, 100);
});

function updateNetStatus(isOnline) {
    const label = document.getElementById("netStatusLabel");
    const dot = document.querySelector(".signal-dot");
    if (label) label.textContent = isOnline ? "DATABASE CONNECTED" : "OFFLINE (DISCONNECTED)";
    if (dot) dot.style.background = isOnline ? "var(--success)" : "var(--primary-red)";
}

async function handleFirebaseLogin() {
    const email = document.getElementById("adminEmail").value.trim();
    const password = document.getElementById("adminPassword").value.trim();
    const notice = document.getElementById("authNotice");
    const btn = document.getElementById("loginBtn");

    if (!email || !password) {
        notice.textContent = "Please fill in email and password.";
        notice.style.color = "var(--primary-red)";
        return;
    }

    try {
        btn.disabled = true;
        btn.textContent = "AUTHENTICATING...";
        notice.textContent = "";

        // Tab close korle auto-logout hobar jonno browserSessionPersistence (jodi available thake)
        if (window.fAuth.setPersistence && window.fAuth.browserSessionPersistence) {
            await window.fAuth.setPersistence(window.firebaseAuth, window.fAuth.browserSessionPersistence);
        }

        await window.fAuth.signInWithEmailAndPassword(window.firebaseAuth, email, password);
    } catch (error) {
        btn.disabled = false;
        btn.textContent = "SECURE SIGN IN";
        notice.style.color = "var(--primary-red)";

        if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password") {
            notice.textContent = "Incorrect admin email or password.";
        } else if (error.code === "auth/user-not-found") {
            notice.textContent = "No admin user found with this email.";
        } else {
            notice.textContent = error.message;
        }
    }
}

async function processSignOut() {
    try {
        await window.fAuth.signOut(window.firebaseAuth);
        clearSessionState();
        toggleSidebarMenu(false);
    } catch (e) {
        console.error("Sign out error:", e);
    }
}

function clearSessionState() {
    if (attendanceUnsubscriber) {
        attendanceUnsubscriber();
        attendanceUnsubscriber = null;
    }
    studentList = [];
    liveAttendanceList = [];
    const feed = document.getElementById("liveLogRows");
    if (feed) feed.innerHTML = `<tr><td colspan="6" class="empty-state">Logged out.</td></tr>`;
    const cat = document.getElementById("studentCatalogRows");
    if (cat) cat.innerHTML = "";
}

/* ================= 5. SIDEBAR NAVIGATION ================= */
function toggleSidebarMenu(forceState) {
    const sidebar = document.getElementById("sidebar");
    const mask = document.getElementById("sidebarMask");
    if (!sidebar) return;

    const willOpen = typeof forceState === "boolean" ? forceState : !sidebar.classList.contains("open");
    
    if (willOpen) {
        sidebar.classList.add("open");
        if (mask) mask.classList.add("active");
        document.body.style.overflow = "hidden";
    } else {
        sidebar.classList.remove("open");
        if (mask) mask.classList.remove("active");
        document.body.style.overflow = "";
    }
}

function navigateTab(tabId, index, element) {
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    element.classList.add("active");

    const glider = document.getElementById("navGlider");
    if (glider) {
        const itemHeight = 56;
        glider.style.transform = `translateY(${index * itemHeight}px)`;
    }

    document.querySelectorAll(".view-panel").forEach(p => p.classList.remove("active"));
    const target = document.getElementById(tabId);
    if (target) target.classList.add("active");

    toggleSidebarMenu(false);
}

/* ================= 6. DATA INITIALIZATION & ACTIVE EXAM ================= */
async function initializeSystemSession() {
    await loadActiveExamConfig();
    await loadMasterStudents();
    startRealTimeAttendanceWatch();
}

async function loadActiveExamConfig() {
    try {
        const snap = await window.fs.getDoc(window.fs.doc(window.firebaseDB, "config", "activeExam"));
        if (snap.exists() && snap.data().currentExam) {
            currentActiveExam = snap.data().currentExam;
        } else {
            currentActiveExam = "";
        }
    } catch (e) {
        console.error("Active exam load error:", e);
    }
}

async function handleExamSwitch(newExam) {
    if (!newExam) return;
    currentActiveExam = newExam;
    
    try {
        await window.fs.setDoc(window.fs.doc(window.firebaseDB, "config", "activeExam"), { 
            currentExam: newExam,
            updatedAt: new Date().toISOString()
        });
    } catch (e) {
        console.error("Failed to save active exam to cloud:", e);
    }

    renderActiveExamBadge();
    startRealTimeAttendanceWatch();
}

function getDistinctExamSessions() {
    const sessions = new Set();
    studentList.forEach(s => {
        if (s.examSession) sessions.add(s.examSession);
    });
    return Array.from(sessions);
}

function renderActiveExamDropdown() {
    const select = document.getElementById("activeExamSelect");
    if (!select) return;

    const sessions = getDistinctExamSessions();
    select.innerHTML = "";

    if (sessions.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No Exam Uploaded Yet";
        select.appendChild(opt);
        currentActiveExam = "";
        renderActiveExamBadge();
        return;
    }

    if (!currentActiveExam || !sessions.includes(currentActiveExam)) {
        currentActiveExam = sessions[0];
    }

    sessions.forEach(exam => {
        const opt = document.createElement("option");
        opt.value = exam;
        opt.textContent = exam;
        if (exam === currentActiveExam) opt.selected = true;
        select.appendChild(opt);
    });

    renderActiveExamBadge();
}

function renderActiveExamBadge() {
    const activeCandidates = studentList.filter(s => s.examSession === currentActiveExam);
    const countBadge = document.getElementById("activeExamTotalBadge");
    if (countBadge) countBadge.textContent = activeCandidates.length;
}

async function loadMasterStudents() {
    try {
        const snap = await window.fs.getDocs(window.fs.collection(window.firebaseDB, "students"));
        studentList = [];
        snap.forEach(doc => studentList.push(doc.data()));
        
        renderActiveExamDropdown();
        renderCandidateFilterDropdown();
        renderStudentDirectory();
    } catch (e) {
        console.error("Master student load error:", e);
    }
}

/* ================= 7. REALTIME ATTENDANCE WATCH (STRICT ACTIVE EXAM) ================= */
function startRealTimeAttendanceWatch() {
    if (attendanceUnsubscriber) {
        attendanceUnsubscriber();
        attendanceUnsubscriber = null;
    }

    if (!currentActiveExam) {
        liveAttendanceList = [];
        renderAttendanceFeed();
        return;
    }

    const today = getTodayDate();
    const q = window.fs.query(
        window.fs.collection(window.firebaseDB, "attendance"),
        window.fs.where("date", "==", today),
        window.fs.where("examSession", "==", currentActiveExam)
    );

    attendanceUnsubscriber = window.fs.onSnapshot(q, (snapshot) => {
        liveAttendanceList = [];
        snapshot.forEach(doc => liveAttendanceList.push(doc.data()));
        renderAttendanceFeed();
    }, (err) => {
        console.error("Attendance listener error:", err);
    });
}

function switchFeedView(mode) {
    currentFeedMode = mode;
    document.getElementById("tabFeedBtn").classList.toggle("active", mode === "feed");
    document.getElementById("tabAbsentBtn").classList.toggle("active", mode === "absent");
    renderAttendanceFeed();
}

function getActiveExamCandidates() {
    return studentList.filter(s => s.examSession === currentActiveExam);
}

function renderAttendanceFeed() {
    const tbody = document.getElementById("liveLogRows");
    if (!tbody) return;
    tbody.innerHTML = "";

    const activeCandidates = getActiveExamCandidates();
    const scannedSet = new Set(liveAttendanceList.map(r => String(r.barcode).trim()));
    const absentStudents = activeCandidates.filter(s => !scannedSet.has(String(s.barcode).trim()));

    const scannedBadge = document.getElementById("feedScannedBadge");
    const absentBadge = document.getElementById("absentCandidateBadge");
    if (scannedBadge) scannedBadge.textContent = liveAttendanceList.length;
    if (absentBadge) absentBadge.textContent = absentStudents.length;

    if (currentFeedMode === "feed") {
        if (!liveAttendanceList.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No attendance recorded today for ${escapeHTML(currentActiveExam || "this exam")}.</td></tr>`;
            return;
        }

        liveAttendanceList.slice().reverse().forEach(record => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><code>${escapeHTML(record.barcode)}</code></td>
                <td><strong>${escapeHTML(record.name)}</strong></td>
                <td>${escapeHTML(record.roll || "-")}</td>
                <td>${escapeHTML(record.class || "-")}</td>
                <td><span style="color:var(--success); font-weight:700;">✓ Present (${escapeHTML(record.time)})</span></td>
                <td>${escapeHTML(record.phone || "-")}</td>
            `;
            tbody.appendChild(tr);
        });

    } else {
        if (!absentStudents.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:var(--success);">All candidates of ${escapeHTML(currentActiveExam)} are present! 🎉</td></tr>`;
            return;
        }

        absentStudents.forEach(s => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><code>${escapeHTML(s.barcode)}</code></td>
                <td><strong>${escapeHTML(s.name)}</strong></td>
                <td>${escapeHTML(s.roll || "-")}</td>
                <td>${escapeHTML(s.class || "-")}</td>
                <td><span style="color:var(--text-dim); font-weight:700;">✗ Absent</span></td>
                <td>${escapeHTML(s.phone || "-")}</td>
            `;
            tbody.appendChild(tr);
        });
    }
}

/* ================= 8. CANDIDATE DIRECTORY & SESSION FILTER / DELETE ================= */
function renderCandidateFilterDropdown() {
    const filterSelect = document.getElementById("candidateSessionFilter");
    if (!filterSelect) return;

    const sessions = getDistinctExamSessions();
    filterSelect.innerHTML = `<option value="ALL">Show All Sessions</option>`;

    sessions.forEach(sess => {
        const opt = document.createElement("option");
        opt.value = sess;
        opt.textContent = `Session: ${sess}`;
        if (sess === selectedCandidateFilter) opt.selected = true;
        filterSelect.appendChild(opt);
    });

    handleCandidateFilterChange(selectedCandidateFilter);
}

function handleCandidateFilterChange(val) {
    selectedCandidateFilter = val;
    const deleteBtn = document.getElementById("deleteSessionBtn");
    
    if (deleteBtn) {
        if (val !== "ALL" && val !== "") {
            deleteBtn.style.display = "inline-block";
            deleteBtn.textContent = `🗑️ Delete "${val}"`;
        } else {
            deleteBtn.style.display = "none";
        }
    }

    renderStudentDirectory();
}

function renderStudentDirectory() {
    const tbody = document.getElementById("studentCatalogRows");
    if (!tbody) return;
    tbody.innerHTML = "";

    let displayed = studentList;
    if (selectedCandidateFilter !== "ALL") {
        displayed = studentList.filter(s => s.examSession === selectedCandidateFilter);
    }

    const countBadge = document.getElementById("studentCountBadge");
    if (countBadge) countBadge.textContent = displayed.length;

    if (!displayed.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No candidates found in this session.</td></tr>`;
        return;
    }

    displayed.forEach(s => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><code>${escapeHTML(s.barcode)}</code></td>
            <td><span style="font-weight:700; color:var(--primary-red);">${escapeHTML(s.examSession)}</span></td>
            <td><strong>${escapeHTML(s.name)}</strong></td>
            <td>${escapeHTML(s.roll || "-")}</td>
            <td>${escapeHTML(s.class || "-")}</td>
            <td>${escapeHTML(s.school || "-")}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function deleteCurrentFilteredSession() {
    if (selectedCandidateFilter === "ALL" || !selectedCandidateFilter) return;

    const confirmMsg = `WARNING: Are you sure you want to permanently delete all student rosters of session "${selectedCandidateFilter}"? This cannot be undone!`;
    if (!confirm(confirmMsg)) return;

    const sessionToDelete = selectedCandidateFilter;

    try {
        const q = window.fs.query(
            window.fs.collection(window.firebaseDB, "students"),
            window.fs.where("examSession", "==", sessionToDelete)
        );
        const snap = await window.fs.getDocs(q);

        if (!snap.empty) {
            const batchChunk = 400;
            const docs = snap.docs;
            for (let i = 0; i < docs.length; i += batchChunk) {
                const chunk = docs.slice(i, i + batchChunk);
                const batch = window.fs.writeBatch(window.firebaseDB);
                chunk.forEach(d => batch.delete(d.ref));
                await batch.commit();
            }
        }

        studentList = studentList.filter(s => s.examSession !== sessionToDelete);
        alert(`Session "${sessionToDelete}" successfully removed from database.`);

        if (currentActiveExam === sessionToDelete) {
            const remaining = getDistinctExamSessions();
            currentActiveExam = remaining.length ? remaining[0] : "";
            await window.fs.setDoc(window.fs.doc(window.firebaseDB, "config", "activeExam"), { currentExam: currentActiveExam });
        }

        selectedCandidateFilter = "ALL";
        renderActiveExamDropdown();
        renderCandidateFilterDropdown();
        renderStudentDirectory();
        startRealTimeAttendanceWatch();

    } catch (err) {
        console.error("Delete session error:", err);
        alert("Failed to delete session: " + err.message);
    }
}

/* ================= 9. STRICT EXAM SPREADSHEET UPLOAD ================= */
async function uploadMasterSheet(evt) {
    const file = evt.target.files[0];
    if (!file) return;

    const examInput = document.getElementById("uploadExamNameInput");
    const rawName = examInput ? examInput.value.trim() : "";

    if (!rawName) {
        alert("ERROR: Exam Session Name is STRICTLY MANDATORY! Please enter a valid session name before uploading.");
        evt.target.value = "";
        return;
    }

    const examSession = rawName.replace(/[^a-zA-Z0-9_-]/g, "_");

    const notice = document.getElementById("uploadNotice");
    if (notice) {
        notice.textContent = `Validating & syncing records under "${examSession}"...`;
        notice.style.color = "var(--primary-red)";
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: "array" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

            if (!jsonRows || jsonRows.length === 0) {
                alert("Spreadsheet is empty!");
                return;
            }

            const formatted = jsonRows.map(normalizeSpreadsheet).filter(s => s.barcode && s.barcode !== "");

            if (formatted.length === 0) {
                alert("No valid Barcodes found! Ensure the first row has a 'Barcode' column.");
                return;
            }

            const batchChunk = 400;
            for (let i = 0; i < formatted.length; i += batchChunk) {
                const chunk = formatted.slice(i, i + batchChunk);
                const batch = window.fs.writeBatch(window.firebaseDB);
                chunk.forEach(item => {
                    item.examSession = examSession;
                    const docId = `${examSession}_${item.barcode}`;
                    const ref = window.fs.doc(window.firebaseDB, "students", docId);
                    batch.set(ref, item);
                });
                await batch.commit();
            }

            await handleExamSwitch(examSession);
            await loadMasterStudents();

            alert(`${formatted.length} students synchronized successfully for "${examSession}".`);
            if (notice) {
                notice.textContent = `Upload complete. Total: ${formatted.length} students under "${examSession}"`;
                notice.style.color = "var(--success)";
            }
            if (examInput) examInput.value = "";
            evt.target.value = "";

        } catch (err) {
            console.error(err);
            alert("Excel import failed: " + err.message);
        }
    };
    reader.readAsArrayBuffer(file);
}

function normalizeSpreadsheet(row) {
    const keys = Object.keys(row);

    const fetchCol = (matcherList, fallbackIndex = null) => {
        for (const k of keys) {
            const cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, '');
            for (const m of matcherList) {
                const cleanMatcher = m.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanKey.includes(cleanMatcher)) {
                    return String(row[k]).trim().replace(/\.0$/, "");
                }
            }
        }
        if (fallbackIndex !== null && keys[fallbackIndex] !== undefined) {
            return String(row[keys[fallbackIndex]]).trim().replace(/\.0$/, "");
        }
        return "";
    };

    return {
        barcode: fetchCol(["barcode", "bar code", "code", "studentid", "student id"], 0),
        name: fetchCol(["name", "student name", "student", "fullname"], 1),
        roll: fetchCol(["roll", "rollno", "roll no"], 2),
        class: fetchCol(["class", "std", "standard", "grade"], 3),
        school: fetchCol(["school", "institution", "college", "academy"], 4),
        phone: fetchCol(["phone", "contact", "mobile", "whatsapp"], 5)
    };
}

/* ================= 10. CLEAN EXCEL REPORT DOWNLOAD ================= */
function exportAttendanceData(type = "feed") {
    if (!currentActiveExam) {
        alert("No active exam session selected.");
        return;
    }

    const today = getTodayDate();
    const activeCandidates = getActiveExamCandidates();

    if (type === "feed") {
        if (!liveAttendanceList.length) {
            alert(`No attendance records found today for "${currentActiveExam}".`);
            return;
        }

        const payload = liveAttendanceList.map(r => ({
            Barcode: r.barcode,
            Name: r.name,
            Roll: r.roll || "-",
            Class: r.class || "-",
            School: r.school || "-",
            Exam_Session: currentActiveExam,
            Date: r.date,
            Time: r.time,
            Status: "Present",
            Phone: r.phone || ""
        }));

        const sheet = XLSX.utils.json_to_sheet(payload);
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, sheet, "Present_Feed");
        XLSX.writeFile(book, `Present_${currentActiveExam}_${today}.xlsx`);

    } else {
        const scannedSet = new Set(liveAttendanceList.map(r => String(r.barcode).trim()));
        const absentStudents = activeCandidates.filter(s => !scannedSet.has(String(s.barcode).trim()));

        if (!absentStudents.length) {
            alert(`All candidates of "${currentActiveExam}" are present! No absentees.`);
            return;
        }

        const payload = absentStudents.map(s => ({
            Barcode: s.barcode,
            Name: s.name,
            Roll: s.roll || "-",
            Class: s.class || "-",
            School: s.school || "-",
            Exam_Session: currentActiveExam,
            Date: today,
            Status: "Absent",
            Phone: s.phone || ""
        }));

        const sheet = XLSX.utils.json_to_sheet(payload);
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, sheet, "Absent_Candidates");
        XLSX.writeFile(book, `Absent_${currentActiveExam}_${today}.xlsx`);
    }
}

function getTodayDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function escapeHTML(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}