const functions = require("firebase-functions");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();
const db = admin.firestore();

// ── Paystack Verification ──────────────────────────────────
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@yourwins.co.za";
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || "admin@yourwins.co.za";

// Email transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

// ── Verify Payment (called from frontend after Paystack callback) ──
exports.verifyPayment = functions.https.onCall(async (data) => {
  const { reference, name, idNumber, email, phone, drawKey, price } = data;

  // 1. Verify with Paystack
  const response = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
  );
  const result = await response.json();

  if (!result.status || result.data.status !== "success") {
    throw new Error("Payment verification failed");
  }

  // 2. Get the active draw for this type
  const drawsSnap = await db.collection("draws").where("drawType", "==", drawKey).where("status", "==", "open").limit(1).get();

  if (drawsSnap.empty) {
    throw new Error("No active draw found for this type");
  }

  const drawDoc = drawsSnap.docs[0];
  const drawData = drawDoc.data();

  // 3. Check max entries
  const totalEntries = (drawData.paidCount || 0) + (drawData.freeVerifiedCount || 0);
  if (totalEntries >= drawData.maxEntries) {
    throw new Error("Draw is full");
  }

  // 4. Check max per person
  const personEntries = await db.collection("entries")
    .where("drawId", "==", drawDoc.id)
    .where("idNumber", "==", idNumber)
    .where("status", "in", ["PAID", "free_verified"])
    .get();

  if (personEntries.size >= drawData.maxPerPerson) {
    throw new Error(`Max ${drawData.maxPerPerson} entr${drawData.maxPerPerson > 1 ? "ies" : "y"} per person reached`);
  }

  // 5. Write entry + update draw (transaction)
  await db.runTransaction(async (tx) => {
    const entryRef = db.collection("entries").doc();
    tx.set(entryRef, {
      name, idNumber, email, phone,
      drawKey, drawId: drawDoc.id,
      price,
      status: "PAID",
      paystackRef: reference,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      dateStr: new Date().toISOString().split("T")[0]
    });

    const newPaidCount = (drawData.paidCount || 0) + 1;
    const newPot = (drawData.pot || 0) + price;
    tx.update(drawDoc.ref, {
      paidCount: newPaidCount,
      pot: newPot,
      prize: Math.round(newPot * 0.60),
      adminCut: Math.round(newPot * 0.40)
    });
  });

  // 6. Notify admin via email
  await transporter.sendMail({
    from: process.env.MAIL_USER,
    to: ADMIN_NOTIFY_EMAIL,
    subject: `🎰 New Paid Entry – ${drawData.name}`,
    html: `
      <h3>New Paid Entry</h3>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>ID:</strong> ${idNumber}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Draw:</strong> ${drawData.name}</p>
      <p><strong>Amount:</strong> R${price}</p>
      <p><strong>Paystack Ref:</strong> ${reference}</p>
    `
  });

  return { success: true, reference };
});

// ── Notify Admin of Free Entry ─────────────────────────────
exports.notifyFreeEntry = functions.https.onCall(async (data) => {
  const { name, email, phone, drawKey, entryId } = data;

  const drawNames = { community: "Community Draw", vip: "VIP Draw", mega: "MEGA Draw" };

  await transporter.sendMail({
    from: process.env.MAIL_USER,
    to: ADMIN_NOTIFY_EMAIL,
    subject: `📋 New Free Entry Request – ${drawNames[drawKey] || drawKey}`,
    html: `
      <h3>Free Entry Request</h3>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Draw:</strong> ${drawNames[drawKey] || drawKey}</p>
      <p><strong>Entry ID:</strong> ${entryId}</p>
      <p style="color:#666">Please verify via Admin Dashboard.</p>
    `
  });

  return { success: true };
});

// ── Scheduled: Auto-close draws at draw time ───────────────
exports.autoCloseDraws = functions.pubsub.schedule("every 30 minutes").onRun(async () => {
  const now = new Date();
  const drawsSnap = await db.collection("draws").where("status", "==", "open").get();

  for (const doc of drawsSnap.docs) {
    const data = doc.data();
    const drawDate = data.drawDate?.toDate();
    if (drawDate && drawDate <= now) {
      await doc.ref.update({ status: "closed", closedAt: admin.firestore.FieldValue.serverTimestamp() });
      console.log(`Auto-closed draw: ${data.name}`);
    }
  }
});
