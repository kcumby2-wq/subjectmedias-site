// The game-day offer: 10% off with code GAMEDAY10, through Dec 31, 2026.
//
// After a visitor has spent 15 seconds on the homepage (only while the tab is
// in view), a card shows the code once. It never opens over the booking form
// or while someone is typing, and it waits until they're done. Once it has
// shown, every "Buy" payment link carries the code (Stripe fills it in at
// checkout), and so does the pay link after a booking request (js/site.js
// reads window.smOffer).
//
// The code itself lives in Stripe: a 10% coupon with promotion code
// GAMEDAY10, ending Dec 31, 2026, and each payment link set to allow
// promotion codes. Remove this file's script tag once the offer ends.
(function () {
  "use strict";

  var CODE = "GAMEDAY10";
  // The end of Dec 31, 2026 in New York.
  var ENDS = Date.UTC(2027, 0, 1, 5, 0, 0);
  var KEY = "sm_offer_gameday10";
  var WAIT_MS = 15000;

  if (Date.now() >= ENDS) return;
  window.smOffer = { code: CODE, seen: false };

  function seenBefore() { try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; } }
  function remember() { try { localStorage.setItem(KEY, "1"); } catch (e) { /* private mode: it may show again */ } }

  // Stripe fills the code in when a payment link allows promotion codes.
  function withCode(url) {
    if (!url || url.indexOf("prefilled_promo_code=") !== -1) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "prefilled_promo_code=" + CODE;
  }
  function applyCode() {
    window.smOffer.seen = true;
    Array.prototype.forEach.call(document.querySelectorAll("a[data-buy]"), function (a) {
      a.setAttribute("href", withCode(a.getAttribute("href")));
    });
  }

  if (seenBefore()) { applyCode(); return; }

  // Somewhere the card would get in the way: the booking form open, or a field in use.
  function busy() {
    var sheet = document.querySelector("[data-sheet]");
    if (sheet && !sheet.hidden) return true;
    var a = document.activeElement;
    return !!(a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName));
  }

  var card = null;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function close() {
    if (!card) return;
    var c = card;
    card = null;
    c.classList.remove("in");
    setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, reduce ? 0 : 260);
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape" && card && card.contains(document.activeElement)) close();
  }
  function copy(btn) {
    var done = function (t) { btn.textContent = t; };
    try {
      navigator.clipboard.writeText(CODE).then(function () { done("Copied"); }, function () { done(CODE); });
    } catch (e) { done(CODE); }
  }

  function show() {
    if (busy()) { setTimeout(show, 2000); return; }
    remember();
    applyCode();
    card = document.createElement("aside");
    card.className = "offer";
    card.setAttribute("aria-labelledby", "offer-title");
    card.setAttribute("aria-live", "polite");
    card.innerHTML =
      '<button type="button" class="offer-x" aria-label="Close the offer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>' +
      '<p class="offer-kicker">Game-day offer</p>' +
      '<h2 class="offer-title" id="offer-title">10% off your game.</h2>' +
      '<p class="offer-line">On photo, video or elite coverage, or a player transcript. Use it by Dec 31, 2026.</p>' +
      '<div class="offer-code"><span class="offer-tag">' + CODE + '</span><button type="button" class="offer-copy">Copy code</button></div>' +
      '<p class="offer-note">It fills itself in when you pay from this page.</p>' +
      '<a class="pill pill-green offer-book" href="#book" data-open-book>Book coverage</a>';
    document.body.appendChild(card);
    card.querySelector(".offer-x").addEventListener("click", close);
    card.querySelector(".offer-copy").addEventListener("click", function () { copy(this); });
    // The booking form opens as usual (js/site.js, js/deck.js); the card steps aside.
    card.querySelector(".offer-book").addEventListener("click", function () { setTimeout(close, 0); });
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (card) card.classList.add("in"); }); });
  }

  // Count only the time the page is in view.
  var spent = 0, last = Date.now();
  function tick() {
    var now = Date.now();
    if (document.visibilityState !== "hidden") spent += now - last;
    last = now;
    if (spent >= WAIT_MS) show();
    else setTimeout(tick, 500);
  }
  document.addEventListener("visibilitychange", function () { last = Date.now(); });
  setTimeout(tick, 500);
})();
