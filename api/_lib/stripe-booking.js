// What a Stripe checkout on one of the site's payment links says about a
// booking, in the shape the TOJ app's /api/sm/bookings/paid takes. Shared by
// the webhook (api/stripe-webhook.js) and the details form after a direct Buy
// (api/details.js). Not a function itself: Vercel skips files whose name
// starts with an underscore.
//
// The checkout's own fields (a payment link has up to three) fill in the
// sport, event, date, place, team and jersey when they ask for those; any
// other field goes along as notes. A field about the athlete themselves (a
// name, a handle, an age or grade) stays in Stripe: here an athlete is a team
// and a jersey number.

// At most max characters, counted as Postgres counts them (code points), so a
// cut never leaves half an emoji, which Postgres refuses.
function clip(s, max) {
  const t = String(s);
  return t.length <= max ? t : Array.from(t).slice(0, max).join("");
}

// A checkout from one of the site's payment links. The marketplace's checkouts
// (made by the TOJ app for clips, metadata kind sm_market) and anything else
// made through Stripe's API have no payment link: they aren't bookings.
function fromPaymentLink(s) {
  return !!(s && s.payment_link) && !(s.metadata && s.metadata.kind === "sm_market");
}

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
    event_name: event ? clip(event.out, 120) : "",
    event_date: date ? date.out : "",
    event_city: clip(city, 80),
    event_state: state,
    team_jersey: clip(teamJersey, 60),
    notes: clip(notes, 1000),
  };
}

// The product's name, for the package: the checkout's first line item. Empty
// when Stripe can't say; then the price decides.
async function productOf(stripe, sessionId) {
  try {
    const items = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 1 });
    return (items.data[0] && items.data[0].description) || "";
  } catch (e) {
    console.warn("stripe-booking: line items unavailable:", e.message);
    return "";
  }
}

module.exports = { SPORTS, STATES, UUID, clip, fromPaymentLink, checkoutFields, personal, isoDate, stateCode, cityState, packageFor, bookingFrom, productOf };
