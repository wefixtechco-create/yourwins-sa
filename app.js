import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, getDoc,
  getDocs, onSnapshot, query, where, orderBy, limit, serverTimestamp,
  runTransaction, getDocChanges
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

// ═══════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "yourwins-sa.firebaseapp.com",
  projectId: "yourwins-sa",
  storageBucket: "yourwins-sa.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const PAYSTACK_PUBLIC_KEY = "pk_live_YOUR_PAYSTACK_PUBLIC_KEY";

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// ═══════════════════════════════════════════════
// DRAW CONFIGURATIONS
// ═══════════════════════════════════════════════
const DRAWS = {
  community: {
    name: "Community Draw",
    price: 20,
    minEntries: 20,
    maxEntries: 25,
    maxPerPerson: 5,
    schedule: "daily",       // runs daily at 18:00 SAST
    time: "18:00",
    day: null
  },
  vip: {
    name: "VIP Draw",
    price: 150,
    minEntries: 15,
    maxEntries: 20,
    maxPerPerson: 1,
    schedule: "weekly",      // runs Saturday at 20:00 SAST
    time: "20:00",
    day: 6                   // Saturday
  },
  mega: {
    name: "MEGA Draw",
    price: 350,
    minEntries: 10,
    maxEntries: 15,
    maxPerPerson: 1,
    schedule: "monthly",     // runs last Friday at 20:00 SAST
    time: "20:00",
    day: 5                   // Friday
  }
};

const PRIZE_RATIO = 0.60;

// ═══════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════
const $ = (id) => document.getElementById(id);
const fmt = (n) => "R" + n.toLocaleString("en-ZA");

function getNextDrawTime(drawKey) {
  const now = new Date();
  const cfg = DRAWS[drawKey];
  const [h, m] = cfg.time.split(":").map(Number);

  if (cfg.schedule === "daily") {
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }

  if (cfg.schedule === "weekly") {
    const next = new Date(now);
    const dayDiff = (cfg.day - now.getDay() + 7) % 7;
    next.setDate(next.getDate() + dayDiff);
    next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 7);
    return next;
  }

  if (cfg.schedule === "monthly") {
    // Last Friday of the month
    const year = now.getFullYear();
    const month = now.getMonth();
    // Find last Friday
    let lastDay = new Date(year, month + 1, 0); // last day of month
    let lastFriday = new Date(lastDay);
    while (lastFriday.getDay() !== 5) lastFriday.setDate(lastFriday.getDate() - 1);
    lastFriday.setHours(h, m, 0, 0);

    if (lastFriday > now) return lastFriday;
    // Next month
    let nextMonthLastDay = new Date(year, month + 2, 0);
    let nextFriday = new Date(nextMonthLastDay);
    while (nextFriday.getDay() !== 5) nextFriday.setDate(nextFriday.getDate() - 1);
    nextFriday.setHours(h, m, 0, 0);
    return nextFriday;
  }
}

function getCountdown(target) {
  const diff = target - new Date();
  if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0 };
  return {
    d: Math.floor(diff / 86400000),
    h: Math.floor((diff % 86400000) / 3600000),
    m: Math.floor((diff % 3600000) / 60000),
    s: Math.floor((diff % 60000) / 1000)
  };
}

// ═══════════════════════════════════════════════
// PAGE NAVIGATION
// ═══════════════════════════════════════════════
function showPage(pageId) {
  $("page-landing").classList.add("hidden");
  $("page-admin").classList.add("hidden");
  $(pageId).classList.remove("hidden");
}

// ═══════════════════════════════════════════════
// MODAL HELPERS
// ═══════════════════════════════════════════════
function openModal(id) { $(id).classList.remove("hidden"); }
function closeModal(id) { $(id).classList.add("hidden"); }

document.querySelectorAll(".modal-close").forEach(btn => {
  btn.addEventListener("click", () => closeModal(btn.dataset.close));
});
document.querySelectorAll(".modal").forEach(m => {
  m.addEventListener("click", (e) => { if (e.target === m) m.classList.add("hidden"); });
});

// ═══════════════════════════════════════════════
// LANDING PAGE – DRAW CARDS
// ═══════════════════════════════════════════════
let drawData = {};

onSnapshot(query(collection(db, "draws"), where("status", "in", ["open", "active"])), (snap) => {
  snap.forEach((d) => { drawData[d.id] = d.data(); });
  renderDrawCards();
});

function renderDrawCards() {
  const container = $("draws-container");
  container.innerHTML = "";

  for (const [key, cfg] of Object.entries(DRAWS)) {
    // Find the active draw for this type
    const activeDraw = Object.values(drawData).find(d => d.drawType === key && d.status === "open");
    const nextTime = getNextDrawTime(key);
    const cd = getCountdown(nextTime);

    const entries = activeDraw ? (activeDraw.paidCount || 0) + (activeDraw.freeVerifiedCount || 0) : 0;
    const pot = activeDraw ? (activeDraw.paidCount || 0) * cfg.price : 0;
    const prize = Math.round(pot * PRIZE_RATIO);

    const card = document.createElement("div");
    card.className = "draw-card";
    card.innerHTML = `
      <div class="draw-type">${cfg.name}</div>
      <h3>${fmt(cfg.price)} Entry</h3>
      <div class="countdown" data-draw="${key}">
        <div class="cd-block"><span class="cd-num">${cd.d}</span><span class="cd-label">Days</span></div>
        <div class="cd-block"><span class="cd-num">${String(cd.h).padStart(2,'0')}</span><span class="cd-label">Hrs</span></div>
        <div class="cd-block"><span class="cd-num">${String(cd.m).padStart(2,'0')}</span><span class="cd-label">Min</span></div>
        <div class="cd-block"><span class="cd-num">${String(cd.s).padStart(2,'0')}</span><span class="cd-label">Sec</span></div>
      </div>
      <div class="draw-meta">
        <div class="meta-item"><div class="meta-val">${fmt(pot)}</div><div class="meta-lbl">Pot</div></div>
        <div class="meta-item"><div class="meta-val">${fmt(prize)}</div><div class="meta-lbl">Prize (60%)</div></div>
        <div class="meta-item"><div class="meta-val">${entries}/${cfg.maxEntries}</div><div class="meta-lbl">Entries</div></div>
      </div>
      <div class="btn-row">
        <button class="btn-gold" onclick="openPaidModal('${key}')">Enter – ${fmt(cfg.price)}</button>
        <button class="btn-outline" onclick="openFreeModal('${key}')">Free Entry</button>
      </div>
    `;
    container.appendChild(card);
  }
}

// Update countdowns every second
setInterval(() => {
  document.querySelectorAll(".countdown").forEach(el => {
    const key = el.dataset.draw;
    const cd = getCountdown(getNextDrawTime(key));
    const blocks = el.querySelectorAll(".cd-num");
    blocks[0].textContent = cd.d;
    blocks[1].textContent = String(cd.h).padStart(2, '0');
    blocks[2].textContent = String(cd.m).padStart(2, '0');
    blocks[3].textContent = String(cd.s).padStart(2, '0');
  });
}, 1000);

// ═══════════════════════════════════════════════
// PAID ENTRY FLOW
// ═══════════════════════════════════════════════
let currentDrawKey = null;

window.openPaidModal = (drawKey) => {
  currentDrawKey = drawKey;
  $("paid-draw-name").textContent = DRAWS[drawKey].name;
  $("paid-price").textContent = fmt(DRAWS[drawKey].price);
  openModal("modal-paid");
};

$("paid-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = {
    name: form.name.value,
    idNumber: form.idNumber.value,
    email: form.email.value,
    phone: form.phone.value,
    drawKey: currentDrawKey,
    price: DRAWS[currentDrawKey].price
  };

  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Opening Payment...";

  // Open Paystack popup
  const handler = PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email: data.email,
    amount: data.price * 100,  // ZAR in cents
    currency: "ZAR",
    ref: "YW_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9),
    metadata: {
      custom_fields: [
        { display_name: "Full Name", variable_name: "full_name", value: data.name },
        { display_name: "ID Number", variable_name: "id_number", value: data.idNumber },
        { display_name: "Phone", variable_name: "phone", value: data.phone },
        { display_name: "Draw", variable_name: "draw", value: currentDrawKey }
      ]
    },
    callback: async (response) => {
      // Payment successful – verify server-side via Cloud Function
      try {
        const verifyFn = httpsCallable(app, "verifyPayment");
        const result = await verifyFn({
          reference: response.reference,
          name: data.name,
          idNumber: data.idNumber,
          email: data.email,
          phone: data.phone,
          drawKey: currentDrawKey,
          price: data.price
        });
        alert("✅ Entry confirmed! You're in the draw.");
        closeModal("modal-paid");
        form.reset();
      } catch (err) {
        alert("⚠️ Payment made but entry verification failed. Contact support.");
        console.error(err);
      }
    },
    onClose: () => {
      btn.disabled = false;
      btn.textContent = "Pay & Enter →";
    }
  });
  handler.openIframe();
});

// ═══════════════════════════════════════════════
// FREE ENTRY FLOW
// ═══════════════════════════════════════════════
window.openFreeModal = (drawKey) => {
  currentDrawKey = drawKey;
  $("free-draw-name").textContent = DRAWS[drawKey].name;
  openModal("modal-free");
};

$("free-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = {
    name: form.name.value,
    idNumber: form.idNumber.value,
    email: form.email.value,
    phone: form.phone.value,
    drawKey: currentDrawKey,
    status: "free_pending",
    createdAt: serverTimestamp()
  };

  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "Submitting...";

  try {
    // Check if user already has a free entry today (community only)
    if (currentDrawKey === "community") {
      const today = new Date().toISOString().split("T")[0];
      const existing = await getDocs(query(
        collection(db, "entries"),
        where("drawKey", "==", "community"),
        where("idNumber", "==", data.idNumber),
        where("status", "in", ["free_pending", "free_verified"]),
        where("dateStr", "==", today)
      ));
      if (!existing.empty) {
        alert("You already have a free entry for today's Community Draw.");
        btn.disabled = false;
        btn.textContent = "Submit Free Entry";
        return;
      }
    }

    const entryRef = doc(collection(db, "entries"));
    await addDoc(collection(db, "entries"), {
      ...data,
      dateStr: new Date().toISOString().split("T")[0],
      entryRef: entryRef.id
    });

    // Trigger Cloud Function to email admin
    const notifyFn = httpsCallable(app, "notifyFreeEntry");
    await notifyFn({
      name: data.name,
      email: data.email,
      phone: data.phone,
      drawKey: currentDrawKey,
      entryId: entryRef.id
    });

    alert("✅ Free entry submitted! Status: PENDING. You'll be notified once verified.");
    closeModal("modal-free");
    form.reset();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit Free Entry";
  }
});

// ═══════════════════════════════════════════════
// SPIN WHEEL
// ═══════════════════════════════════════════════
let wheelNames = [];
let wheelSpinning = false;

async function openWheel(drawId) {
  const drawSnap = await getDoc(doc(db, "draws", drawId));
  const draw = drawSnap.data();
  $("wheel-draw-name").textContent = draw.name;
  $("winner-reveal").classList.add("hidden");
  $("spin-btn").disabled = true;
  $("spin-btn").textContent = "Loading entries...";

  // Get all PAID + free_verified entries for this draw
  const entriesSnap = await getDocs(query(
    collection(db, "entries"),
    where("drawId", "==", drawId),
    where("status", "in", ["PAID", "free_verified"])
  ));

  wheelNames = entriesSnap.docs.map(d => d.data().name);

  if (wheelNames.length === 0) {
    alert("No eligible entries!");
    return;
  }

  drawWheel(wheelNames);
  $("spin-btn").disabled = false;
  $("spin-btn").textContent = "SPIN";
  openModal("modal-wheel");
}

function drawWheel(names) {
  const canvas = $("spin-wheel");
  const ctx = canvas.getContext("2d");
  const cx = 150, cy = 150, r = 140;
  const slice = (2 * Math.PI) / names.length;

  ctx.clearRect(0, 0, 300, 300);

  // Draw segments
  const colors = ["#1a1a1a", "#2a2000", "#1a1a1a", "#2a2000"];
  names.forEach((name, i) => {
    const start = i * slice - Math.PI / 2;
    const end = start + slice;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    ctx.strokeStyle = "#d4af37";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Text
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + slice / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#d4af37";
    ctx.font = "bold 10px sans-serif";
    const displayName = name.length > 12 ? name.slice(0, 12) + "…" : name;
    ctx.fillText(displayName, r - 10, 4);
    ctx.restore();
  });

  // Center circle
  ctx.beginPath();
  ctx.arc(cx, cy, 25, 0, 2 * Math.PI);
  ctx.fillStyle = "#d4af37";
  ctx.fill();
  ctx.fillStyle = "#0a0a0a";
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("WIN", cx, cy + 4);
}

$("spin-btn").addEventListener("click", () => {
  if (wheelSpinning || wheelNames.length === 0) return;
  wheelSpinning = true;
  $("spin-btn").disabled = true;
  $("spin-btn").textContent = "Spinning...";

  const canvas = $("spin-wheel");
  const ctx = canvas.getContext("2d");
  let rotation = 0;
  const totalRotation = 360 * 5 + Math.random() * 360; // 5+ full spins
  const duration = 4000; // 4 seconds
  const start = performance.now();

  function animate(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const ease = 1 - Math.pow(1 - progress, 3);
    rotation = totalRotation * ease;

    ctx.save();
    ctx.clearRect(0, 0, 300, 300);
    ctx.translate(150, 150);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-150, -150);

    // Redraw wheel
    const slice = (2 * Math.PI) / wheelNames.length;
    const colors = ["#1a1a1a", "#2a2000", "#1a1a1a", "#2a2000"];
    wheelNames.forEach((name, i) => {
      const s = i * slice - Math.PI / 2;
      const e = s + slice;
      ctx.beginPath();
      ctx.moveTo(150, 150);
      ctx.arc(150, 150, 140, s, e);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.save();
      ctx.translate(150, 150);
      ctx.rotate(s + slice / 2);
      ctx.textAlign = "right";
      ctx.fillStyle = "#d4af37";
      ctx.font = "bold 10px sans-serif";
      ctx.fillText(name.length > 12 ? name.slice(0, 12) + "…" : name, 130, 4);
      ctx.restore();
    });

    // Center
    ctx.beginPath();
    ctx.arc(150, 150, 25, 0, 2 * Math.PI);
    ctx.fillStyle = "#d4af37";
    ctx.fill();
    ctx.fillStyle = "#0a0a0a";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("WIN", 150, 154);
    ctx.restore();

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // Determine winner
      const finalAngle = (rotation % 360) * (Math.PI / 180);
      const pointerAngle = -Math.PI / 2; // top
      const relativeAngle = (pointerAngle - finalAngle + 2 * Math.PI * 10) % (2 * Math.PI);
      const slice = (2 * Math.PI) / wheelNames.length;
      const winnerIndex = Math.floor(relativeAngle / slice) % wheelNames.length;
      const winner = wheelNames[winnerIndex];

      // Show winner
      $("winner-name").textContent = winner;
      const drawSnap = drawData[Object.keys(drawData).find(k => drawData[k].name === $("wheel-draw-name").textContent)];
      const pot = drawSnap ? (drawSnap.paidCount || 0) * DRAWS[Object.keys(DRAWS).find(k => DRAWS[k].name === $("wheel-draw-name").textContent)].price : 0;
      $("winner-prize").textContent = `Prize: ${fmt(Math.round(pot * PRIZE_RATIO))}`;
      $("winner-reveal").classList.remove("hidden");
      $("spin-btn").textContent = "SPIN AGAIN";
      $("spin-btn").disabled = false;
      wheelSpinning = false;
    }
  }

  requestAnimationFrame(animate);
});

// ═══════════════════════════════════════════════
// ADMIN AUTH
// ═══════════════════════════════════════════════
$("admin-login-btn").addEventListener("click", (e) => {
  e.preventDefault();
  openModal("modal-admin-login");
});

$("admin-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = e.target.email.value;
  const password = e.target.password.value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    closeModal("modal-admin-login");
    showPage("page-admin");
    initAdmin();
  } catch {
    alert("Login failed");
  }
});

$("admin-logout").addEventListener("click", async () => {
  await signOut(auth);
  showPage("page-landing");
});

onAuthStateChanged(auth, (user) => {
  if (user && !$("page-admin").classList.contains("hidden")) {
    // Stay on admin
  }
});

// ═══════════════════════════════════════════════
// ADMIN DASHBOARD
// ═══════════════════════════════════════════════
let adminSubs = [];

function initAdmin() {
  // Clean up old subscriptions
  adminSubs.forEach(unsub => unsub());
  adminSubs = [];

  // Stats
  adminSubs.push(onSnapshot(query(collection(db, "entries")), (snap) => {
    let totalEntries = 0, totalPot = 0, pendingFree = 0;
    snap.forEach((d) => {
      const data = d.data();
      totalEntries++;
      if (data.status === "PAID") totalPot += data.price || 0;
      if (data.status === "free_pending") pendingFree++;
    });
    $("stat-total-pot").textContent = fmt(totalPot);
    $("stat-total-entries").textContent = totalEntries;
    $("stat-pending-free").textContent = pendingFree;
  }));

  // Admin draws list
  adminSubs.push(onSnapshot(collection(db, "draws"), (snap) => {
    const list = $("admin-draws-list");
    list.innerHTML = "";
    snap.forEach((d) => {
      const data = d.data();
      const el = document.createElement("div");
      el.className = "admin-draw-card";
      el.innerHTML = `
        <div class="draw-info">
          <div>
            <strong>${data.name}</strong> <span class="badge badge-${data.status}">${data.status}</span>
          </div>
          <div>
            <span class="text-green">${fmt((data.paidCount||0) * (data.price||0))}</span>
            &nbsp;|&nbsp;
            ${data.paidCount||0} paid + ${data.freeVerifiedCount||0} free verified
          </div>
        </div>
        <div class="draw-actions">
          ${data.status === "open" ? `<button class="btn-sm btn-gold" onclick="adminCloseDraw('${d.id}')">Close Draw</button>` : ""}
          ${data.status === "closed" ? `<button class="btn-sm btn-gold" onclick="openWheel('${d.id}')">🎡 Spin Wheel</button>
            <button class="btn-sm btn-outline" onclick="adminManualWinner('${d.id}')">Manual Winner</button>` : ""}
          ${data.status === "drawn" ? `<span class="text-gold">Winner: ${data.winnerName || "TBD"}</span>` : ""}
        </div>
      `;
      list.appendChild(el);
    });
  }));

  // Free entries pending
  adminSubs.push(onSnapshot(query(collection(db, "entries"), where("status", "==", "free_pending")), (snap) => {
    const list = $("free-entries-list");
    list.innerHTML = "";
    if (snap.empty) {
      list.innerHTML = "<p class='text-muted'>No pending free entries.</p>";
      return;
    }
    snap.forEach((d) => {
      const data = d.data();
      const el = document.createElement("div");
      el.className = "entry-item";
      el.innerHTML = `
        <div class="entry-info">
          <p><strong>${data.name}</strong> · ${data.phone} · ${data.email}</p>
          <p>ID: ${data.idNumber} · Draw: ${DRAWS[data.drawKey]?.name || data.drawKey}</p>
        </div>
        <div class="entry-actions">
          <button class="btn-sm btn-gold" onclick="approveFree('${d.id}')">✓ Verify</button>
          <button class="btn-sm btn-danger" onclick="declineFree('${d.id}')">✕ Decline</button>
        </div>
      `;
      list.appendChild(el);
    });
  }));

  // All entries table
  loadEntriesTable();

  // Top players
  loadTopPlayers();

  // Announcement
  adminSubs.push(onSnapshot(doc(db, "config", "announcement"), (snap) => {
    if (snap.exists && snap.data().text) {
      $("announcement-bar").textContent = snap.data().text;
      $("announcement-bar").classList.remove("hidden");
    } else {
      $("announcement-bar").classList.add("hidden");
    }
  }));
}

function loadEntriesTable() {
  adminSubs.push(onSnapshot(collection(db, "entries"), (snap) => {
    const tbody = $("entries-table").querySelector("tbody");
    tbody.innerHTML = "";
    const filterDraw = $("filter-draw").value;
    const filterStatus = $("filter-status").value;

    snap.forEach((d) => {
      const data = d.data();
      if (filterDraw && data.drawKey !== filterDraw) return;
      if (filterStatus && data.status !== filterStatus) return;

      const tr = document.createElement("tr");
      const badgeClass = data.status === "PAID" ? "badge-paid" :
                         data.status === "free_verified" ? "badge-verified" :
                         data.status === "free_pending" ? "badge-pending" : "badge-declined";
      tr.innerHTML = `
        <td>${data.name}</td>
        <td>${data.idNumber}</td>
        <td>${data.phone}</td>
        <td>${DRAWS[data.drawKey]?.name || data.drawKey}</td>
        <td><span class="badge ${badgeClass}">${data.status}</span></td>
        <td>${data.createdAt?.toDate()?.toLocaleDateString() || ""}</td>
        <td><button class="btn-sm btn-danger" onclick="removeEntry('${d.id}')">Remove</button></td>
      `;
      tbody.appendChild(tr);
    });
  }));
}

$("filter-draw").addEventListener("change", loadEntriesTable);
$("filter-status").addEventListener("change", loadEntriesTable);

function loadTopPlayers() {
  // Aggregate by idNumber
  adminSubs.push(onSnapshot(query(collection(db, "entries")), (snap) => {
    const counts = {};
    snap.forEach((d) => {
      const data = d.data();
      if (data.status === "PAID" || data.status === "free_verified") {
        const key = data.idNumber;
        if (!counts[key]) counts[key] = { name: data.name, count: 0, total: 0 };
        counts[key].count++;
        counts[key].total += data.price || 0;
      }
    });
    const sorted = Object.values(counts).sort((a, b) => b.total - a.total).slice(0, 10);
    const list = $("top-players-list");
    list.innerHTML = "";
    sorted.forEach((p, i) => {
      const el = document.createElement("div");
      el.className = "top-player";
      el.innerHTML = `
        <span class="rank">#${i + 1}</span>
        <span>${p.name} (${p.count} entries)</span>
        <span class="text-gold">${fmt(p.total)}</span>
      `;
      list.appendChild(el);
    });
  }));
}

// ═══════════════════════════════════════════════
// ADMIN ACTIONS
// ═══════════════════════════════════════════════
window.adminCloseDraw = async (drawId) => {
  if (!confirm("Close this draw? No more entries will be accepted.")) return;
  await updateDoc(doc(db, "draws", drawId), { status: "closed" });
};

window.approveFree = async (entryId) => {
  await updateDoc(doc(db, "entries", entryId), { status: "free_verified", verifiedAt: serverTimestamp() });
  // Update draw counts
  const entrySnap = await getDoc(doc(db, "entries", entryId));
  const drawId = entrySnap.data().drawId;
  if (drawId) {
    const drawRef = doc(db, "draws", drawId);
    const drawSnap = await getDoc(drawRef);
    if (drawSnap.exists) {
      await updateDoc(drawRef, {
        freeVerifiedCount: (drawSnap.data().freeVerifiedCount || 0) + 1
      });
    }
  }
};

window.declineFree = async (entryId) => {
  await updateDoc(doc(db, "entries", entryId), { status: "DECLINED" });
};

window.removeEntry = async (entryId) => {
  if (!confirm("Remove this entry? This cannot be undone.")) return;
  await updateDoc(doc(db, "entries", entryId), { status: "REMOVED" });
};

window.adminManualWinner = async (drawId) => {
  const name = prompt("Enter winner name:");
  if (!name) return;
  await updateDoc(doc(db, "draws", drawId), {
    status: "drawn",
    winnerName: name,
    manualWinner: true
  });
  alert(`Winner set: ${name}`);
};

// Announcement
$("set-announcement").addEventListener("click", async () => {
  const text = $("announcement-text").value;
  if (!text) return;
  await updateDoc(doc(db, "config", "announcement"), { text, updatedAt: serverTimestamp() });
});

$("clear-announcement").addEventListener("click", async () => {
  await updateDoc(doc(db, "config", "announcement"), { text: "" });
});

// CSV Export
$("export-csv").addEventListener("click", async () => {
  const snap = await getDocs(collection(db, "entries"));
  let csv = "Name,ID Number,Email,Phone,Draw,Status,Date\n";
  snap.forEach((d) => {
    const data = d.data();
    csv += `"${data.name}","${data.idNumber}","${data.email}","${data.phone}","${DRAWS[data.drawKey]?.name || data.drawKey}","${data.status}","${data.createdAt?.toDate()?.toISOString() || ""}"\n`;
  });
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `yourwins-entries-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════
showPage("page-landing");
renderDrawCards();
