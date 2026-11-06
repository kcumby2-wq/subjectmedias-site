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
//   STRIPE_SECRET_KEY      already here (the admin page uses it)
//   STRIPE_WEBHOOK_SECRET  the signing secret Stripe shows for this endpoint
//   SM_BOOKINGS_SECRET     the same value as on the TOJ app's Render service
//   SM_BOOKINGS_URL        optional; defaults to the TOJ app's Render address
//
// The checkout's own fields (a payment link has up to three) fill in the
// sport, event, date, place, team and jersey when they ask for those; any
// other field goes along as notes. A field about the athlete themselves (a
// name, a handle, an age or grade) stays in Stripe: here an athlete is a team
// and a jersey number.
//
// The raw body is read from the request stream (Vercel's helpers keep it
// readable), never from req.body: Stripe signs the exact bytes.

const Stripe = require("stripe");

const BOOKINGS_URL = process.env.SM_BOOKINGS_URL || "https://toj-csv-app.onrender.com/api/sm/bookings/paid";
const BY_NAME = [[/elite/i, "elite"], [/transcript/i, "transcript"], [/video/i, "video"], [/photo/i, "photo"], [/team/i, "team"], [/event/i, "event"]];
const BY_CENTS = { 4999: "photo", 9999: "video", 13999: "elite", 24999: "transcript" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The booking form's sports (the TOJ app keeps the same list).
const SPORTS = ["7v7 Football", "Football", "Girls Flag Football", "Basketball", "Volleyball", "Soccer", "Lacrosse", "Track & Field", "Baseball", "Softball", "Wrestling"];
const STATES = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", "washington dc": "DC", "washington d.c": "DC", "d.c": "DC", florida: "FL", georgia: "GA", hawaii: "HI",
  idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const CODES = new Set(Object.values(STATES));
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE_ANY = /\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi;

let makeStripe = (key) => new Stripe(key, { apiVersion: "2024-06-20" });

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// The checkout's custom fields, in order, as [label, value].
function checkoutFields(session) {
  const out = [];
  for (const f of session.custom_fields || []) {
    const label = String((f.label && (f.label.custom || f.label.type)) || f.key || "field");
    let val = "";
    if (f.type === "text" && f.text) val = f.text.value || "";
    else if (f.type === "numeric" && f.numeric) val = f.numeric.value || "";
    else if (f.type === "dropdown" && f.dropdown) {
      const opt = (f.dropdown.options || []).find((o) => o.value === f.dropdown.value);
      val = (opt && opt.label) || f.dropdown.value || "";
    }
    val = String(val).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if (val) out.push([label, val]);
  }
  return out;
}

const JOB = /team|club|school|jersey|number|#|event|tournament|game|sport|date|city|state|location|venue/i;
// A field about the athlete themselves stays in Stripe.
function personal(label) {
  const l = String(label);
  // A name, unless it's the team's or the event's.
  if (/\bnames?\b/i.test(l) && !/\b(team|club|school|event|tournament)('s)?\s+names?\b/i.test(l)) return true;
  // Handles, contact details, age, grade: the buyer's own contact is on the checkout already.
  if (/instagram|\binsta\b|tiktok|twitter|snapchat|\bsnap\b|handle|social|@|e-?mail|phone|\bcell\b|address|birth|\bdob\b|\bage\b|grade|\bgrad\b|class of/i.test(l)) return true;
  // Anything else about the athlete, unless it's about the job.
  return /athlete|player|child|\bkid|\bson\b|daughter/i.test(l) && !JOB.test(l);
}

function ymd(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
// The first date with a year in the text: 2026-11-21, 11/21/2026, 11/21/26, Nov 21, 2026.
function isoDate(s) {
  const t = String(s || "");
  let m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(t);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/.exec(t);
  if (m) return ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(t);
  if (m) return ymd(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
  return "";
}
// 'TX', 'tx', 'Texas' → 'TX'; anything else → "".
function stateCode(s) {
  const t = String(s || "").trim().replace(/\.$/, "");
  if (/^[A-Za-z]{2}$/.test(t) && CODES.has(t.toUpperCase())) return t.toUpperCase();
  return STATES[t.toLowerCase().replace(/\s+/g, " ")] || "";
}
// 'Dallas, TX' or 'Dallas, Texas' → { city, state }.
function cityState(v) {
  const m = /^(.+?),\s*([A-Za-z .]+)$/.exec(String(v || "").trim());
  if (!m) return null;
  const state = stateCode(m[2]);
  return state ? { city: m[1].trim(), state } : null;
}

function packageFor(product, session) {
  const hit = BY_NAME.find(([re]) => re.test(product || ""));
  return (hit && hit[1]) || BY_CENTS[session.amount_subtotal] || BY_CENTS[session.amount_total] || "unsure";
}

// The booking the TOJ app gets for a paid checkout.
function bookingFrom(s, product) {
  const fields = checkoutFields(s).filter(([label]) => !personal(label));
  const used = new Set();
  const first = (labelRe, read, { skip, reuse } = {}) => {
    for (const [label, value] of fields) {
      if ((used.has(label) && !(reuse && reuse.has(label))) || !labelRe.test(label) || (skip && skip.test(label))) continue;
      const out = read(value);
      if (out) {
        used.add(label);
        return { label, out };
      }
    }
    return null;
  };

  const date = first(/date|when|\bday\b/i, isoDate);
  // "Event & date" can give both the date and the event's name.
  const event = first(
    /event|tournament|game|showcase|camp|combine|league|\bmeet\b/i,
    (v) => (v.replace(DATE_ANY, "").replace(/[^a-z]/gi, "").length >= 2 ? v : ""),
    { skip: /city|state|location|venue/i, reuse: new Set(date ? [date.label] : []) }
  );
  const sport = first(/sport/i, (v) => SPORTS.find((x) => x.toLowerCase() === v.toLowerCase()) || "");
  const place = first(/location|where|venue|city/i, cityState);
  let city = place ? place.out.city : "";
  let state = place ? place.out.state : "";
  if (!city) city = (first(/\bcity\b/i, (v) => v) || {}).out || "";
  if (!state) state = (first(/\bstate\b/i, stateCode) || {}).out || "";
  const team = first(/team|club|school/i, (v) => v, { skip: /jersey|number|#/i });
  const jersey = first(/jersey|number|#/i, (v) => v);
  const teamJersey = [team && team.out, jersey && (/^\d{1,3}$/.test(jersey.out) ? "#" + jersey.out : jersey.out)].filter(Boolean).join(" ");
  const notes = fields.filter(([label]) => !used.has(label)).map(([label, value]) => `${label}: ${value}`).join("; ");

  const cd = s.customer_details || {};
  const ref = String(s.client_reference_id || "");
  return {
    stripe_session_id: s.id,
    booking_id: UUID.test(ref) ? ref : null,
    package: packageFor(product, s),
    amount_cents: s.amount_total,
    contact_name: cd.name || "",
    contact_email: cd.email || s.customer_email || "",
    contact_phone: cd.phone || "",
    sport: sport ? sport.out : "",
    event_name: event ? event.out.slice(0, 120) : "",
    event_date: date ? date.out : "",
    event_city: city.slice(0, 80),
    event_state: state,
    team_jersey: teamJersey.slice(0, 60),
    notes: notes.slice(0, 1000),
  };
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
  // A bank payment that hasn't cleared arrives again as async_payment_succeeded.
  if (s.payment_status !== "paid") return res.status(200).json({ ignored: "not_paid_yet" });

  let product = "";
  try {
    const items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 1 });
    product = (items.data[0] && items.data[0].description) || "";
  } catch (e) {
    console.warn("stripe-webhook: line items unavailable:", e.message);
  }

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
