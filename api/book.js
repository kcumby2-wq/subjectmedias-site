// The booking form's way into the TOJ app, where Kyron gets the alert.
//
// The homepage form posts here. This adds the shared secret and the visitor's
// address as Vercel saw it (Vercel sets that header itself, so a visitor can't
// fake it), then hands the booking to the app's /api/sm/bookings. The app
// counts its abuse limits by that address and refuses calls without the secret.
//
// Settings on this Vercel project:
//   SM_BOOKINGS_SECRET    the same value as on the TOJ app's Render service
//   SM_BOOKINGS_FORM_URL  optional; defaults to the TOJ app's Render address
//
// Whatever goes wrong, the form gets a plain answer it can act on: 200 with the
// booking's id, 400 with the fields to fix, 429, or 503 (then it shows the
// booker the email address to write to instead).

const FORM_URL = process.env.SM_BOOKINGS_FORM_URL || "https://toj-csv-app.onrender.com/api/sm/bookings";
const TIMEOUT_MS = 25000;

function bodyOf(req) {
  try {
    const b = req.body;
    return b && typeof b === "object" && !Array.isArray(b) && !Buffer.isBuffer(b) ? b : null;
  } catch (e) {
    return null; // not JSON
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  const secret = process.env.SM_BOOKINGS_SECRET;
  if (!secret) {
    console.error("book: SM_BOOKINGS_SECRET is missing");
    return res.status(503).json({ error: "unavailable" });
  }
  const body = bodyOf(req);
  if (!body) return res.status(400).json({ error: "invalid", fields: [] });

  const visitor = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(FORM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SM-Secret": secret, "X-SM-Visitor": visitor },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    // Only what the form needs: the booking's id, or which fields to fix.
    if (r.ok) return res.status(200).json({ ok: data.ok === true, id: typeof data.id === "string" ? data.id : null });
    if (r.status === 400) return res.status(400).json({ error: "invalid", fields: Array.isArray(data.fields) ? data.fields.filter((f) => typeof f === "string") : [] });
    if (r.status === 429) return res.status(429).json({ error: "too_many" });
    console.error("book: the TOJ app answered", r.status);
    return res.status(503).json({ error: "unavailable" });
  } catch (e) {
    console.error("book: the TOJ app is unreachable:", e && e.name === "AbortError" ? "timed out" : e && e.message);
    return res.status(503).json({ error: "unavailable" });
  } finally {
    clearTimeout(timer);
  }
};
