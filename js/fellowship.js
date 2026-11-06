// The fellowship page: the hero's three steps in the viewfinder, and the
// application form, which posts to /api/apply (api/apply.js passes it to the
// TOJ app, where Kyron reviews it).
(function () {
  "use strict";

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var pad = function (n) { return String(n).padStart(2, "0"); };

  // ── The hero: Shadow, Shoot, Lead, one at a time in the viewfinder ─────
  var hero = $(".fhero");
  if (hero) {
    var steps = $$("[data-step]", hero);
    var shots = $$(".vf-shot", hero);
    var label = $("[data-fv-step]", hero);
    var tc = $("[data-fv-tc]", hero);
    var af = $("[data-fv-af]", hero);
    var NAMES = ["Shadow", "Shoot", "Lead"];
    var at = 0, timer = 0, raf = 0, lock = 0;
    var load = function (img) { if (img && !img.getAttribute("src") && img.getAttribute("data-src")) img.setAttribute("src", img.getAttribute("data-src")); };
    function show(n) {
      at = n;
      steps.forEach(function (s, j) { s.classList.toggle("on", j === n); });
      shots.forEach(function (s, j) { if (j === n) load(s); s.classList.toggle("on", j === n); });
      load(shots[(n + 1) % shots.length]);
      if (label) label.textContent = NAMES[n] || "";
      if (af) {
        af.classList.remove("locked");
        clearTimeout(lock);
        lock = setTimeout(function () { af.classList.add("locked"); }, 650);
      }
    }
    var base = ((12 * 60) + 4) * 60 + 17, t0 = 0;
    function tick(now) {
      if (!t0) t0 = now;
      var f = base + Math.floor(((now - t0) / 1000) * 60), ff = f % 60, sec = Math.floor(f / 60);
      tc.textContent = pad(Math.floor(sec / 3600)) + ":" + pad(Math.floor(sec / 60) % 60) + ":" + pad(sec % 60) + ":" + pad(ff);
      raf = requestAnimationFrame(tick);
    }
    function run(on) {
      clearInterval(timer);
      cancelAnimationFrame(raf);
      timer = 0;
      if (!on) return;
      timer = setInterval(function () { show((at + 1) % steps.length); }, 3200);
      if (tc) raf = requestAnimationFrame(tick);
    }
    if (reduce) {
      // Still: the first creator, all three words at full strength.
      if (af) af.classList.add("locked");
    } else {
      hero.classList.add("cycling");
      show(0);
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (es) {
          es.forEach(function (e) { run(e.isIntersecting && !document.hidden); });
        }, { threshold: 0.2 }).observe(hero);
      } else run(true);
      document.addEventListener("visibilitychange", function () {
        var r = hero.getBoundingClientRect();
        run(!document.hidden && r.bottom > 0 && r.top < window.innerHeight);
      });
    }
  }

  // ── The application ──────────────────────────────────────────────────
  var form = $("[data-apply]");
  if (!form) return;
  var msg = $("[data-msg]", form);
  var EMAIL = "hello@subjectmedias.com";
  var CONFIRM = {
    adult: "I'm 18 or older, and the work I'm sending is mine.",
    teen: "I'm 16 or 17, my parent or guardian knows I'm applying, and the work I'm sending is mine.",
    none: "I'm 16 or older, and the work I'm sending is mine.",
  };
  var submit = $("button[type=submit]", form);

  function age() { var r = $("input[name=age_group]:checked", form); return r ? r.value : ""; }
  function syncAge() {
    var a = age();
    $$("[data-only-age]", form).forEach(function (el) { el.hidden = el.getAttribute("data-only-age") !== a; });
    // At 16 or 17, only the seats open at 16 or 17.
    var seat = form.elements.seat;
    $$("option[data-adult]", seat).forEach(function (o) { o.disabled = a === "teen"; });
    if (a === "teen" && seat.selectedOptions[0] && seat.selectedOptions[0].disabled) seat.value = "unsure";
    $("[data-confirm-text]", form).textContent = CONFIRM[a] || CONFIRM.none;
    submit.disabled = a === "under";
  }
  $$("input[name=age_group]", form).forEach(function (r) { r.addEventListener("change", syncAge); });
  syncAge();

  // "Apply for this plan" picks that plan in the form.
  $$("[data-plan]").forEach(function (a) {
    a.addEventListener("click", function () { form.elements.plan.value = a.getAttribute("data-plan"); });
  });

  function say(text, bad) {
    msg.textContent = text;
    msg.classList.toggle("err", !!bad);
  }
  function mark(fields) {
    $$("[data-f]", form).forEach(function (el) { el.classList.toggle("bad", fields.indexOf(el.getAttribute("data-f")) !== -1); });
  }
  var v = function (n) { var el = form.elements[n]; return el ? String(el.value || "").trim() : ""; };
  function body() {
    var a = age();
    var teen = a === "teen";
    return {
      name: v("name"),
      email: v("email"),
      phone: v("phone"),
      city: v("city"),
      state: v("state"),
      age_group: a,
      guardian_name: teen ? v("guardian_name") : "",
      guardian_email: teen ? v("guardian_email") : "",
      guardian_phone: teen ? v("guardian_phone") : "",
      seat: v("seat"),
      plan: v("plan"),
      links: [v("link1"), v("link2"), v("link3")],
      handle: v("handle"),
      gear: v("gear"),
      about: v("about"),
      confirmed: form.elements.confirmed.checked,
      sm_trap: v("sm_trap"),
    };
  }
  // The same plain-address rule the TOJ app keeps.
  var okEmail = function (e) { return /^[a-z0-9._+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(String(e).toLowerCase()); };
  function missing(b) {
    var out = [];
    ["name", "city", "state"].forEach(function (k) { if (!b[k]) out.push(k); });
    if (!okEmail(b.email)) out.push("email");
    if (b.age_group !== "adult" && b.age_group !== "teen") out.push("age_group");
    if (b.age_group === "teen") {
      if (!b.guardian_name) out.push("guardian_name");
      if (!okEmail(b.guardian_email) || b.guardian_email.toLowerCase() === b.email.toLowerCase()) out.push("guardian_email");
    }
    if (!b.links.some(Boolean)) out.push("link1");
    if (!b.confirmed) out.push("confirmed");
    return out;
  }
  function fallback(text) {
    say("", false);
    msg.innerHTML = "";
    msg.classList.add("err");
    msg.appendChild(document.createTextNode(text + " Email your work to " + EMAIL + " or DM @subjectmedias. "));
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
  function success(b) {
    var slot = $("[data-apply-slot]");
    var teen = b.age_group === "teen";
    slot.innerHTML =
      '<div class="done" tabindex="-1"><h3>Got it.</h3>' +
      "<p>Kyron reviews every application, and we reply within 48 hours" + (teen ? " to you and your parent or guardian" : "") + ". Keep an eye out for an email from " + EMAIL + ".</p>" +
      "<p>Until then, keep shooting. The more of your work we can see, the better the call goes.</p>" +
      "</div>";
    var done = $(".done", slot);
    if (done) done.focus();
  }

  var sending = false;
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending || age() === "under") return;
    var b = body();
    var miss = missing(b);
    mark(miss);
    if (miss.length) {
      say("Check the highlighted fields.", true);
      var first = $(".bad input, .bad select, .bad textarea", form);
      if (first) first.focus();
      return;
    }
    sending = true;
    submit.disabled = true;
    say("Sending…", false);
    fetch("/api/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (data) { return { status: r.status, data: data }; }); })
      .then(function (res) {
        if (res.status === 200 && res.data && res.data.ok) return success(b);
        // Fields to fix: point at them. Refused with nothing to point at: the
        // email, so the applicant is never stuck.
        if (res.status === 400 && res.data && Array.isArray(res.data.fields) && res.data.fields.length) {
          mark(res.data.fields);
          say("Check the highlighted fields.", true);
          return;
        }
        if (res.status === 429) return fallback("We can't take more applications from here right now.");
        fallback("We couldn't send it just now.");
      })
      .catch(function () { fallback("We couldn't send it just now."); })
      .then(function () { sending = false; submit.disabled = age() === "under"; });
  });
})();
