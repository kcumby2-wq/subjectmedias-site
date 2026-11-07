// After a direct Buy: the buyer tells us about their game.
//
// Each payment link sends the buyer back to /details?paid={CHECKOUT_SESSION_ID}
// (details.html, js/details.js), and their thanks email links there too.
//
//   GET  /api/details?session=cs_…   is this a paid checkout of ours, and do we
//                                    still need to hear about the game?
//   POST /api/details                the answers, for that checkout
//
// Both ask Stripe about the checkout first, so nobody can make up a payment:
// it has to be a one-time payment, paid. A checkout paid from the booking
// form's success panel names its request (client_reference_id), and the
// request already says where and when, so there's nothing to ask.
//
// The POST adds the buyer's answers to what the checkout says
// (api/_lib/stripe-booking.js) and posts it to the TOJ app's
// /api/sm/bookings/paid with details: true, the shared secret and the
// visitor's address. The app takes this and the webhook in either order, and
// the answers count once.
//
// Settings on this Vercel project: STRIPE_SECRET_KEY (a restricted key that can
// read checkouts), SM_BOOKINGS_SECRET, and SM_BOOKINGS_URL (optional), the
// same ones the webhook uses. Without them the page shows the email address.

const Stripe = require("stripe");
const { UUID, bookingFrom, productOf } = require("./_lib/stripe-booking");

const BOOKINGS_URL = process.env.SM_BOOKINGS_URL || "https://toj-csv-app.onrender.com/api/sm/bookings/paid";
const SESSION = /^cs_[A-Za-z0-9_]{8,200}$/;
const TIMEOUT_MS = 25000;
// What the form may say, and how long each answer can be.
const ANSWERS = { sport: 40, event_name: 120, event_date: 10, event_city: 80, event_state: 2, team_jersey: 60, athletes: 10, contact_phone: 40, notes: 1000 };

let makeStripe = (key) => new Stripe(key, { apiVersion: "2024-06-20" });

function bodyOf(req) {
  try {
    const b = req.body;
    return b && typeof b === "object" && !Array.isArray(b) && !Buffer.isBuffer(b) ? b : null;
  } catch (e) {
    return null; // not JSON
  }
}
const text = (v) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

// The checkout, if it's a paid one-time payment; null for anything else
// (no such checkout, a subscription, not paid yet).
async function paidCheckout(stripe, id) {
  if (!SESSION.test(id)) return null;
  let s;
  try {
    s = await stripe.checkout.sessions.retrieve(id);
  } catch (e) {
    if (e && (e.statusCode === 404 || e.code === "resource_missing")) return null;
    throw e;
  }
  if (!s || s.mode !== "payment" || s.payment_status !== "paid") return null;
  return s;
}
const forRequest = (s) => UUID.test(String(s.client_reference_id || ""));

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  const key = process.env.STRIPE_SECRET_KEY, shared = process.env.SM_BOOKINGS_SECRET;
  if (!key || !shared) {
    console.error("details: STRIPE_SECRET_KEY or SM_BOOKINGS_SECRET is missing");
    return res.status(503).json({ error: "unavailable" });
  }
  const stripe = makeStripe(key);

  if (req.method === "GET") {
    const id = text(req.query && req.query.session);
    try {
      const s = await paidCheckout(stripe, id);
      if (!s) return res.status(404).json({ error: "not_found" });
      if (forRequest(s)) return res.status(200).json({ status: "have_details" });
      return res.status(200).json({ status: "need_details", package: bookingFrom(s, await productOf(stripe, s.id)).package });
    } catch (e) {
      console.error("details: Stripe didn't answer:", e && e.message);
      return res.status(503).json({ error: "unavailable" });
    }
  }

  const body = bodyOf(req);
  if (!body) return res.status(400).json({ error: "invalid", fields: [] });
  let booking;
  try {
    const s = await paidCheckout(stripe, text(body.stripe_session_id));
    if (!s) return res.status(404).json({ error: "not_found" });
    if (forRequest(s)) return res.status(409).json({ error: "have_details" });
    booking = bookingFrom(s, await productOf(stripe, s.id));
  } catch (e) {
    console.error("details: Stripe didn't answer:", e && e.message);
    return res.status(503).json({ error: "unavailable" });
  }

  // Their answers win over what the checkout's own fields said; the checkout's
  // other fields stay in the notes, after theirs.
  for (const [k, max] of Object.entries(ANSWERS)) {
    const v = text(body[k]).trim().slice(0, max);
    if (k === "notes") continue;
    if (v) booking[k] = v;
  }
  const said = text(body.notes).trim();
  booking.notes = [said, booking.notes ? `From the checkout: ${booking.notes}` : ""].filter(Boolean).join("\n\n").slice(0, 1000);
  booking.booking_id = null;
  booking.details = true;
  booking.adult_confirmed = body.adult_confirmed === true;
  booking.company = text(body.company).slice(0, 100);

  const visitor = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(BOOKINGS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SM-Secret": shared, "X-SM-Visitor": visitor },
      body: JSON.stringify(booking),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return res.status(200).json({ ok: true, already: data.already === true });
    if (r.status === 400) return res.status(400).json({ error: "invalid", fields: Array.isArray(data.fields) ? data.fields.filter((f) => typeof f === "string") : [] });
    if (r.status === 429) return res.status(429).json({ error: "too_many" });
    console.error("details: the TOJ app answered", r.status);
    return res.status(503).json({ error: "unavailable" });
  } catch (e) {
    console.error("details: the TOJ app is unreachable:", e && e.name === "AbortError" ? "timed out" : e && e.message);
    return res.status(503).json({ error: "unavailable" });
  } finally {
    clearTimeout(timer);
  }
};

module.exports._test = { useStripe: (f) => { makeStripe = f; } };
