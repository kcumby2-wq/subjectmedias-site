// The site's own counts: how often a page is opened, and how often people
// open the booking form or tap Buy (js/offer.js adds the 10% offer showing).
// Each one is a bare POST to /api/sm/site/count?e=<name>, which subjectmedias
// rewrites to the TOJ app, where it's one more in that day's total. No cookie,
// nothing stored here, nothing about who: the app keeps totals per day only
// (routes/sm-site.js there). The live site only, and never with Global
// Privacy Control on.
(function () {
  "use strict";

  var host = location.hostname;
  if (host !== "www.subjectmedias.com" && host !== "subjectmedias.com") return;
  if (navigator.globalPrivacyControl === true) return;

  function count(name) {
    var url = "/api/sm/site/count?e=" + encodeURIComponent(name);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
      fetch(url, { method: "POST", keepalive: true, credentials: "omit" }).catch(function () {});
    } catch (e) { /* counting never gets in the way */ }
  }
  window.smCount = count;

  var page = document.body && document.body.getAttribute("data-count");
  if (page) count(page);

  // A Buy tap is a package's Buy button (the price cards' links; on phones,
  // the package buttons on the prices screen) or any payment link. Photo,
  // video and elite open the form before Stripe, so a Buy tap isn't a
  // checkout: set it beside requests sent and payments. Any other way into
  // the form is a form open. Capture, so it counts even when another handler
  // stops the click.
  var BUY = '[data-buy], a[href^="https://buy.stripe.com/"], [data-open-book][data-package="photo"], [data-open-book][data-package="video"], [data-open-book][data-package="elite"]';
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest(BUY)) count("buy_tap");
    else if (t.closest('[data-open-book], a[href="#book"]')) count("book_open");
  }, true);
})();
