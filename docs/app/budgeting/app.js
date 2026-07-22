/* AGP - Build Your Budget (bucket model)
   Self-contained, no backend. Runs on the athlete's phone, saves to localStorage.
   Per-school branding via ?school= param. QR-able as a standalone activity.
   No em dashes in any user-facing copy. */

(function () {
  "use strict";

  /* ---------------- per-school branding ---------------- */
  // Content is identical for every school; only name + colors change.
  // Logo stays the AGP mark until a co-branded logo file is added per school.
  var SCHOOLS = {
    agp:     { name: "",                primary: "#10243F", accent: "#1FB57A" },
    ecu:     { name: "East Carolina",   primary: "#592C82", accent: "#FDC82F" },
    ccu:     { name: "Coastal Carolina",primary: "#006F71", accent: "#A27752" },
    gonzaga: { name: "Gonzaga",         primary: "#041E42", accent: "#C8102E" },
    shsu:    { name: "Sam Houston",     primary: "#F56423", accent: "#10243F" }
  };

  function applyBranding() {
    var key = (new URLSearchParams(window.location.search).get("school") || "agp").toLowerCase();
    var cfg = SCHOOLS[key] || SCHOOLS.agp;
    document.documentElement.style.setProperty("--primary", cfg.primary);
    document.documentElement.style.setProperty("--accent", cfg.accent);
    document.querySelector('meta[name="theme-color"]').setAttribute("content", cfg.primary);
    var sub = document.getElementById("brandSchool");
    if (cfg.name) sub.textContent = cfg.name + " Athletics";
  }

  /* ---------------- state ---------------- */
  var KEY = "agp_budget_v2";
  var state = {
    screen: "welcome",
    goal: "",
    income: { stipend: { amt: 0, freq: "monthly" }, nil: { amt: 0, freq: "monthly" }, job: { amt: 0, freq: "monthly" }, family: { amt: 0, freq: "monthly" }, other: { amt: 0, freq: "monthly" } },
    buckets: { tax: 0, expenses: 0, emergency: 0, investing: 0, fun: 0 },
    expenseItems: { rent: 0, phone: 0, groceries: 0, eatingout: 0, transport: 0, subs: 0, other: 0 },
    customExpenses: [],
    emergencyTarget: 1000,
    nilLevelIdx: -1,
    favMemory: "",
    memoryRevealed: false
  };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        Object.keys(saved).forEach(function (k) {
          if (k === "income" || k === "buckets" || k === "expenseItems") {
            Object.assign(state[k], saved[k] || {});
          } else if (k !== "screen") {
            state[k] = saved[k];
          }
        });
      }
    } catch (e) { /* ignore corrupt state */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function reset() {
    localStorage.removeItem(KEY);
    state.screen = "welcome"; state.goal = ""; state.favMemory = ""; state.memoryRevealed = false;
    state.income = { stipend: { amt: 0, freq: "monthly" }, nil: { amt: 0, freq: "monthly" }, job: { amt: 0, freq: "monthly" }, family: { amt: 0, freq: "monthly" }, other: { amt: 0, freq: "monthly" } };
    state.buckets = { tax: 0, expenses: 0, emergency: 0, investing: 0, fun: 0 };
    state.expenseItems = { rent: 0, phone: 0, groceries: 0, eatingout: 0, transport: 0, subs: 0, other: 0 };
    state.customExpenses = [];
    state.emergencyTarget = 1000;
    state.nilLevelIdx = -1;
    render();
  }

  /* ---------------- helpers ---------------- */
  function num(v) { var n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }
  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function sum(obj) { return Object.keys(obj).reduce(function (t, k) { return t + num(obj[k]); }, 0); }
  var FREQS = [
    { k: "weekly",   label: "Weekly",           pm: 52 / 12 },
    { k: "biweekly", label: "Every other week", pm: 26 / 12 },
    { k: "monthly",  label: "Monthly",          pm: 1 },
    { k: "every2mo", label: "Every 2 months",   pm: 1 / 2 },
    { k: "every3mo", label: "Every 3 months",   pm: 1 / 3 },
    { k: "every4mo", label: "Every 4 months",   pm: 1 / 4 },
    { k: "every6mo", label: "Every 6 months",   pm: 1 / 6 },
    { k: "every9mo", label: "Every 9 months",   pm: 1 / 9 },
    { k: "yearly",   label: "Every year",       pm: 1 / 12 }
  ];
  var FREQ_PM = {};
  FREQS.forEach(function (f) { FREQ_PM[f.k] = f.pm; });
  function toMonthly(src) { return src ? num(src.amt) * (FREQ_PM[src.freq] || 1) : 0; }
  function nilMonthly() { return toMonthly(state.income.nil); }
  function totalIncome() { return Object.keys(state.income).reduce(function (t, k) { return t + toMonthly(state.income[k]); }, 0); }
  function hasNil() { return nilMonthly() > 0; }
  // Estimated total set-aside (self-employment + federal income tax) by annual NIL level. Editable.
  var TAX_LEVELS = [
    { label: "Below $16,100",        pct: 0.15 },
    { label: "$16,100 to $50,000",   pct: 0.22 },
    { label: "$50,000 to $105,000",  pct: 0.28 },
    { label: "$105,000 to $201,000", pct: 0.32 },
    { label: "$201,000 to $250,000", pct: 0.35 },
    { label: "Over $250,000",        pct: 0.38 }
  ];
  function taxSetAside(idx, mo) { return (idx >= 0 && idx < TAX_LEVELS.length) ? Math.round(TAX_LEVELS[idx].pct * mo) : 0; }
  function allocated() {
    var b = state.buckets;
    return num(b.tax) + num(b.expenses) + num(b.emergency) + num(b.investing) + num(b.fun);
  }
  function leftToAssign() { return totalIncome() - allocated(); }
  function pct(n) { var t = totalIncome(); return t > 0 ? Math.round((n / t) * 100) : 0; }
  function fvMonthly(pmt, annual, years) {
    var r = annual / 12, n = years * 12;
    if (r === 0) return pmt * n;
    return pmt * ((Math.pow(1 + r, n) - 1) / r);
  }
  function el(html) { var d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }
  function go(screen) { state.screen = screen; save(); render(); window.scrollTo(0, 0); }

  var BUCKETS = [
    { key: "tax",       name: "Taxes",         color: "var(--tax)", desc: "Set aside for what you owe. This was never really yours.", nilOnly: true },
    { key: "expenses",  name: "Expenses",      color: "var(--exp)", desc: "Your needs: housing, phone, food, transport." },
    { key: "emergency", name: "Emergency Fund",color: "var(--emg)", desc: "A cushion so one surprise is not a crisis." },
    { key: "investing", name: "Investing",     color: "var(--inv)", desc: "Pay yourself first. Future you says thanks." },
    { key: "fun",       name: "Fun",           color: "var(--fun)", desc: "Guilt-free spending on what you enjoy." }
  ];
  function activeBuckets() { return BUCKETS.filter(function (b) { return !b.nilOnly || hasNil(); }); }

  /* ---------------- render ---------------- */
  var app = document.getElementById("app");

  function render() {
    if (state.screen === "welcome") return renderWelcome();
    if (state.screen === "goal") return renderGoal();
    if (state.screen === "income") return renderIncome();
    if (state.screen === "allocate") return renderAllocate();
    if (state.screen === "summary") return renderSummary();
  }

  function progress(stepIdx) {
    var dots = [0, 1, 2, 3].map(function (i) { return '<i class="' + (i <= stepIdx ? "on" : "") + '"></i>'; }).join("");
    return '<div class="progress">' + dots + '</div>';
  }

  function renderWelcome() {
    app.innerHTML = "";
    app.appendChild(el(
      '<div class="screen">' +
        '<div class="card">' +
          '<span class="step-tag">The bucket method</span>' +
          '<h1 class="title">A Starter Guide to Your Budget</h1>' +
          '<p class="lede">A short, easy guide to understanding the money you have coming in, where it needs to go, and how to make the most of it.</p>' +
          '<button class="btn" id="start">Start</button>' +
          '<button class="btn ghost" id="reset">Start over</button>' +
        '</div>' +
        '<p class="hint" style="text-align:center">Takes about 5 minutes. Nothing you enter leaves your phone.</p>' +
      '</div>'
    ));
    document.getElementById("start").onclick = function () { go("goal"); };
    document.getElementById("reset").onclick = function () { if (confirm("Clear everything and start fresh?")) reset(); };
  }

  function renderGoal() {
    app.innerHTML = "";
    app.appendChild(el(
      '<div class="screen">' + progress(0) +
        '<div class="card">' +
          '<span class="step-tag">Step 1 of 4</span>' +
          '<h1 class="title">What are you saving toward?</h1>' +
          '<p class="lede">Name one thing you want your money to do for you. It makes every bucket decision easier.</p>' +
          '<label class="fld" for="goal">Your goal right now</label>' +
          '<input type="text" id="goal" placeholder="A trip home, a car, moving out, a cushion..." value="' + escAttr(state.goal) + '">' +
          '<p class="hint">No wrong answer. It can be big or small.</p>' +
          '<button class="btn" id="next">Continue</button>' +
          '<button class="btn ghost" id="back">Back</button>' +
        '</div>' +
      '</div>'
    ));
    document.getElementById("next").onclick = function () {
      state.goal = document.getElementById("goal").value.trim(); save(); go("income");
    };
    document.getElementById("back").onclick = function () { go("welcome"); };
  }

  function renderIncome() {
    var i = state.income;
    app.innerHTML = "";
    app.appendChild(el(
      '<div class="screen">' + progress(1) +
        '<div class="card">' +
          '<span class="step-tag">Step 2 of 4</span>' +
          '<h1 class="title">What money do you have coming in?</h1>' +
          '<p class="lede">It is important to understand how much money is paid into your account each month. Select how often you are paid and how much to calculate your monthly income.</p>' +
          incRow("stipend", "Scholarship / Stipend / Cost of Attendance", i.stipend) +
          incRow("nil", "NIL income", i.nil) +
          incRow("job", "Part-time job", i.job) +
          incRow("family", "Family help", i.family) +
          incRow("other", "Anything else", i.other) +
          '<div class="pool" style="margin-top:16px"><span class="lbl">Monthly income</span><span class="amt" id="incTotal">' + money(totalIncome()) + '</span></div>' +
          '<div class="callout tax" id="nilNote" style="' + (hasNil() ? "" : "display:none") + '">' +
            '<b>Heads up on NIL.</b> NIL income has no taxes taken out, so a Taxes bucket will show up next. You will need to set aside some of it for taxes, and we will help you figure out how much.' +
          '</div>' +
          '<button class="btn" id="next">Continue</button>' +
          '<button class="btn ghost" id="back">Back</button>' +
        '</div>' +
      '</div>'
    ));
    Object.keys(i).forEach(function (k) {
      var amt = document.getElementById("inc_" + k + "_amt");
      var freq = document.getElementById("inc_" + k + "_freq");
      function upd() {
        state.income[k].amt = num(amt.value);
        state.income[k].freq = freq.value;
        document.getElementById("inc_" + k + "_mo").textContent = monthlyLabel(state.income[k]);
        document.getElementById("incTotal").textContent = money(totalIncome());
        document.getElementById("nilNote").style.display = hasNil() ? "" : "none";
        save();
      }
      amt.addEventListener("input", upd);
      freq.addEventListener("change", upd);
    });
    document.getElementById("next").onclick = function () {
      if (totalIncome() <= 0) { alert("Add at least one income source to keep going."); return; }
      go("allocate");
    };
    document.getElementById("back").onclick = function () { go("goal"); };
  }
  function monthlyLabel(src) {
    var m = toMonthly(src);
    return m > 0 ? "= " + money(m) + " / month" : "";
  }
  function incRow(key, label, src) {
    var opts = FREQS.map(function (f) {
      return '<option value="' + f.k + '"' + (src.freq === f.k ? " selected" : "") + '>' + f.label + '</option>';
    }).join("");
    return '<label class="fld" for="inc_' + key + '_amt">' + label + '</label>' +
      '<div class="inc-controls">' +
        '<div class="money-in"><input type="number" inputmode="decimal" id="inc_' + key + '_amt" placeholder="0" value="' + (src.amt ? src.amt : "") + '"></div>' +
        '<select class="freq" id="inc_' + key + '_freq">' + opts + '</select>' +
      '</div>' +
      '<div class="inc-mo" id="inc_' + key + '_mo">' + monthlyLabel(src) + '</div>';
  }

  function renderAllocate() {
    app.innerHTML = "";
    var bucketHtml = activeBuckets().map(function (b) {
      return '<div class="bucket" style="--b:' + b.color + '">' +
        '<div class="top">' +
          '<div><div class="name"><span class="dot"></span>' + b.name + '</div><div class="desc">' + b.desc + '</div></div>' +
          '<div class="amtbox"><div class="money-in"><input type="number" inputmode="decimal" id="bk_' + b.key + '" placeholder="0" value="' + (state.buckets[b.key] ? state.buckets[b.key] : "") + '"></div></div>' +
        '</div>' +
        '<div class="more"><a data-drill="' + b.key + '">Details and tips</a><span class="pct" id="pct_' + b.key + '">' + pct(num(state.buckets[b.key])) + '% of income</span></div>' +
      '</div>';
    }).join("");

    app.appendChild(el(
      '<div class="screen">' + progress(2) +
        '<div class="pool"><span class="lbl">Monthly income</span><span class="amt">' + money(totalIncome()) + '</span></div>' +
        '<div class="counter" id="counter"><span class="lbl">Left to assign</span><span class="val" id="leftVal"></span></div>' +
        '<p class="hint" style="margin:-6px 0 14px">Split your income until every dollar has a job. Tap <b>Details and tips</b> on any bucket to go deeper.</p>' +
        bucketHtml +
        '<button class="btn" id="next">See my budget</button>' +
        '<button class="btn ghost" id="back">Back</button>' +
      '</div>'
    ));

    activeBuckets().forEach(function (b) {
      var inp = document.getElementById("bk_" + b.key);
      inp.addEventListener("input", function () { state.buckets[b.key] = num(inp.value); updateTotals(); save(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-drill]"), function (a) {
      a.onclick = function () { openSheet(a.getAttribute("data-drill")); };
    });
    document.getElementById("next").onclick = function () { go("summary"); };
    document.getElementById("back").onclick = function () { go("income"); };
    updateTotals();
  }

  function updateTotals() {
    var left = leftToAssign();
    var c = document.getElementById("counter");
    var v = document.getElementById("leftVal");
    if (!c) return;
    v.textContent = money(left);
    c.classList.remove("ok", "over", "under");
    if (Math.abs(left) < 1) { c.classList.add("ok"); v.textContent = money(0) + "  done"; }
    else if (left < 0) c.classList.add("over");
    else c.classList.add("under");
    activeBuckets().forEach(function (b) {
      var p = document.getElementById("pct_" + b.key);
      if (p) p.textContent = pct(num(state.buckets[b.key])) + "% of income";
    });
  }

  /* ---------------- drilldown sheets ---------------- */
  var overlay = document.getElementById("overlay");
  var sheet = document.getElementById("sheet");
  function closeSheet() { overlay.classList.add("hidden"); renderAllocate(); }
  function openSheet(kind) {
    sheet.innerHTML = "";
    if (kind === "tax") sheet.appendChild(taxSheet());
    else if (kind === "expenses") sheet.appendChild(expenseSheet());
    else if (kind === "emergency") sheet.appendChild(emergencySheet());
    else if (kind === "investing") sheet.appendChild(investingSheet());
    else if (kind === "fun") sheet.appendChild(funSheet());
    overlay.classList.remove("hidden");
    overlay.onclick = function (e) { if (e.target === overlay) closeSheet(); };
  }
  function sheetHead(title, sub) {
    return '<span class="close" data-close>&times;</span><h2>' + title + '</h2><p class="sub">' + sub + '</p>';
  }
  function wireClose(node) {
    Array.prototype.forEach.call(node.querySelectorAll("[data-close]"), function (c) { c.onclick = closeSheet; });
  }

  function taxCalcMsg(idx, mo) {
    if (idx < 0) return "Pick your level above and we will estimate what to set aside each month.";
    var p = Math.round(TAX_LEVELS[idx].pct * 100);
    return "At this level, set aside about <b>" + p + "%</b> for taxes. On your <b>" + money(mo) +
           "</b> a month of NIL, that is about <b>" + money(taxSetAside(idx, mo)) + "</b> a month.";
  }
  function taxSheet() {
    var mo = nilMonthly();
    var idx = (typeof state.nilLevelIdx === "number") ? state.nilLevelIdx : -1;
    var opts = '<option value="-1">Select your level...</option>' + TAX_LEVELS.map(function (l, i) {
      return '<option value="' + i + '"' + (idx === i ? " selected" : "") + '>' + l.label + '</option>';
    }).join("");
    var node = el('<div>' + sheetHead("Taxes", "NIL and other 1099 income has no taxes withheld, so you set your own aside. How much depends on how much you make, so tell us your level.") +
      '<label class="fld" for="nilLevel">Your total NIL income for the year</label>' +
      '<select class="freq" id="nilLevel" style="width:100%;max-width:100%">' + opts + '</select>' +
      '<div class="callout tax" id="taxCalc">' + taxCalcMsg(idx, mo) + '</div>' +
      '<div class="disclaimer">This is an estimate, not exactly what you will owe. It does not include state taxes, and your real bill depends on your full situation. Always consult a CPA or tax professional.</div>' +
      '<p class="hint">Keep the money in a separate account so you are not tempted to spend it.</p>' +
      '<button class="btn" id="taxUse"' + (idx < 0 ? " disabled" : "") + '>' + (idx < 0 ? "Select a level first" : "Use " + money(taxSetAside(idx, mo))) + '</button>' +
      '<button class="btn secondary" data-close>Done</button></div>');
    var sel = node.querySelector("#nilLevel");
    sel.addEventListener("change", function () {
      state.nilLevelIdx = parseInt(this.value, 10);
      save();
      var i = state.nilLevelIdx;
      node.querySelector("#taxCalc").innerHTML = taxCalcMsg(i, mo);
      var btn = node.querySelector("#taxUse");
      btn.textContent = i < 0 ? "Select a level first" : "Use " + money(taxSetAside(i, mo));
      btn.disabled = i < 0;
    });
    node.querySelector("#taxUse").onclick = function () {
      var i = state.nilLevelIdx;
      if (i < 0) return;
      state.buckets.tax = taxSetAside(i, mo);
      save(); closeSheet();
    };
    wireClose(node);
    return node;
  }

  function expensesTotal() {
    return sum(state.expenseItems) + state.customExpenses.reduce(function (t, c) { return t + num(c.amt); }, 0);
  }
  function expenseSheet() {
    var items = [
      ["rent", "Housing / rent"], ["phone", "Phone / internet"], ["groceries", "Groceries"],
      ["eatingout", "Eating out / delivery"], ["transport", "Car (payment, insurance, gas)"],
      ["subs", "Subscriptions"], ["other", "Other needs"]
    ];
    var rows = items.map(function (it) {
      return '<div class="li"><span class="li-name">' + it[1] + '</span>' +
        '<span class="li-amt"><span class="money-in"><input type="number" inputmode="decimal" id="ex_' + it[0] + '" placeholder="0" value="' + (state.expenseItems[it[0]] ? state.expenseItems[it[0]] : "") + '"></span></span></div>';
    }).join("");
    var customRows = state.customExpenses.map(function (c, i) {
      return '<div class="li"><input class="li-name-input" type="text" id="cx_name_' + i + '" placeholder="Add a cost..." value="' + escAttr(c.name) + '">' +
        '<span class="li-amt"><span class="money-in"><input type="number" inputmode="decimal" id="cx_amt_' + i + '" placeholder="0" value="' + (c.amt ? c.amt : "") + '"></span></span>' +
        '<span class="li-del" data-del="' + i + '" title="Remove">&times;</span></div>';
    }).join("");
    var node = el('<div>' + sheetHead("Expenses", "List your needs. The total flows back into your Expenses bucket.") +
      rows + customRows +
      '<button class="btn ghost" id="addLine" style="margin:2px 0 8px">+ Add a line</button>' +
      '<div class="callout warn"><b>Subscription check.</b> Open your phone settings and look at your subscriptions right now. Most people find one they forgot. Cancel it and watch this number drop.</div>' +
      '<div class="subtotal"><span>Expenses total</span><span id="exTotal">' + money(expensesTotal()) + '</span></div>' +
      '<button class="btn" data-close>Save to bucket</button></div>');
    function refreshTotal() {
      state.buckets.expenses = expensesTotal();
      node.querySelector("#exTotal").textContent = money(state.buckets.expenses);
      save();
    }
    items.forEach(function (it) {
      node.querySelector("#ex_" + it[0]).addEventListener("input", function () {
        state.expenseItems[it[0]] = num(this.value); refreshTotal();
      });
    });
    state.customExpenses.forEach(function (c, i) {
      node.querySelector("#cx_name_" + i).addEventListener("input", function () { c.name = this.value; save(); });
      node.querySelector("#cx_amt_" + i).addEventListener("input", function () { c.amt = num(this.value); refreshTotal(); });
    });
    Array.prototype.forEach.call(node.querySelectorAll("[data-del]"), function (x) {
      x.onclick = function () {
        state.customExpenses.splice(parseInt(x.getAttribute("data-del"), 10), 1);
        state.buckets.expenses = expensesTotal(); save();
        openSheet("expenses");
      };
    });
    node.querySelector("#addLine").onclick = function () {
      state.customExpenses.push({ name: "", amt: 0 });
      save(); openSheet("expenses");
    };
    wireClose(node);
    return node;
  }

  function emergencySheet() {
    var monthly = num(state.buckets.emergency);
    var target = num(state.emergencyTarget) || 1000;
    var months = monthly > 0 ? Math.ceil(target / monthly) : null;
    var node = el('<div>' + sheetHead("Emergency Fund", "A starter cushion so a $400 surprise is not a credit-card spiral.") +
      '<label class="fld" for="emgT">Your starter target</label>' +
      '<div class="money-in"><input type="number" inputmode="decimal" id="emgT" value="' + target + '"></div>' +
      '<p class="hint">A common first target is about $1,000. Build the bigger 3 to 6 month fund later.</p>' +
      '<label class="fld" for="emgM">Set aside per month</label>' +
      '<div class="money-in"><input type="number" inputmode="decimal" id="emgM" placeholder="0" value="' + (monthly ? monthly : "") + '"></div>' +
      '<div class="callout" id="emgMsg">' + emgMsg(target, monthly) + '</div>' +
      '<button class="btn" data-close>Save to bucket</button></div>');
    function refresh() {
      var t = num(node.querySelector("#emgT").value), m = num(node.querySelector("#emgM").value);
      state.emergencyTarget = t; state.buckets.emergency = m;
      node.querySelector("#emgMsg").innerHTML = emgMsg(t, m); save();
    }
    node.querySelector("#emgT").addEventListener("input", refresh);
    node.querySelector("#emgM").addEventListener("input", refresh);
    wireClose(node);
    return node;
  }
  function emgMsg(target, monthly) {
    if (monthly <= 0) return "Even $20 a month starts the habit. The habit matters more than the amount.";
    var months = Math.ceil(target / monthly);
    return "At <b>" + money(monthly) + "</b> a month you hit your <b>" + money(target) + "</b> target in about <b>" + months + " month" + (months === 1 ? "" : "s") + "</b>.";
  }

  function investingSheet() {
    var monthly = num(state.buckets.investing);
    var fv = Math.round(fvMonthly(monthly, 0.10, 40));
    var node = el('<div>' + sheetHead("Investing", "Paying yourself first is how small, boring amounts turn into real money.") +
      '<label class="fld" for="invM">Invest per month</label>' +
      '<div class="money-in"><input type="number" inputmode="decimal" id="invM" placeholder="0" value="' + (monthly ? monthly : "") + '"></div>' +
      '<div class="callout"><span class="hint">Invested every month for 40 years, that could grow to</span>' +
      '<div class="big-figure" id="invFV">' + money(fv) + '</div>' +
      '<span class="hint">Illustration only, assuming a 10% average annual return. Real returns vary.</span></div>' +
      '<p class="hint">Start small and automatic. The most powerful button in investing is the boring one that keeps buying.</p>' +
      '<button class="btn" data-close>Save to bucket</button></div>');
    node.querySelector("#invM").addEventListener("input", function () {
      var m = num(this.value); state.buckets.investing = m;
      node.querySelector("#invFV").textContent = money(Math.round(fvMonthly(m, 0.10, 40))); save();
    });
    wireClose(node);
    return node;
  }

  function funSheet() {
    var monthly = num(state.buckets.fun);
    var node = el('<div>' + sheetHead("Fun", "This bucket is guilt-free. Spend it on purpose, not by accident.") +
      '<label class="fld" for="favMem">Before you set this number: what is your favorite memory from the past year?</label>' +
      '<input type="text" id="favMem" placeholder="Type it here..." value="' + escAttr(state.favMemory) + '">' +
      '<button class="btn secondary" id="reveal" style="margin-top:12px">Reveal</button>' +
      '<div id="revealBox" style="' + (state.memoryRevealed ? "" : "display:none") + '">' +
        '<div class="callout"><b>Notice something?</b> The best memories almost never come from the thing you spent the most money on. Fund your Fun bucket on what actually makes memories, the people and the experiences, not just what is easy to buy.</div>' +
      '</div>' +
      '<label class="fld" for="funM">Fun money per month</label>' +
      '<div class="money-in"><input type="number" inputmode="decimal" id="funM" placeholder="0" value="' + (monthly ? monthly : "") + '"></div>' +
      '<button class="btn" data-close>Save to bucket</button></div>');
    node.querySelector("#favMem").addEventListener("input", function () { state.favMemory = this.value; save(); });
    node.querySelector("#reveal").onclick = function () {
      state.memoryRevealed = true; node.querySelector("#revealBox").style.display = ""; save();
    };
    node.querySelector("#funM").addEventListener("input", function () { state.buckets.fun = num(this.value); save(); });
    wireClose(node);
    return node;
  }

  /* ---------------- summary ---------------- */
  function renderSummary() {
    app.innerHTML = "";
    var t = totalIncome(), left = leftToAssign();
    var bars = activeBuckets().map(function (b) {
      var p = t > 0 ? (num(state.buckets[b.key]) / t) * 100 : 0;
      return '<span style="width:' + p + '%;background:' + b.color + '"></span>';
    }).join("");
    var rows = activeBuckets().map(function (b) {
      return '<div class="sum-row"><span class="dot" style="background:' + b.color + '"></span>' +
        '<span class="nm">' + b.name + '</span>' +
        '<span class="pc">' + pct(num(state.buckets[b.key])) + '%</span>' +
        '<span class="vl">' + money(num(state.buckets[b.key])) + '</span></div>';
    }).join("");

    var coaches = buildCoaching().map(function (c) {
      return '<div class="coach ' + c.type + '"><span class="ic">' + c.ic + '</span><span>' + c.msg + '</span></div>';
    }).join("");

    var savingPct = pct(num(state.buckets.emergency) + num(state.buckets.investing));

    app.appendChild(el(
      '<div class="screen">' + progress(3) +
        '<div class="sum-hero"><span class="cap">Your monthly plan</span>' +
          '<div class="big">' + money(t) + '</div>' +
          '<div class="bar">' + bars + '</div>' +
          '<span class="cap">' + (Math.abs(left) < 1 ? "Every dollar has a job" : (left > 0 ? money(left) + " still unassigned" : money(-left) + " over budget")) + '</span>' +
        '</div>' +
        (state.goal ? '<div class="goal-chip">Working toward: ' + escHtml(state.goal) + '</div>' : "") +
        '<div class="card" style="padding:14px 16px">' + rows + '</div>' +
        coaches +
        '<div class="coach"><span class="ic">&#128202;</span><span>For reference, a common guideline is 50% needs, 30% wants, 20% saving. Your Emergency plus Investing is <b>' + savingPct + '%</b> of income.</span></div>' +
        '<div class="card" style="text-align:center">' +
          '<h3>Nice work. You have a plan.</h3>' +
          '<p class="sub">Screenshot this so it is on your phone. Run it for 30 days, then adjust.</p>' +
          '<a class="btn dark" href="https://calendar.app.google/SQV7d9eK7hsu2rLm8" target="_blank" rel="noopener">Book a free 1-on-1</a>' +
          '<button class="btn secondary" id="edit">Adjust my buckets</button>' +
          '<button class="btn ghost" id="reset">Start over</button>' +
        '</div>' +
      '</div>'
    ));
    document.getElementById("edit").onclick = function () { go("allocate"); };
    document.getElementById("reset").onclick = function () { if (confirm("Clear everything and start fresh?")) reset(); };
  }

  function buildCoaching() {
    var out = [], b = state.buckets, t = totalIncome(), left = leftToAssign();
    if (left > 1) out.push({ type: "flag", ic: "&#9888;&#65039;", msg: "You still have <b>" + money(left) + "</b> unassigned. Give it a job before it disappears. Investing or your emergency fund are great homes." });
    else if (left < -1) out.push({ type: "flag", ic: "&#9888;&#65039;", msg: "You are <b>" + money(-left) + "</b> over your income. Something has to come down, usually the Fun or Expenses bucket." });
    else out.push({ type: "good", ic: "&#9989;", msg: "Every dollar is assigned. That is exactly how a budget is supposed to work." });

    if (hasNil()) {
      var target = state.nilLevelIdx >= 0 ? taxSetAside(state.nilLevelIdx, nilMonthly()) : nilMonthly() * 0.15;
      if (num(b.tax) < target * 0.9)
        out.push({ type: "flag", ic: "&#129534;", msg: "Your Taxes bucket looks light for your NIL income. Open the Taxes details, pick your income level, and set aside the estimated amount so tax season is not a surprise." });
    }

    if (num(b.emergency) <= 0)
      out.push({ type: "flag", ic: "&#128737;&#65039;", msg: "Nothing is going to an emergency fund yet. Even a small amount builds the cushion that stops a surprise from becoming debt." });

    if (num(b.investing) > 0)
      out.push({ type: "good", ic: "&#127793;", msg: "You are paying yourself first. Invested consistently, this is the bucket that quietly builds real wealth." });

    if (num(b.fun) > num(b.investing) + num(b.emergency) && num(b.fun) > 0)
      out.push({ type: "flag", ic: "&#127881;", msg: "Your Fun bucket is bigger than Emergency plus Investing combined. Fun matters, just make sure future you gets a seat at the table too." });

    return out;
  }

  /* ---------------- utils ---------------- */
  function escAttr(s) { return String(s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }
  function escHtml(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ---------------- boot ---------------- */
  applyBranding();
  load();
  render();
})();
