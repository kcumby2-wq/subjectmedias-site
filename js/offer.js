// The first-package offer, as on the old site: 10% off a first package,
// claimed with a booking request rather than a code.
//
// After a visitor has spent 15 seconds on the homepage (only while the tab is
// in view), a card offers it once. It never opens over the booking form or
// while someone is typing, and waits until they're done. "Claim my 10% off"
// opens the booking form with the offer on:
//   - the form says so at the top;
//   - the request carries the claim (offer: first10), so the email alert and
//     the app show it (js/site.js reads window.smOffer);
//   - the panel after sending promises the payment link with the 10% taken
//     off, instead of the full-price one.
// The team takes the 10% off when they confirm the booking. Through Dec 31,
// 2026: remove this file's script tag once the offer ends.
(function () {
  "use strict";

  // The end of Dec 31, 2026 in New York.
  var ENDS = Date.UTC(2027, 0, 1, 5, 0, 0);
  var SEEN = "sm_offer_first10";          // the card shows once per visitor
  var CLAIMED = "sm_offer_first10_claim"; // claimed, for this tab
  var WAIT_MS = 15000;

  if (Date.now() >= ENDS) return;

  function get(store, k) { try { return window[store].getItem(k) === "1"; } catch (e) { return false; } }
  function set(store, k) { try { window[store].setItem(k, "1"); } catch (e) { /* private mode */ } }

  window.smOffer = { claimed: get("sessionStorage", CLAIMED), code: "first10" };

  // The booking form, with the offer on.
  function banner() {
    var form = document.querySelector("[data-book]");
    if (!form || form.querySelector(".offer-on")) return;
    var p = document.createElement("p");
    p.className = "offer-on";
    p.textContent = "10% off your first package: we take it off when we confirm your booking.";
    form.insertBefore(p, form.firstChild);
  }
  function claim() {
    window.smOffer.claimed = true;
    set("sessionStorage", CLAIMED);
    banner();
  }
  if (window.smOffer.claimed) banner();
  if (get("localStorage", SEEN)) return;

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

  function show() {
    if (busy()) { setTimeout(show, 2000); return; }
    set("localStorage", SEEN);
    card = document.createElement("aside");
    card.className = "offer";
    card.setAttribute("aria-labelledby", "offer-title");
    card.setAttribute("aria-live", "polite");
    card.innerHTML =
      '<button type="button" class="offer-x" aria-label="Close the offer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>' +
      '<p class="offer-kicker">First-package offer</p>' +
      '<h2 class="offer-title" id="offer-title">10% off your first package.</h2>' +
      "<p class=\"offer-line\">Still browsing? Tell us about your game, and we'll take 10% off when we reach out to book it.</p>" +
      '<a class="pill pill-green offer-book" href="#book" data-open-book>Claim my 10% off</a>' +
      '<p class="offer-note">We reply within 24 hours. Claim it by Dec 31, 2026.</p>';
    document.body.appendChild(card);
    if (window.smCount) window.smCount("offer_shown");
    card.querySelector(".offer-x").addEventListener("click", close);
    // The booking form opens as usual (js/site.js, js/deck.js), with the offer on.
    card.querySelector(".offer-book").addEventListener("click", function () { claim(); setTimeout(close, 0); });
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
