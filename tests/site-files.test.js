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

// Media from the earlier site was never checked against the shot rule for
// minors, so nothing goes out that no page uses: every published file under
// media/ is one a page uses, and everything a page uses is published.
test("media: published only when a page uses it, and everything a page uses is published", () => {
  const rules = read(".vercelignore").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  // Plain paths and folders only (no wildcards or negation), read the way
  // Vercel reads them (gitignore rules, without regard to case): a rule with a
  // slash before its end is a path from the top; one without matches that
  // name at any depth; a trailing slash means a folder.
  for (const l of rules) {
    assert.match(l, /^[A-Za-z0-9._/-]+$/, `a plain path, not a pattern: ${l}`);
    assert.doesNotMatch(l, /^\.?\//, `no leading "/" or "./" (Vercel reads those differently): ${l}`);
  }
  const ignored = (f) => rules.some((l) => {
    const dir = l.endsWith("/"), name = (dir ? l.slice(0, -1) : l).toLowerCase(), file = f.toLowerCase();
    if (name.includes("/")) return file === name ? !dir : file.startsWith(name + "/");
    const parts = file.split("/");
    return (dir ? parts.slice(0, -1) : parts).includes(name);
  });
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(dir + "/" + e.name) : [dir + "/" + e.name]));
  const published = walk("media").filter((f) => !ignored(f));
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  assert.ok(pages.includes("index.html") && pages.includes("details.html"), "the pages were found");
  const sources = [...pages, "sitemap.xml", ...fs.readdirSync(path.join(ROOT, "css")).map((f) => "css/" + f), ...fs.readdirSync(path.join(ROOT, "js")).map((f) => "js/" + f)];
  const used = new Set(sources.flatMap((f) => [...read(f).matchAll(/media\/[A-Za-z0-9_./-]+\.[a-z0-9]+/g)].map((m) => m[0])));
  assert.ok(used.size > 20, "the pages' media were found");
  for (const f of published) assert.ok(used.has(f), `published but no page uses it: ${f} (use it, or list it in .vercelignore)`);
  for (const f of used) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `a page uses a file that isn't there: ${f}`);
    assert.ok(!ignored(f), `a page uses a file that isn't published: ${f}`);
  }
  for (const old of ["media/athlete-photos/ath-soccer.png", "media/event-photos/event-13-plano-lacrosse.jpg", "media/action-reel-2.mp4"]) assert.ok(ignored(old), old);
  // The matcher reads rules as Vercel does: a name without a slash at any
  // depth, any case.
  assert.ok(ignored("media/v2/scripts/x.webp") && ignored("Tests/a.js") && ignored("a/push-to-github.bat"));
  assert.ok(!ignored("media/v2/og.jpg") && !ignored("media/athlete-photos.txt"));
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
