// The site's functions that feed the TOJ app: the booking form's /api/book,
// the fellowship application's /api/apply and the Stripe webhook. No network: fetch and Stripe's API are
// stubbed; Stripe's real signing code checks the signatures.
//
//   npm test

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("stream");
const Stripe = require("stripe");

const book = require("../api/book");
const apply = require("../api/apply");
const hook = require("../api/stripe-webhook");
const W = hook._test;

const SECRET = "site-secret-0123456789-abcdefgh";
const SIGNING = "whsec_test_0123456789abcdef";
let sent, answer, realFetch;

function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

beforeEach(() => {
  process.env.SM_BOOKINGS_SECRET = SECRET;
  process.env.STRIPE_SECRET_KEY = "sk_test_not_real";
  process.env.STRIPE_WEBHOOK_SECRET = SIGNING;
  sent = [];
  answer = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, id: "8f14e45f-ceea-467e-a1d0-6f1d4c6b2a01" }) });
  realFetch = global.fetch;
  global.fetch = async (url, init) => {
    sent.push({ url, init, body: JSON.parse(init.body) });
    return answer(url, init);
  };
});
afterEach(() => { global.fetch = realFetch; });

// ── /api/book ────────────────────────────────────────────────────────────
test("book: passes the booking on with the secret and Vercel's visitor address", async () => {
  const res = fakeRes();
  await book({ method: "POST", headers: { "x-real-ip": "203.0.113.7", "x-forwarded-for": "203.0.113.7" }, body: { kind: "athlete", contact_email: "a@b.co" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, id: "8f14e45f-ceea-467e-a1d0-6f1d4c6b2a01" });
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/api\/sm\/bookings$/);
  assert.equal(sent[0].init.headers["X-SM-Secret"], SECRET);
  assert.equal(sent[0].init.headers["X-SM-Visitor"], "203.0.113.7");
  assert.equal(sent[0].body.kind, "athlete");
});

test("book: only what the form needs comes back", async () => {
  answer = async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid", fields: ["contact_email", { x: 1 }], debug: "secret stuff" }) });
  const res = fakeRes();
  await book({ method: "POST", headers: {}, body: { kind: "athlete" } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "invalid", fields: ["contact_email"] });
});

test("book: too many, the app down, or no secret: the form is told to show the email", async () => {
  answer = async () => ({ ok: false, status: 429, json: async () => ({}) });
  let res = fakeRes();
  await book({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 429);

  answer = async () => { throw new Error("connect ECONNREFUSED"); };
  res = fakeRes();
  await book({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 503);

  answer = async () => ({ ok: false, status: 401, json: async () => ({ error: "unauthorized" }) });
  res = fakeRes();
  await book({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 503, "a secret mismatch is the site's problem, not the booker's");

  delete process.env.SM_BOOKINGS_SECRET;
  res = fakeRes();
  await book({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(sent.length, 3, "nothing goes out without the secret");
});

test("book: POST with a JSON object only", async () => {
  let res = fakeRes();
  await book({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  res = fakeRes();
  await book({ method: "POST", headers: {}, body: Buffer.from("x") }, res);
  assert.equal(res.statusCode, 400);
  res = fakeRes();
  const bad = { method: "POST", headers: {} };
  Object.defineProperty(bad, "body", { get() { throw new Error("Invalid JSON"); } });
  await book(bad, res);
  assert.equal(res.statusCode, 400);
  assert.equal(sent.length, 0);
});

// ── The webhook's reading of a checkout ──────────────────────────────────
// ── /api/apply ───────────────────────────────────────────────────────────
test("apply: passes the application on with the secret and Vercel's visitor address", async () => {
  answer = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, id: "8f14e45f-ceea-467e-a1d0-6f1d4c6b2a01" }) });
  const res = fakeRes();
  await apply({ method: "POST", headers: { "x-real-ip": "203.0.113.7" }, body: { name: "Jordan", links: ["instagram.com/jordan"] } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true }, "nothing else comes back, not even an id");
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/api\/sm\/fellowship$/);
  assert.equal(sent[0].init.headers["X-SM-Secret"], SECRET);
  assert.equal(sent[0].init.headers["X-SM-Visitor"], "203.0.113.7");
  assert.deepEqual(sent[0].body.links, ["instagram.com/jordan"]);
});

test("apply: the fields to fix come back, and nothing else", async () => {
  answer = async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid", fields: ["guardian_email", 7, "link2"], debug: "secret stuff" }) });
  const res = fakeRes();
  await apply({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "invalid", fields: ["guardian_email", "link2"] });
});

test("apply: too many, the app down, or no secret: the form is told to show the email", async () => {
  answer = async () => ({ ok: false, status: 429, json: async () => ({}) });
  let res = fakeRes();
  await apply({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 429);
  answer = async () => { throw new Error("connect ECONNREFUSED"); };
  res = fakeRes();
  await apply({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 503);
  answer = async () => ({ ok: false, status: 503, json: async () => ({ error: "storage_unavailable" }) });
  res = fakeRes();
  await apply({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 503);
  delete process.env.SM_BOOKINGS_SECRET;
  res = fakeRes();
  await apply({ method: "POST", headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(sent.length, 3, "nothing goes out without the secret");
});

test("apply: POST with a JSON object only", async () => {
  let res = fakeRes();
  await apply({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  res = fakeRes();
  await apply({ method: "POST", headers: {}, body: [1, 2] }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(sent.length, 0);
});

test("a field about the athlete themselves stays in Stripe", () => {
  for (const l of ["Athlete name", "Athlete's name & jersey", "Player name and number", "Name", "Your child's age", "Athlete Instagram", "Grad year", "Class of", "Athlete email", "Date of birth"]) assert.equal(W.personal(l), true, l);
  for (const l of ["Team name", "Team & jersey #", "Player #", "Athlete's team", "Event & date", "Event name", "Sport", "City, state", "Notes for the creator"]) assert.equal(W.personal(l), false, l);
});

test("dates with a year, in the ways people type them", () => {
  assert.equal(W.isoDate("2026-11-21"), "2026-11-21");
  assert.equal(W.isoDate("11/21/2026"), "2026-11-21");
  assert.equal(W.isoDate("11/21/26"), "2026-11-21");
  assert.equal(W.isoDate("Nov 21, 2026"), "2026-11-21");
  assert.equal(W.isoDate("November 21st 2026"), "2026-11-21");
  assert.equal(W.isoDate("Pylon Dallas 11/22/2026"), "2026-11-22");
  assert.equal(W.isoDate("Jan 16"), "", "no year, no guess");
  assert.equal(W.isoDate("02/30/2026"), "");
  assert.equal(W.stateCode("tx"), "TX");
  assert.equal(W.stateCode("Texas"), "TX");
  assert.equal(W.stateCode("D.C."), "DC");
  assert.equal(W.stateCode("New  York"), "NY");
  assert.equal(W.stateCode("XX"), "");
});

const field = (label, value) => ({ key: label.toLowerCase().replace(/\W+/g, ""), label: { type: "custom", custom: label }, type: "text", text: { value } });
const session = (over = {}) => ({
  id: "cs_live_a1B2c3D4e5F6",
  mode: "payment",
  payment_status: "paid",
  amount_total: 9999,
  amount_subtotal: 9999,
  client_reference_id: null,
  payment_link: "plink_1QxYz2AbCdEf",
  status: "complete",
  metadata: {},
  customer_details: { name: "Jamie Parent", email: "jamie@example.com", phone: "+15550102030" },
  custom_fields: [],
  ...over,
});

test("a typical payment link: name stays behind, event and date and team come through", () => {
  const b = W.bookingFrom(session({ custom_fields: [field("Athlete name", "Jamie Smith"), field("Event & date", "Pylon Dallas Nov 22, 2026"), field("Team & jersey #", "Lightning #11")] }), "Video Package");
  assert.equal(b.package, "video");
  assert.equal(b.event_name, "Pylon Dallas Nov 22, 2026");
  assert.equal(b.event_date, "2026-11-22");
  assert.equal(b.team_jersey, "Lightning #11");
  assert.equal(b.notes, "");
  assert.ok(!JSON.stringify(b).includes("Jamie Smith"), "the athlete's name never leaves Stripe");
  assert.equal(b.contact_email, "jamie@example.com");
  assert.equal(b.booking_id, null);
});

test("place, sport and anything else as notes", () => {
  const b = W.bookingFrom(session({ custom_fields: [field("City", "Dallas, TX"), field("Sport", "football"), field("Notes for the creator", "Wear red"), field("Jersey", "7"), field("Team", "Lightning")] }), "");
  assert.equal(b.event_city, "Dallas");
  assert.equal(b.event_state, "TX");
  assert.equal(b.sport, "Football");
  assert.equal(b.team_jersey, "Lightning #7");
  assert.equal(b.notes, "Notes for the creator: Wear red");
  const c = W.bookingFrom(session({ custom_fields: [field("Sport", "Hockey"), field("Location", "AT&T Stadium")] }), "");
  assert.equal(c.sport, "", "off the list: the app sees it in the notes");
  assert.equal(c.notes, "Sport: Hockey; Location: AT&T Stadium");
});

test("the package: the product's name first, then the price", () => {
  assert.equal(W.packageFor("Elite Package", session()), "elite");
  assert.equal(W.packageFor("Player Transcript", session()), "transcript");
  assert.equal(W.packageFor("", session({ amount_subtotal: 4999 })), "photo");
  assert.equal(W.packageFor("", session({ amount_subtotal: 1234, amount_total: 1234 })), "unsure");
});

test("a checkout from the success panel names its request", () => {
  assert.equal(W.bookingFrom(session({ client_reference_id: "8f14e45f-ceea-467e-a1d0-6f1d4c6b2a01" }), "").booking_id, "8f14e45f-ceea-467e-a1d0-6f1d4c6b2a01");
  assert.equal(W.bookingFrom(session({ client_reference_id: "something-else" }), "").booking_id, null);
});

// ── The webhook end to end, with Stripe's real signatures ───────────────
const real = new Stripe("sk_test_not_real");
let lineItems = async () => ({ data: [{ description: "Video Package" }] });
W.useStripe(() => ({ webhooks: real.webhooks, checkout: { sessions: { listLineItems: (...a) => lineItems(...a) } } }));

function delivery(evt, { secret = SIGNING } = {}) {
  const payload = JSON.stringify(evt);
  const header = real.webhooks.generateTestHeaderString({ payload, secret });
  const req = Readable.from([Buffer.from(payload)]);
  req.method = "POST";
  req.headers = { "stripe-signature": header, "content-type": "application/json" };
  return req;
}
const completed = (s) => ({ id: "evt_1", object: "event", type: "checkout.session.completed", data: { object: s } });

test("webhook: a paid checkout goes to the app with the shared secret", async () => {
  const res = fakeRes();
  await hook(delivery(completed(session({ custom_fields: [field("Event & date", "Pylon Dallas Nov 22, 2026")] }))), res);
  assert.equal(res.statusCode, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/api\/sm\/bookings\/paid$/);
  assert.equal(sent[0].init.headers["X-SM-Secret"], SECRET);
  assert.equal(sent[0].body.stripe_session_id, "cs_live_a1B2c3D4e5F6");
  assert.equal(sent[0].body.package, "video");
  assert.equal(sent[0].body.event_date, "2026-11-22");
});

test("webhook: a bad signature, a subscription, an unpaid bank transfer: nothing goes", async () => {
  let res = fakeRes();
  await hook(delivery(completed(session()), { secret: "whsec_someone_else" }), res);
  assert.equal(res.statusCode, 400);
  res = fakeRes();
  await hook(delivery(completed(session({ mode: "subscription" }))), res);
  assert.equal(res.body.ignored, "not_a_payment");
  res = fakeRes();
  await hook(delivery(completed(session({ payment_status: "unpaid" }))), res);
  assert.equal(res.body.ignored, "not_paid_yet");
  res = fakeRes();
  await hook(delivery({ id: "evt_2", object: "event", type: "invoice.paid", data: { object: {} } }), res);
  assert.equal(res.body.ignored, "invoice.paid");
  assert.equal(sent.length, 0);
});

test("webhook: only the site's payment links make bookings, never the marketplace's clip checkouts", async () => {
  for (const s of [session({ payment_link: null }), session({ payment_link: "plink_1QxYz2AbCdEf", metadata: { kind: "sm_market", order_id: "8f14e45f-ceea-467e-a1d0-6f1d4c6b2a01" }, client_reference_id: "8f14e45f-ceea-467e-a1d0-6f1d4c6b2a01" })]) {
    const res = fakeRes();
    await hook(delivery(completed(s)), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ignored, "not_a_payment_link");
  }
  assert.equal(sent.length, 0);
});

test("webhook: the app can't take it, so Stripe is told to try again", async () => {
  answer = async () => ({ ok: false, status: 503, json: async () => ({}) });
  let res = fakeRes();
  await hook(delivery(completed(session())), res);
  assert.equal(res.statusCode, 502);
  answer = async () => { throw new Error("connect ECONNREFUSED"); };
  res = fakeRes();
  await hook(delivery(completed(session())), res);
  assert.equal(res.statusCode, 502);
});

test("webhook: Stripe's line items unavailable: the price decides the package", async () => {
  lineItems = async () => { throw new Error("rate limited"); };
  const res = fakeRes();
  await hook(delivery(completed(session({ amount_total: 13999, amount_subtotal: 13999 }))), res);
  lineItems = async () => ({ data: [{ description: "Video Package" }] });
  assert.equal(res.statusCode, 200);
  assert.equal(sent[0].body.package, "elite");
});

test("webhook: not set up, nothing pretends to work", async () => {
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const res = fakeRes();
  await hook(delivery(completed(session())), res);
  assert.equal(res.statusCode, 500);
  assert.equal(sent.length, 0);
});

test("vercel.json: the marketplace's /m/ pages go to the TOJ app; the site's own /media/ stays put", () => {
  const cfg = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "vercel.json"), "utf8"));
  const m = cfg.rewrites.find((r) => r.source === "/m/:path*");
  assert.ok(m, "the /m/ rewrite is there");
  assert.equal(m.destination, "https://toj-csv-app.onrender.com/m/:path*");
  assert.ok(!cfg.rewrites.some((r) => /^\/media/.test(r.source)), "nothing rewrites /media/");
});

// ── /api/details: the buyer's answers after a direct Buy ─────────────────
const details = require("../api/details");
beforeEach(() => details._test.reset());
let retrieve = async () => session();
details._test.useStripe(() => ({ checkout: { sessions: { retrieve: (...a) => retrieve(...a), listLineItems: (...a) => lineItems(...a) } } }));
const ask = (sid) => ({ method: "GET", headers: {}, query: { session: sid } });
const answers = (over = {}) => ({
  method: "POST",
  headers: { "x-real-ip": "203.0.113.20" },
  body: { stripe_session_id: "cs_live_a1B2c3D4e5F6", sport: "Football", event_date: "2026-11-21", event_city: "Dallas", event_state: "TX", team_jersey: "Lightning #11", notes: "Field 3", adult_confirmed: true, ...over },
});
const missing = Object.assign(new Error("No such checkout.session"), { statusCode: 404, code: "resource_missing" });

test("details: a paid direct Buy asks about the game; a request's checkout is all set; anything else isn't ours", async () => {
  let res = fakeRes();
  await details(ask("cs_live_a1B2c3D4e5F6"), res);
  assert.deepEqual(res.body, { status: "need_details", package: "video" });
  retrieve = async () => session({ client_reference_id: "8f14e45f-ceea-467e-a1d0-6f1d4c6b2a01" });
  res = fakeRes();
  await details(ask("cs_live_a1B2c3D4e5F6"), res);
  assert.deepEqual(res.body, { status: "have_details" });
  for (const s of [session({ payment_status: "unpaid", status: "open" }), session({ mode: "subscription" })]) {
    retrieve = async () => s;
    res = fakeRes();
    await details(ask("cs_live_a1B2c3D4e5F6"), res);
    assert.equal(res.statusCode, 404);
  }
  retrieve = async () => { throw missing; };
  res = fakeRes();
  await details(ask("cs_live_a1B2c3D4e5F6"), res);
  assert.equal(res.statusCode, 404);
  // Not even the shape of a checkout: Stripe isn't asked.
  let asked = false;
  retrieve = async () => { asked = true; return session(); };
  for (const sid of ["", "pi_123", "cs_live_../../x", "cs_x"]) {
    res = fakeRes();
    await details(ask(sid), res);
    assert.equal(res.statusCode, 404, sid);
  }
  assert.equal(asked, false);
  retrieve = async () => { throw new Error("Stripe is down"); };
  res = fakeRes();
  await details(ask("cs_live_a1B2c3D4e5F6"), res);
  assert.equal(res.statusCode, 503);
  retrieve = async () => session();
});

test("details: the answers go to the app with the checkout, the secret and the visitor", async () => {
  retrieve = async () => session({ custom_fields: [field("Athlete name", "Jamie Smith"), field("Event & date", "Fall Classic Nov 20, 2026"), field("Shirt size", "M")] });
  const res = fakeRes();
  await details(answers(), res);
  retrieve = async () => session();
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, already: false });
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /\/api\/sm\/bookings\/paid$/);
  assert.equal(sent[0].init.headers["X-SM-Secret"], SECRET);
  assert.equal(sent[0].init.headers["X-SM-Visitor"], "203.0.113.20");
  const b = sent[0].body;
  assert.equal(b.details, true);
  assert.equal(b.adult_confirmed, true);
  assert.equal(b.booking_id, null);
  assert.equal(b.stripe_session_id, "cs_live_a1B2c3D4e5F6");
  assert.equal(b.package, "video");
  assert.equal(b.contact_email, "jamie@example.com");
  assert.equal(b.event_date, "2026-11-21", "their answer over the checkout's");
  assert.equal(b.event_name, "Fall Classic Nov 20, 2026", "the checkout's, where they left it blank");
  assert.equal(b.event_city, "Dallas");
  assert.equal(b.team_jersey, "Lightning #11");
  assert.equal(b.notes, "Field 3", "their notes");
  assert.equal(b.checkout_notes, "Shirt size: M", "the checkout's, apart, for the app to keep once");
  assert.ok(!JSON.stringify(b).includes("Jamie Smith"), "the athlete's name stays in Stripe");
});

test("details: what the app says, the page hears; a request's checkout isn't asked", async () => {
  answer = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, duplicate: true, already: true }) });
  let res = fakeRes();
  await details(answers(), res);
  assert.deepEqual(res.body, { ok: true, already: true });
  answer = async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid", fields: ["event_date", 7, "adult_confirmed"] }) });
  res = fakeRes();
  await details(answers(), res);
  assert.deepEqual(res.body, { error: "invalid", fields: ["event_date", "adult_confirmed"] });
  answer = async () => ({ ok: false, status: 429, json: async () => ({}) });
  res = fakeRes();
  await details(answers(), res);
  assert.equal(res.statusCode, 429);
  answer = async () => { throw new Error("connect ECONNREFUSED"); };
  res = fakeRes();
  await details(answers(), res);
  assert.equal(res.statusCode, 503);
  sent = [];
  retrieve = async () => session({ client_reference_id: "8f14e45f-ceea-467e-a1d0-6f1d4c6b2a01" });
  res = fakeRes();
  await details(answers(), res);
  retrieve = async () => session();
  assert.equal(res.statusCode, 409);
  assert.equal(sent.length, 0);
  res = fakeRes();
  await details({ method: "POST", headers: {}, body: [1] }, res);
  assert.equal(res.statusCode, 400);
});

test("details: a marketplace checkout or one off our payment links isn't ours; a bank payment clearing waits", async () => {
  for (const s of [session({ payment_link: null }), session({ metadata: { kind: "sm_market" } })]) {
    retrieve = async () => s;
    const res = fakeRes();
    await details(ask("cs_live_a1B2c3D4e5F6"), res);
    assert.equal(res.statusCode, 404);
  }
  retrieve = async () => session({ payment_status: "unpaid", status: "complete" });
  let res = fakeRes();
  await details(ask("cs_live_a1B2c3D4e5F6"), res);
  assert.deepEqual(res.body, { status: "processing" });
  res = fakeRes();
  await details(answers(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "processing");
  retrieve = async () => session({ payment_status: "unpaid", status: "open" });
  res = fakeRes();
  await details(ask("cs_live_a1B2c3D4e5F6"), res);
  assert.equal(res.statusCode, 404, "an abandoned checkout isn't a payment");
  retrieve = async () => session();
  assert.equal(sent.length, 0);
});

test("details: 20 calls per visitor per 10 minutes before anything reaches Stripe", async () => {
  let asked = 0;
  retrieve = async () => { asked++; return session(); };
  for (let i = 0; i < 25; i++) await details({ method: "GET", headers: { "x-real-ip": "203.0.113.99" }, query: { session: "cs_live_a1B2c3D4e5F6" } }, fakeRes());
  assert.equal(asked, 20);
  const res = fakeRes();
  await details({ method: "GET", headers: { "x-real-ip": "203.0.113.99" }, query: { session: "cs_live_a1B2c3D4e5F6" } }, res);
  assert.equal(res.statusCode, 429);
  const other = fakeRes();
  await details({ method: "GET", headers: { "x-real-ip": "198.51.100.1" }, query: { session: "cs_live_a1B2c3D4e5F6" } }, other);
  assert.equal(other.statusCode, 200);
  retrieve = async () => session();
});

test("details: answers are cut by characters, never through an emoji", async () => {
  const res = fakeRes();
  await details(answers({ notes: "x".repeat(999) + "🏈🏈", event_city: "y".repeat(79) + "🏈🏈" }), res);
  assert.equal(res.statusCode, 200);
  const b = sent[0].body;
  assert.equal(b.notes, "x".repeat(999) + "🏈");
  assert.equal(b.event_city, "y".repeat(79) + "🏈");
  assert.ok(!/[\uD800-\uDBFF]$/.test(b.notes) && !/[\uD800-\uDBFF]$/.test(b.event_city));
});

test("details: not set up, the page shows the email; other methods are refused", async () => {
  delete process.env.STRIPE_SECRET_KEY;
  let res = fakeRes();
  await details(ask("cs_live_a1B2c3D4e5F6"), res);
  assert.equal(res.statusCode, 503);
  res = fakeRes();
  await details({ method: "DELETE", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(sent.length, 0);
});

test("vercel.json: /details is its page; the counts go to the TOJ app", () => {
  const cfg = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "..", "vercel.json"), "utf8"));
  assert.ok(cfg.rewrites.some((r) => r.source === "/details" && r.destination === "/details.html"));
  assert.ok(cfg.rewrites.some((r) => r.source === "/api/sm/site/count" && r.destination === "https://toj-csv-app.onrender.com/api/sm/site/count"));
  assert.equal(cfg.functions["api/details.js"].maxDuration, 30);
});
