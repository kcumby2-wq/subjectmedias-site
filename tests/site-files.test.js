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
