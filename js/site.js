// The homepage's small bits of behavior: the viewfinder, the header, and the
// booking form, which posts to /api/book (api/book.js passes it to the TOJ
// app, where Kyron gets the alert).
(function () {
  "use strict";

  // Sections that wait on a decision. Flip to true to show them.
  var FEATURES = { sportsrecruits: false };

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  $$("[data-feature]").forEach(function (el) { if (FEATURES[el.getAttribute("data-feature")]) el.hidden = false; });

  // ── Header ───────────────────────────────────────────────────────────
  var head = $("[data-head]");
  function onScroll() { if (head) head.classList.toggle("solid", window.scrollY > 40); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ── The viewfinder ───────────────────────────────────────────────────
  var vid = $("[data-loop]"), af = $("[data-af]"), tc = $("[data-tc]"), hero = $(".hero");
  var raf = 0, visible = true;
  var pad = function (n) { return String(n).padStart(2, "0"); };
  var base = ((12 * 60) + 4) * 60 + 17, t0 = performance.now();
  function tick(now) {
    var f = base + Math.floor(((now - t0) / 1000) * 60), ff = f % 60, s = Math.floor(f / 60);
    tc.textContent = pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60) + ":" + pad(ff);
    raf = requestAnimationFrame(tick);
  }
  if (reduce) {
    if (vid) vid.removeAttribute("autoplay");
    if (af) af.classList.add("locked");
  } else {
    setTimeout(function () { if (af) af.classList.add("locked"); }, 1100);
    if ("IntersectionObserver" in window && hero) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          visible = e.isIntersecting;
          if (visible) { if (vid) vid.play().catch(function () {}); cancelAnimationFrame(raf); if (tc) raf = requestAnimationFrame(tick); }
          else { if (vid) vid.pause(); cancelAnimationFrame(raf); }
        });
      }, { threshold: 0.05 }).observe(hero);
    }
  }

  // ── The booking form ─────────────────────────────────────────────────
  var form = $("[data-book]");
  if (!form) return;
  var msg = $("[data-msg]", form);
  var EMAIL = "hello@subjectmedias.com";
  var PAY = {
    photo: ["Pay for photo coverage", "https://buy.stripe.com/28E00kgz1dmqckMcgxebu04"],
    video: ["Pay for video coverage", "https://buy.stripe.com/eVqfZidmP5TY70seoFebu05"],
    elite: ["Pay for elite coverage", "https://buy.stripe.com/dRm14o82vbeidoQ5S9ebu03"],
    transcript: ["Pay for the transcript", "https://buy.stripe.com/dRmcN61E7gyC98Aa8pebu02"],
  };

  // Today in the visitor's own time zone is the earliest date.
  var d = new Date();
  form.event_date.min = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

  function kind() { var k = $("input[name=kind]:checked", form); return k ? k.value : "athlete"; }
  function syncKind() {
    $$("[data-only]", form).forEach(function (el) { el.hidden = el.getAttribute("data-only") !== kind(); });
  }
  $$("input[name=kind]", form).forEach(function (r) { r.addEventListener("change", syncKind); });
  syncKind();

  // "Plan team coverage" and "Plan event coverage" open the form set up for them.
  $$("[data-kind]").forEach(function (a) {
    a.addEventListener("click", function () {
      var k = a.getAttribute("data-kind");
      var r = $("input[name=kind][value=" + k + "]", form);
      if (r) { r.checked = true; syncKind(); }
      form.package.value = k === "team" ? "team" : k === "event" ? "event" : form.package.value;
    });
  });

  function say(text, bad) {
    msg.textContent = text;
    msg.classList.toggle("err", !!bad);
  }
  function mark(fields) {
    $$("[data-f]", form).forEach(function (el) { el.classList.toggle("bad", fields.indexOf(el.getAttribute("data-f")) !== -1); });
  }
  function body() {
    var v = function (n) { var el = form.elements[n]; return el ? String(el.value || "").trim() : ""; };
    return {
      kind: kind(),
      package: v("package"),
      sport: v("sport"),
      event_name: v("event_name"),
      event_date: v("event_date"),
      event_city: v("event_city"),
      event_state: v("event_state"),
      team_jersey: kind() === "athlete" ? v("team_jersey") : "",
      athletes: v("athletes"),
      contact_name: v("contact_name"),
      contact_email: v("contact_email"),
      contact_phone: v("contact_phone"),
      notes: v("notes"),
      adult_confirmed: form.adult_confirmed.checked,
      company: v("company"),
    };
  }
  function missing(b) {
    var out = [];
    ["event_date", "event_city", "event_state", "contact_name", "contact_email"].forEach(function (k) { if (!b[k]) out.push(k); });
    // The same plain-address rule the TOJ app keeps.
    if (b.contact_email && !/^[a-z0-9._+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(b.contact_email.toLowerCase())) out.push("contact_email");
    if (!b.adult_confirmed) out.push("adult_confirmed");
    return out;
  }
  function fallback(text) {
    say("", false);
    msg.innerHTML = "";
    msg.classList.add("err");
    msg.appendChild(document.createTextNode(text + " Email " + EMAIL + " or DM @subjectmedias. "));
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pill pill-line";
    b.style.minHeight = "38px";
    b.style.padding = "0.5em 1em";
    b.textContent = "Copy the email";
    b.addEventListener("click", function () {
      var done = function (t) { b.textContent = t; };
      try { navigator.clipboard.writeText(EMAIL).then(function () { done("Copied"); }, function () { done(EMAIL); }); }
      catch (e) { done(EMAIL); }
    });
    msg.appendChild(b);
  }
  // The package's payment link, carrying this request's id so the payment
  // joins it in the TOJ app, with the booker's email filled in.
  function payLink(url, id, email) {
    var q = [];
    if (id && /^[0-9a-f-]{36}$/i.test(id)) q.push("client_reference_id=" + encodeURIComponent(id));
    if (email) q.push("prefilled_email=" + encodeURIComponent(email));
    return url + (q.length ? "?" + q.join("&") : "");
  }
  function success(b, id) {
    var slot = $("[data-book-slot]");
    var pay = PAY[b.package];
    slot.innerHTML =
      '<div class="done" tabindex="-1"><h3>Got it.</h3>' +
      "<p>We'll reach out within 24 hours to lock your creator" + (b.contact_phone ? " by text or call" : " by email") + ". Keep an eye out for a message from " + EMAIL + ".</p>" +
      (pay ? '<p>Want it locked in now? Pay for the package and we\'ll match it to this request.</p><div class="btns"><a class="pill pill-green" href="' + payLink(pay[1], id, b.contact_email).replace(/"/g, "&quot;") + '">' + pay[0] + "</a></div>" : "") +
      "</div>";
    var done = $(".done", slot);
    if (done) done.focus();
  }

  var sending = false;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending) return;
    var b = body();
    var miss = missing(b);
    mark(miss);
    if (miss.length) { say("Check the highlighted fields.", true); var first = $(".bad input, .bad select, .bad textarea", form); if (first) first.focus(); return; }
    sending = true;
    var btn = $("button[type=submit]", form);
    btn.disabled = true;
    say("Sending…", false);
    fetch("/api/book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (data) { return { status: r.status, data: data }; }); })
      .then(function (res) {
        if (res.status === 200 && res.data && res.data.ok) return success(b, res.data.id);
        if (res.status === 400 && res.data && res.data.fields) { mark(res.data.fields); say("Check the highlighted fields.", true); return; }
        if (res.status === 429) return fallback("That's a lot of requests from here.");
        fallback("We couldn't send it just now.");
      })
      .catch(function () { fallback("We couldn't send it just now."); })
      .then(function () { sending = false; btn.disabled = false; });
  });
})();
