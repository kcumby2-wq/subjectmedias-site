// Stripe → a booking in the TOJ app, so every paid package alerts Kyron.
//
// Stripe calls this when a checkout on one of the site's payment links is paid
// (events checkout.session.completed and checkout.session.async_payment_succeeded).
// It checks Stripe's signature, works out the package, and posts the booking
// to the TOJ app's /api/sm/bookings/paid with the shared secret. A checkout
// opened from the booking form's success panel carries the request's id
// (client_reference_id), and the payment joins that request. If the app can't
// take it, this answers 502 and Stripe tries again later; the app treats a
// repeat of the same checkout as already done.
//
// Settings on this Vercel project:
//   STRIPE_SECRET_KEY      a restricted key that can read checkouts (Kyron adds it)
//   STRIPE_WEBHOOK_SECRET  the signing secret Stripe shows for this endpoint
//   SM_BOOKINGS_SECRET     the same value as on the TOJ app's Render service
//   SM_BOOKINGS_URL        optional; defaults to the TOJ app's Render address
//
// What the checkout says about the booking: api/_lib/stripe-booking.js.
//
// The raw body is read from the request stream (Vercel's helpers keep it
// readable), never from req.body: Stripe signs the exact bytes.

const Stripe = require("stripe");
const { checkoutFields, personal, isoDate, stateCode, cityState, packageFor, bookingFrom, productOf, fromPaymentLink } = require("./_lib/stripe-booking");

const BOOKINGS_URL = process.env.SM_BOOKINGS_URL || "https://toj-csv-app.onrender.com/api/sm/bookings/paid";

let makeStripe = (key) => new Stripe(key, { apiVersion: "2024-06-20" });

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  const key = process.env.STRIPE_SECRET_KEY, signing = process.env.STRIPE_WEBHOOK_SECRET, shared = process.env.SM_BOOKINGS_SECRET;
  if (!key || !signing || !shared) {
    console.error("stripe-webhook: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET or SM_BOOKINGS_SECRET is missing");
    return res.status(500).json({ error: "not_configured" });
  }
  const stripe = makeStripe(key);

  let event;
  try {
    event = stripe.webhooks.constructEvent(await rawBody(req), req.headers["stripe-signature"], signing);
  } catch (e) {
    return res.status(400).json({ error: "bad_signature" });
  }
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return res.status(200).json({ ignored: event.type });
  }
  const s = event.data.object;
  // A subscription or a saved card isn't a booking.
  if (s.mode && s.mode !== "payment") return res.status(200).json({ ignored: "not_a_payment" });
  // Nor is a checkout that isn't on one of the site's payment links: clips
  // from the marketplace (the TOJ app's own webhook takes those).
  if (!fromPaymentLink(s)) return res.status(200).json({ ignored: "not_a_payment_link" });
  // A bank payment that hasn't cleared arrives again as async_payment_succeeded.
  if (s.payment_status !== "paid") return res.status(200).json({ ignored: "not_paid_yet" });

  const product = await productOf(stripe, s.id);

  try {
    const r = await fetch(BOOKINGS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SM-Secret": shared },
      body: JSON.stringify(bookingFrom(s, product)),
    });
    if (!r.ok) {
      console.error("stripe-webhook: the TOJ app answered", r.status);
      return res.status(502).json({ error: "bookings_refused", status: r.status });
    }
  } catch (e) {
    console.error("stripe-webhook: the TOJ app is unreachable:", e.message);
    return res.status(502).json({ error: "bookings_unreachable" });
  }
  return res.status(200).json({ ok: true });
};

module.exports._test = { checkoutFields, personal, isoDate, stateCode, cityState, packageFor, bookingFrom, useStripe: (f) => { makeStripe = f; } };
