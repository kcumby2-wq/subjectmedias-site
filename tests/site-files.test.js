// The site's own files: what search engines read, and what's gone.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SITE = "https://www.subjectmedias.com";

// The page a public path is served from: / is index.html, /x is x.html
// (vercel.json's rewrites name the rest).
function pageFor(p) {
  if (p === "/") return "index.html";
  const rw = JSON.parse(read("vercel.json")).rewrites.find((r) => r.source === p && /^\/[^/]+\.html$/.test(r.destination));
  return rw ? rw.destination.slice(1) : p.slice(1) + ".html";
}

test("robots.txt: crawl the site, skip the functions, find the sitemap", () => {
  const r = read("robots.txt");
  assert.match(r, /^User-agent: \*$/m);
  assert.match(r, /^Disallow: \/api\/$/m);
  assert.match(r, new RegExp("^Sitemap: " + SITE.replace(/\./g, "\\.") + "/sitemap\\.xml$", "m"));
  // The marketplace pages say noindex themselves; blocking them here would hide that.
  assert.doesNotMatch(r, /^Disallow: \/m\//m);
  assert.doesNotMatch(r, /^Disallow: \/\s*$/m);
});

test("sitemap.xml: every page in it exists and names itself as canonical", () => {
  const xml = read("sitemap.xml");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length >= 2);
  assert.equal(new Set(locs).size, locs.length, "no page twice");
  for (const loc of locs) {
    assert.ok(loc.startsWith(SITE + "/"), loc);
    const p = loc.slice(SITE.length);
    const file = pageFor(p);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${loc} → ${file}`);
    const html = read(file);
    const canon = /<link rel="canonical" href="([^"]+)">/.exec(html);
    assert.ok(canon, `${file} has a canonical link`);
    assert.equal(canon[1], loc, `${file}'s canonical is its sitemap address`);
  }
  for (const m of xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) assert.match(m[1], /^\d{4}-\d{2}-\d{2}$/);
});

test("the old admin page and its password-only Stripe endpoints are gone", () => {
  for (const f of ["admin.html", "api/sales.js", "api/subscriptions.js"]) assert.ok(!fs.existsSync(path.join(ROOT, f)), f);
  const files = ["index.html", "fellowship.html", "vercel.json", ...fs.readdirSync(path.join(ROOT, "js")).map((f) => "js/" + f), ...fs.readdirSync(path.join(ROOT, "api")).filter((f) => f.endsWith(".js")).map((f) => "api/" + f)];
  for (const f of files) assert.doesNotMatch(read(f), /admin\.html|\/api\/sales|\/api\/subscriptions|ADMIN_PASSWORD/, f);
});

test("Kyron's push helper isn't served", () => {
  assert.match(read(".vercelignore"), /^push-to-github\.bat$/m);
});

test("the details page: never indexed, and its checkout id never leaves in a Referer", () => {
  const html = read("details.html");
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.doesNotMatch(read("sitemap.xml"), /details/);
});

test("counts: the live site only, never with Global Privacy Control, and each page says which visit it is", () => {
  const js = read("js/count.js");
  assert.match(js, /host !== "www\.subjectmedias\.com" && host !== "subjectmedias\.com"/);
  assert.match(js, /globalPrivacyControl === true/);
  assert.doesNotMatch(js, /document\.cookie|localStorage|sessionStorage|indexedDB/);
  assert.match(read("index.html"), /<body data-count="visit_home">/);
  assert.match(read("fellowship.html"), /<body data-count="visit_fellowship">/);
  assert.doesNotMatch(read("details.html"), /count\.js/);
});

test("counts: a package's Buy is a Buy tap on phones too", () => {
  const js = read("js/count.js"), html = read("index.html");
  // Every package button on the phones' prices screen is named in the Buy
  // taps, so the same choice counts the same way on every screen.
  const phone = [...html.matchAll(/<button type="button" data-open-book data-package="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(phone.sort(), ["elite", "photo", "video"]);
  for (const pkg of phone) assert.ok(js.includes(`[data-open-book][data-package="${pkg}"]`), pkg);
  assert.match(js, /if \(t\.closest\(BUY\)\) count\("buy_tap"\);\s*else if/);
});

test("pay now: each priced package's Buy button and the form's checkout are the same Stripe link", () => {
  const html = read("index.html"), js = read("js/site.js");
  for (const pkg of ["photo", "video", "elite", "transcript"]) {
    const btn = new RegExp(`href="(https://buy\\.stripe\\.com/[A-Za-z0-9]+)" data-buy="${pkg}"`).exec(html);
    const pay = new RegExp(`${pkg}: \\["[^"]+", "(https://buy\\.stripe\\.com/[A-Za-z0-9]+)"\\]`).exec(js);
    assert.ok(btn && pay, pkg);
    assert.equal(btn[1], pay[1], `${pkg}: the Buy button and the form go to the same checkout`);
  }
  assert.match(js, /var PRICES = \{ photo: \["Photo coverage", "\$49\.99"\], video: \["Video coverage", "\$99\.99"\], elite: \["Elite coverage", "\$139\.99"\] \};/);
});

// The browser protections on the site's own pages, files and functions. The
// TOJ app's pages the site passes through (/m/, /c/, the creator API) send
// their own, stricter ones (the family pages' no-referrer keeps their links'
// tokens private), so this rule leaves them alone.
test("browser protections: on the site's own paths, never on the app's pages it passes through", () => {
  const rule = JSON.parse(read("vercel.json")).headers.find((h) => h.headers.some((x) => x.key === "X-Frame-Options"));
  assert.ok(rule, "the rule is there");
  const set = Object.fromEntries(rule.headers.map((x) => [x.key, x.value]));
  assert.deepEqual(set, {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  });
  // No path-to-regexp parameters in it, so as a regular expression it matches
  // what Vercel matches.
  assert.equal(rule.source, "/((?!m(?:/|$)|c/|api/creators/public(?:/|$)).*)");
  const covers = (p) => new RegExp("^" + rule.source + "$").test(p);
  for (const p of ["/", "/fellowship", "/details", "/index.html", "/js/site.js", "/css/site.css", "/media/v2/og.jpg", "/api/book", "/api/stripe-webhook", "/robots.txt", "/c", "/creators", "/media", "/mail"]) assert.ok(covers(p), p);
  // /m/:path* and /api/creators/public/:path* match with no segment too.
  for (const p of ["/m", "/m/", "/m/lima-2027", "/m/lima-2027/clips", "/c/kyron", "/api/creators/public", "/api/creators/public/", "/api/creators/public/kyron"]) assert.ok(!covers(p), p);
  for (const r of JSON.parse(read("vercel.json")).rewrites.filter((x) => /^https:/.test(x.destination) && x.source !== "/api/sm/site/count")) assert.ok(!covers(r.source.replace(/:[a-z]+\*?/g, "x")), `the app's page ${r.source} keeps its own headers`);
});
