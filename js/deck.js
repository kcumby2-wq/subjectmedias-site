// Phones: the homepage as nine full-screen screens you swipe left through,
// each over its own footage, like a story (the markup is the .deck in
// index.html; the look is "The phone deck" in css/site.css). Computers,
// tablets and phones without JavaScript keep the scrolling page.
//
// - Every screen can open the booking form, which slides up over the screens.
//   A package or a team/event button opens it already set to that choice.
// - Swipe, tap the right side to go on and the left side to go back, or use
//   the arrow keys. The bars at the top show where you are.
// - Only the screen in view plays, and the next one loads ahead. With reduced
//   motion or data saver on, the screens show still frames instead.
(function () {
  "use strict";

  var deck = document.querySelector("[data-deck]");
  var sheet = document.querySelector("[data-sheet]");
  if (!deck || !sheet || !window.matchMedia) return;

  var root = document.documentElement;
  var track = deck.querySelector("[data-deck-track]");
  var slides = Array.prototype.slice.call(track.children);
  var bars = Array.prototype.slice.call(deck.querySelectorAll(".deck-bars i"));
  var status = deck.querySelector("[data-deck-status]");
  var head = document.querySelector("[data-head]");
  var sheetBody = sheet.querySelector("[data-sheet-body]");
  var sheetTitle = sheet.querySelector("#sheet-title");
  var slot = document.querySelector("[data-book-slot]");
  var home = slot ? { parent: slot.parentNode, next: slot.nextSibling } : null;
  var tc = deck.querySelector("[data-dk-tc]");
  var af = deck.querySelector("[data-dk-af]");
  var phone = matchMedia("(max-width: 760px)");
  var reduce = matchMedia("(prefers-reduced-motion: reduce)");
  var saveData = !!(navigator.connection && navigator.connection.saveData);

  var on = false, idx = 0, raf = 0, settle = 0, hintTimer = 0, tcRaf = 0, afTimer = 0;
  var opener = null, down = null;
  var still = function () { return reduce.matches || saveData; };
  var clamp = function (i) { return Math.max(0, Math.min(slides.length - 1, i)); };

  // ── Media: load when a screen is in view or next ─────────────────────
  function load(s, withVideo) {
    if (!s) return;
    Array.prototype.forEach.call(s.querySelectorAll("[data-src]"), function (el) {
      if (el.tagName === "VIDEO" && !withVideo) return;
      if (!el.getAttribute("src")) el.setAttribute("src", el.getAttribute("data-src"));
    });
  }

  // Photos one after another with a camera flash; crew photos slowly.
  function flash(s, run) {
    var box = s && s.querySelector("[data-flash]");
    if (!box) return;
    clearInterval(box._timer);
    box._timer = 0;
    if (!run || still()) return;
    var imgs = Array.prototype.slice.call(box.querySelectorAll("img"));
    var pop = box.querySelector(".dk-pop");
    box._timer = setInterval(function () {
      var cur = box.querySelector("img.show") || imgs[0];
      var next = imgs[(imgs.indexOf(cur) + 1) % imgs.length];
      if (!next.getAttribute("src")) next.setAttribute("src", next.getAttribute("data-src"));
      cur.classList.remove("show");
      next.classList.add("show");
      if (pop) { pop.classList.remove("go"); void pop.offsetWidth; pop.classList.add("go"); }
    }, box.classList.contains("slow") ? 3200 : 950);
  }

  // The opener's running timecode, as on the computer's viewfinder.
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var base = ((12 * 60) + 4) * 60 + 17, t0 = 0;
  function tick(now) {
    if (!t0) t0 = now;
    var f = base + Math.floor(((now - t0) / 1000) * 60), ff = f % 60, sec = Math.floor(f / 60);
    tc.textContent = pad(Math.floor(sec / 3600)) + ":" + pad(Math.floor(sec / 60) % 60) + ":" + pad(sec % 60) + ":" + pad(ff);
    tcRaf = requestAnimationFrame(tick);
  }
  function timecode(run) {
    cancelAnimationFrame(tcRaf);
    tcRaf = 0;
    if (run && tc && !still()) tcRaf = requestAnimationFrame(tick);
  }

  function pauseAll() {
    slides.forEach(function (s) {
      var v = s.querySelector("video");
      if (v && !v.paused) v.pause();
      flash(s, false);
    });
    timecode(false);
  }

  // ── Which screen is showing ──────────────────────────────────────────
  function show(i) {
    idx = i;
    bars.forEach(function (b, j) { b.className = j < i ? "seen" : j === i ? "now" : ""; });
    load(slides[i], !still());
    load(slides[i + 1], !still());
    slides.forEach(function (s, j) {
      var here = j === i;
      s.classList.toggle("is-on", here);
      var v = s.querySelector("video");
      if (v) {
        if (here && !still() && sheet.hidden) {
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        } else if (!v.paused) v.pause();
      }
      flash(s, here && sheet.hidden);
    });
    timecode(i === 0 && sheet.hidden);
  }
  function title(s) {
    var h = s.querySelector(".dk-title");
    return h ? h.textContent.trim() : "";
  }
  function announce() {
    if (status) status.textContent = "Screen " + (idx + 1) + " of " + slides.length + ": " + title(slides[idx]);
  }
  function moved() {
    if (deck.classList.contains("moved")) return;
    deck.classList.add("moved");
    clearTimeout(hintTimer);
  }
  function go(i) {
    i = clamp(i);
    track.scrollTo({ left: i * track.clientWidth, behavior: reduce.matches ? "auto" : "smooth" });
  }

  track.addEventListener("scroll", function () {
    if (!on || raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      var i = clamp(Math.round(track.scrollLeft / (track.clientWidth || 1)));
      if (i !== idx) { show(i); moved(); }
      clearTimeout(settle);
      settle = setTimeout(announce, 250);
    });
  }, { passive: true });

  // Tap the right side to go on, the left side to go back (not on a button
  // or a link, and not when the finger moved: that's a swipe).
  function interactive(el) {
    return !!(el && el.closest && el.closest("a, button, input, select, textarea, label"));
  }
  track.addEventListener("pointerdown", function (e) {
    if (e.isPrimary) down = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  track.addEventListener("pointercancel", function () { down = null; });
  track.addEventListener("pointerup", function (e) {
    var d = down;
    down = null;
    if (!on || !d || interactive(e.target)) return;
    if (Math.abs(e.clientX - d.x) > 10 || Math.abs(e.clientY - d.y) > 10 || Date.now() - d.t > 450) return;
    go(e.clientX < track.clientWidth * 0.3 ? idx - 1 : idx + 1);
    moved();
  });

  deck.querySelector("[data-deck-prev]").addEventListener("click", function () { go(idx - 1); moved(); });
  deck.querySelector("[data-deck-next]").addEventListener("click", function () { go(idx + 1); moved(); });
  document.addEventListener("keydown", function (e) {
    if (!on) return;
    if (!sheet.hidden) {
      if (e.key === "Escape") closeSheet();
      return;
    }
    if (e.target && e.target.closest && e.target.closest("input, select, textarea")) return;
    if (e.key === "ArrowRight") { go(idx + 1); moved(); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { go(idx - 1); moved(); e.preventDefault(); }
  });

  // If nobody has swiped after a couple of seconds, the first screen leans left.
  function hint() {
    clearTimeout(hintTimer);
    if (reduce.matches) return;
    hintTimer = setTimeout(function () {
      if (!on || idx !== 0 || deck.classList.contains("moved") || !sheet.hidden) return;
      deck.classList.add("nudge");
      setTimeout(function () { deck.classList.remove("nudge"); }, 1900);
    }, 2400);
  }

  // ── The booking sheet ────────────────────────────────────────────────
  function setInert(value) {
    [deck, head].forEach(function (el) {
      if (!el) return;
      if (value) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    });
  }
  function openSheet(pkg) {
    var form = document.querySelector("[data-book]");
    if (form && pkg) {
      // A package from the price screen is for one athlete.
      var athlete = form.querySelector("input[name=kind][value=athlete]");
      if (athlete && !athlete.checked) {
        athlete.checked = true;
        athlete.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (form.elements.package) form.elements.package.value = pkg;
    }
    opener = document.activeElement;
    sheet.hidden = false;
    setInert(true);
    pauseAll();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { sheet.classList.add("open"); });
    });
    setTimeout(function () { if (sheetTitle) sheetTitle.focus({ preventScroll: true }); }, 60);
  }
  function closeSheet(now) {
    if (sheet.hidden) return;
    sheet.classList.remove("open");
    setInert(false);
    var done = function () {
      sheet.hidden = true;
      if (on) show(idx);
    };
    if (now === true || reduce.matches) done();
    else setTimeout(done, 300);
    if (now !== true && opener && opener.focus) opener.focus({ preventScroll: true });
  }
  // Runs after site.js's own handlers, which fill in team or event first.
  document.addEventListener("click", function (e) {
    if (!on || !e.target.closest) return;
    var t = e.target.closest('[data-open-book], a[href="#book"]');
    if (t) {
      e.preventDefault();
      openSheet(t.getAttribute("data-package"));
      return;
    }
    if (e.target.closest("[data-sheet-close]")) {
      e.preventDefault();
      closeSheet();
    }
  });
  // Keep Tab inside the open sheet.
  sheet.addEventListener("keydown", function (e) {
    if (e.key !== "Tab") return;
    var f = Array.prototype.filter.call(
      sheet.querySelectorAll('a[href], button:not([disabled]), input:not([tabindex="-1"]), select, textarea'),
      function (el) { return el.offsetParent !== null; }
    );
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });

  // ── On for phones, off for everything wider ─────────────────────────
  function start() {
    if (on) return;
    on = true;
    root.classList.add("deck-on");
    if (slot && sheetBody) sheetBody.appendChild(slot);
    track.scrollLeft = 0;
    show(0);
    clearTimeout(afTimer);
    if (af) afTimer = setTimeout(function () { af.classList.add("locked"); }, still() ? 0 : 1100);
    hint();
  }
  function stop() {
    if (!on) return;
    closeSheet(true);
    on = false;
    root.classList.remove("deck-on");
    pauseAll();
    clearTimeout(hintTimer);
    if (slot && home) home.parent.insertBefore(slot, home.next);
  }
  function check() { if (phone.matches) start(); else stop(); }

  window.addEventListener("resize", function () {
    if (on) track.scrollLeft = idx * track.clientWidth;
  });
  document.addEventListener("visibilitychange", function () {
    if (!on) return;
    if (document.hidden) pauseAll();
    else if (sheet.hidden) show(idx);
  });
  if (phone.addEventListener) phone.addEventListener("change", check);
  else if (phone.addListener) phone.addListener(check);
  check();
})();
