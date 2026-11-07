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
// it has to be a one-time payment on one of the site's payment links (never a
// marketplace checkout), and paid. A bank payment that hasn't cleared yet is
// "processing": its thanks email brings the link once it clears. A checkout
// paid from the booking form's success panel names its request
// (client_reference_id), and the request already says where and when.
//
// The POST sends the booking the checkout describes (api/_lib/stripe-booking.js)
// with the buyer's answers on top, to the TOJ app's /api/sm/bookings/paid with
// details: true, the shared secret and the visitor's address. The checkout's
// own leftover fields go apart (checkout_notes), so the app can keep them once
// whichever of this and the webhook arrives second. The app takes the two in
// either order, and the answers count once.
//
// Each visitor (Vercel's own address for them) gets 20 calls in 10 minutes on
// each running copy of this function, before anything reaches Stripe.
//
// Settings on this Vercel project: STRIPE_SECRET_KEY (a restricted key that can
// read checkouts), SM_BOOKINGS_SECRET, and SM_BOOKINGS_URL (optional), the
// same ones the webhook uses. Without them the page shows the email address.

const Stripe = require("stripe");
const { UUID, clip, fromPaymentLink, bookingFrom, productOf } = require("./_lib/stripe-booking");

const BOOKINGS_URL = process.env.SM_BOOKINGS_URL || "https://toj-csv-app.onrender.com/api/sm/bookings/paid";
const SESSION = /^cs_[A-Za-z0-9_]{8,200}$/;
const TIMEOUT_MS = 25000;
// What the form may say, and how long each answer can be.
const ANSWERS = { sport: 40, event_name: 120, event_date: 10, event_city: 80, event_state: 2, team_jersey: 60, athletes: 10, contact_phone: 40 };
const PER_VISITOR = 20;
const WINDOW_MS = 10 * 60 * 1000;
const tries = new Map();

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
const visitorOf = (req) => String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim();

function allowed(who, now = Date.now()) {
  const t = tries.get(who);
  if (!t || now > t.reset) {
    if (tries.size > 10000) tries.clear();
    tries.set(who, { n: 1, reset: now + WINDOW_MS });
    return true;
  }
  return ++t.n <= PER_VISITOR;
}

// "paid", "processing" (a bank payment not cleared yet), or null for anything
// that isn't a paid checkout of ours, with the checkout.
async function checkout(stripe, id) {
  if (!SESSION.test(id)) return { state: null };
  let s;
  try {
    s = await stripe.checkout.sessions.retrieve(id);
  } catch (e) {
    if (e && (e.statusCode === 404 || e.code === "resource_missing")) return { state: null };
    throw e;
  }
  if (!s || s.mode !== "payment" || !fromPaymentLink(s)) return { state: null };
  if (s.payment_status === "paid") return { state: "paid", s };
  if (s.status === "complete" && s.payment_status === "unpaid") return { state: "processing", s };
  return { state: null };
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
  const visitor = visitorOf(req);
  if (!allowed(visitor)) return res.status(429).json({ error: "too_many" });
  const stripe = makeStripe(key);

  if (req.method === "GET") {
    const id = text(req.query && req.query.session);
    try {
      const { state, s } = await checkout(stripe, id);
      if (!state) return res.status(404).json({ error: "not_found" });
      if (forRequest(s)) return res.status(200).json({ status: "have_details" });
      if (state === "processing") return res.status(200).json({ status: "processing" });
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
    const { state, s } = await checkout(stripe, text(body.stripe_session_id));
    if (!state) return res.status(404).json({ error: "not_found" });
    if (forRequest(s)) return res.status(409).json({ error: "have_details" });
    if (state === "processing") return res.status(409).json({ error: "processing" });
    booking = bookingFrom(s, await productOf(stripe, s.id));
  } catch (e) {
    console.error("details: Stripe didn't answer:", e && e.message);
    return res.status(503).json({ error: "unavailable" });
  }

  // Their answers win over what the checkout's own fields said. The checkout's
  // other fields go apart, for the app to keep once.
  for (const [k, max] of Object.entries(ANSWERS)) {
    const v = clip(text(body[k]).trim(), max);
    if (v) booking[k] = v;
  }
  booking.checkout_notes = booking.notes || "";
  booking.notes = clip(text(body.notes).trim(), 1000);
  booking.booking_id = null;
  booking.details = true;
  booking.adult_confirmed = body.adult_confirmed === true;
  booking.company = clip(text(body.company), 100);

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

module.exports._test = { useStripe: (f) => { makeStripe = f; }, reset: () => tries.clear() };
