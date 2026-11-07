// /details?paid=cs_…: after a direct Buy, the buyer tells us about the game.
//
// Stripe sends the buyer here after paying (each payment link's redirect), and
// their thanks email links here too. The page asks api/details.js whether the
// checkout is a paid one of ours and whether we still need to hear about the
// game, then shows the form, or says what to do instead. The answers go to
// api/details.js, which checks the payment again and passes them to the TOJ
// app.
(function () {
  "use strict";

  var EMAIL = "hello@subjectmedias.com";
  var SESSION = /^cs_[A-Za-z0-9_]{8,200}$/;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var slot = $("[data-details-slot]");
  var wait = $("[data-details-wait]");
  var form = $("[data-details]");
  if (!slot || !form) return;
  var msg = $("[data-msg]", form);

  var sid = "";
  try { sid = new URLSearchParams(location.search).get("paid") || ""; } catch (e) { sid = ""; }
  var DONE = "sm_details_sent:" + sid;
  function remembered() { try { return sessionStorage.getItem(DONE) === "1"; } catch (e) { return false; } }
  function remember() { try { sessionStorage.setItem(DONE, "1"); } catch (e) { /* private mode */ } }

  // A panel in place of the form: a heading, a line, and maybe a button.
  function panel(title, line, button) {
    var box = document.createElement("div");
    box.className = "done";
    box.tabIndex = -1;
    var h = document.createElement("h2");
    h.textContent = title;
    var p = document.createElement("p");
    p.textContent = line;
    box.appendChild(h);
    box.appendChild(p);
    if (button) {
      var row = document.createElement("div");
      row.className = "btns";
      var a = document.createElement("a");
      a.className = "pill pill-green";
      a.href = button[1];
      a.textContent = button[0];
      row.appendChild(a);
      box.appendChild(row);
    }
    slot.innerHTML = "";
    slot.appendChild(box);
    box.focus({ preventScroll: true });
  }
  var byEmail = "Email the date, the city and state, and the team and jersey number to " + EMAIL + ", with the email you paid with, and we'll take it from there.";
  function notFound() {
    panel("We couldn't find that payment.", "If you paid, write to " + EMAIL + " with the email you paid with and we'll sort it out. Looking to book a game?", ["Book coverage", "/#book"]);
  }
  function sent(already) {
    remember();
    panel(already ? "We have your details." : "Got it.", already ? "You told us about the game already. We'll be in touch within 24 hours to confirm." : "We'll be in touch within 24 hours to confirm and line up your creator. Keep an eye out for a message from " + EMAIL + ".");
  }
  function showForm() {
    if (wait) wait.hidden = true;
    form.hidden = false;
    var d = new Date(), pad = function (n) { return String(n).padStart(2, "0"); };
    form.event_date.min = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  if (!SESSION.test(sid)) return notFound();
  if (remembered()) return sent(true);

  fetch("/api/details?session=" + encodeURIComponent(sid), { headers: { Accept: "application/json" } })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (data) { return { status: r.status, data: data }; }); })
    .then(function (res) {
      if (res.status === 200 && res.data.status === "need_details") return showForm();
      if (res.status === 200 && res.data.status === "have_details") return panel("You're all set.", "Your payment is matched to the request you sent, so we know the game. We'll be in touch within 24 hours to confirm.");
      if (res.status === 404) return notFound();
      panel("Thanks for booking.", byEmail);
    })
    .catch(function () { panel("Thanks for booking.", byEmail); });

  // ── The form ─────────────────────────────────────────────────────────
  function say(text, bad) { msg.textContent = text; msg.classList.toggle("err", !!bad); }
  function mark(fields) { $$("[data-f]", form).forEach(function (el) { el.classList.toggle("bad", fields.indexOf(el.getAttribute("data-f")) !== -1); }); }
  function body() {
    var v = function (n) { var el = form.elements[n]; return el ? String(el.value || "").trim() : ""; };
    return {
      stripe_session_id: sid,
      sport: v("sport"),
      event_name: v("event_name"),
      event_date: v("event_date"),
      event_city: v("event_city"),
      event_state: v("event_state"),
      team_jersey: v("team_jersey"),
      athletes: v("athletes"),
      contact_phone: v("contact_phone"),
      notes: v("notes"),
      adult_confirmed: form.adult_confirmed.checked,
      company: v("company"),
    };
  }
  function missing(b) {
    var out = [];
    ["event_date", "event_city", "event_state"].forEach(function (k) { if (!b[k]) out.push(k); });
    if (!b.adult_confirmed) out.push("adult_confirmed");
    return out;
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
    fetch("/api/details", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (data) { return { status: r.status, data: data }; }); })
      .then(function (res) {
        if (res.status === 200 && res.data.ok) return sent(res.data.already === true);
        if (res.status === 400 && res.data.fields) { mark(res.data.fields); say("Check the highlighted fields.", true); return; }
        if (res.status === 409) return panel("You're all set.", "Your payment is matched to the request you sent, so we know the game. We'll be in touch within 24 hours to confirm.");
        if (res.status === 404) return notFound();
        say(res.status === 429 ? "That's a lot of tries from here. " + byEmail : "We couldn't send it just now. " + byEmail, true);
      })
      .catch(function () { say("We couldn't send it just now. " + byEmail, true); })
      .then(function () { sending = false; btn.disabled = false; });
  });
})();
