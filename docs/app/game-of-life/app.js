/* Game of Life ("Money Journey") simulation. Self-contained, phone-first, localStorage.
   Reads game data from data.js. Per-school branding via ?school=. No em dashes. */

(function () {
  "use strict";

  /* ---------- branding (shared with budget game) ---------- */
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
    if (cfg.name) document.getElementById("brandSchool").textContent = cfg.name + " Athletics";
  }

  /* ---------- state ---------- */
  var KEY = "gol_v1";
  var state = {
    screen: "welcome",
    sIdx: -1,                                   // scenario index
    choices: { housing: -1, food: -1, transport: -1, home: -1, lifestyle: -1 },
    debtRolled: false, debtRoll: 0, debtPaid: 0,
    cards: [], cardsDrawn: false,
    name: ""
  };
  function load() { try { var r = localStorage.getItem(KEY); if (r) Object.assign(state, JSON.parse(r)); } catch (e) {} }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function reset() {
    localStorage.removeItem(KEY);
    state.screen = "welcome"; state.sIdx = -1;
    state.choices = { housing: -1, food: -1, transport: -1, home: -1, lifestyle: -1 };
    state.debtRolled = false; state.debtRoll = 0; state.debtPaid = 0;
    state.cards = []; state.cardsDrawn = false; state.name = "";
    render();
  }

  /* ---------- helpers ---------- */
  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function bignum(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function el(h) { var d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstChild; }
  function esc(s) { return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function go(s) { state.screen = s; save(); render(); window.scrollTo(0, 0); }
  function randInt(n) { return Math.floor(Math.random() * n); }
  function fv(pmt, annual, years) { var r = annual / 12, n = years * 12; return r === 0 ? pmt * n : pmt * ((Math.pow(1 + r, n) - 1) / r); }
  function scen() { return state.sIdx >= 0 ? SCENARIOS[state.sIdx] : null; }

  /* ---------- money model ---------- */
  function groupCost(key, idx) {
    if (idx < 0) return 0;
    if (key === "housing") { var h = HOUSING[idx]; return h.rent + h.ins + h.repairs + h.util; }
    if (key === "food") { var f = FOOD[idx]; return f.eatout + f.groceries; }
    if (key === "transport") { var t = TRANSPORT[idx]; return t.cost + (t.car ? CAR_COSTS.gas + CAR_COSTS.insurance : 0); }
    if (key === "home") return HOME_COSTS[idx].cost;
    if (key === "lifestyle") return LIFESTYLE[idx].cost;
    return 0;
  }
  function menusCost() {
    var c = state.choices, t = 0;
    ["housing", "food", "transport", "home", "lifestyle"].forEach(function (k) { t += groupCost(k, c[k]); });
    return t;
  }
  function fixedTotal() { return FIXED.phone + FIXED.internet + FIXED.entertainment + FIXED.subs; }
  function cardEffects() {
    var inc = 0, cost = 0, extraKids = 0, divorced = false;
    state.cards.forEach(function (ci) {
      var c = CRYSTAL[ci];
      if (c.k === "inc") inc += c.a;
      else if (c.k === "dec") inc -= c.a;
      else if (c.k === "cost") cost += c.a;
      else if (c.k === "cut") cost -= c.a;
      else if (c.k === "divorce") { cost += c.a; divorced = true; }
      else if (c.k === "child") extraKids += 1;
    });
    return { inc: inc, cost: cost, extraKids: extraKids, divorced: divorced };
  }
  function spouseNetMonthly() { var s = scen(); return s && s.spouse ? Math.round(s.spouse * 0.72 / 12) : 0; }
  function income() {
    var s = scen(); if (!s) return 0;
    var eff = cardEffects();
    return s.net + eff.inc - (eff.divorced ? spouseNetMonthly() : 0);
  }
  function expenses() {
    var s = scen(); if (!s) return 0;
    var eff = cardEffects();
    var kids = (s.kids + eff.extraKids) * CHILD_MONTHLY;
    var pet = s.pet ? PET_MONTHLY : 0;
    return menusCost() + fixedTotal() + kids + pet + state.debtPaid + eff.cost;
  }
  function surplus() { return income() - expenses(); }
  function savingsRate() { var i = income(); return i > 0 ? surplus() / i : 0; }
  function k401monthly() { var s = scen(); return s ? s.salary * 0.10 / 12 : 0; }
  function monthlyInvest() { return k401monthly() + Math.max(surplus(), 0); }
  function nestEgg() { return fv(monthlyInvest(), RETIRE.rate, RETIRE.years); }
  function retireIncome() { return nestEgg() * RETIRE.withdraw; }
  function allChosen() { var c = state.choices; return c.housing >= 0 && c.food >= 0 && c.transport >= 0 && c.home >= 0 && c.lifestyle >= 0; }

  /* ---------- render ---------- */
  var app = document.getElementById("app");
  function render() {
    var f = { welcome: renderWelcome, scenario: renderScenario, build: renderBuild, debt: renderDebt, crystal: renderCrystal, results: renderResults }[state.screen];
    (f || renderWelcome)();
  }
  function steps(active) {
    var labels = ["Life", "Budget", "Curveballs", "Retire"];
    return '<div class="gsteps">' + labels.map(function (l, i) {
      return '<span class="' + (i <= active ? "on" : "") + '">' + l + '</span>';
    }).join("") + '</div>';
  }

  function renderWelcome() {
    app.innerHTML = "";
    app.appendChild(el(
      '<div class="screen"><div class="card">' +
        '<span class="step-tag">The Money Journey</span>' +
        '<h1 class="title">Your Life, By the Numbers</h1>' +
        '<p class="lede">Your playing days are behind you and you are 30 with a career, maybe a family, and real bills. Build your monthly budget, ride out life\'s curveballs, and see what your choices become by retirement.</p>' +
        '<button class="btn" id="start">Start my life</button>' +
        '<button class="btn ghost" id="reset">Start over</button>' +
      '</div>' +
      '<p class="hint" style="text-align:center">About 5 minutes. Everything stays on your phone.</p></div>'
    ));
    document.getElementById("start").onclick = function () { go("scenario"); };
    document.getElementById("reset").onclick = function () { if (confirm("Clear and start over?")) reset(); };
  }

  function renderScenario() {
    if (state.sIdx < 0) state.sIdx = randInt(SCENARIOS.length);
    var s = scen();
    var family = (s.status === "M" ? "Married" : "Single") + (s.kids ? ", " + s.kids + (s.kids === 1 ? " kid" : " kids") : "") + (s.pet ? ", pet" : "");
    var householdInc = s.salary + (s.spouse || 0);
    app.innerHTML = "";
    app.appendChild(el(
      '<div class="screen">' + steps(0) +
        '<div class="scen-card">' +
          '<div class="scen-tag">YOUR LIFE AT 30</div>' +
          '<div class="scen-job">' + esc(s.job) + '</div>' +
          '<div class="scen-row"><span>Your salary</span><b>' + money(s.salary) + '/yr</b></div>' +
          (s.spouse ? '<div class="scen-row"><span>Spouse salary</span><b>' + money(s.spouse) + '/yr</b></div>' : "") +
          '<div class="scen-row"><span>Household</span><b>' + esc(family) + '</b></div>' +
          '<div class="scen-hero"><span>Your take-home pay</span><div class="scen-mo">' + money(s.net) + ' / month</div><span class="scen-note">after taxes and your 401k</span></div>' +
        '</div>' +
        '<button class="btn" id="go">This is my life, let\'s budget</button>' +
        '<button class="btn ghost" id="redeal">Deal a different life</button>' +
      '</div>'
    ));
    document.getElementById("go").onclick = function () { save(); go("build"); };
    document.getElementById("redeal").onclick = function () { state.sIdx = randInt(SCENARIOS.length); save(); renderScenario(); };
  }

  /* ----- build ----- */
  var GROUPS = [
    { key: "housing", title: "Where do you live?", opts: function () { return HOUSING.map(function (h, i) { return { label: h.name, cost: groupCost("housing", i), note: h.note }; }); } },
    { key: "food", title: "How do you eat?", opts: function () { return FOOD.map(function (f, i) { return { label: f.name, cost: groupCost("food", i), note: f.note }; }); } },
    { key: "transport", title: "How do you get around?", opts: function () { return TRANSPORT.map(function (t, i) { return { label: t.name, cost: groupCost("transport", i), note: t.car ? "includes gas + insurance" : "no car costs" }; }); } },
    { key: "home", title: "Home costs (furniture, clothes, care, health)", opts: function () { return HOME_COSTS.map(function (h, i) { return { label: h.name, cost: h.cost, note: "" }; }); } },
    { key: "lifestyle", title: "Lifestyle (hobbies + travel)", opts: function () { return LIFESTYLE.map(function (l, i) { return { label: l.name, cost: l.cost, note: l.note }; }); } }
  ];
  function renderBuild() {
    var s = scen();
    var autoLines = [];
    autoLines.push(["Phone, internet, streaming, subscriptions", fixedTotal()]);
    if (s.kids) autoLines.push([s.kids + (s.kids === 1 ? " child" : " children") + " (care, activities, education)", s.kids * CHILD_MONTHLY]);
    if (s.pet) autoLines.push(["Pet", PET_MONTHLY]);
    var groupsHtml = GROUPS.map(function (g) {
      var chips = g.opts().map(function (o, i) {
        var seld = state.choices[g.key] === i;
        return '<button class="chip' + (seld ? " sel" : "") + '" data-g="' + g.key + '" data-i="' + i + '">' +
          '<span class="chip-l">' + esc(o.label) + '</span><span class="chip-c">' + money(o.cost) + '</span></button>';
      }).join("");
      return '<div class="cgroup"><div class="cgroup-t">' + g.title + '</div><div class="chips">' + chips + '</div></div>';
    }).join("");
    app.innerHTML = "";
    app.appendChild(el(
      '<div class="screen">' + steps(1) +
        '<div class="pool"><span class="lbl">Take-home pay</span><span class="amt">' + money(income()) + ' / mo</span></div>' +
        '<div class="counter" id="counter"><span class="lbl">Left this month</span><span class="val" id="leftVal"></span></div>' +
        '<p class="hint" style="margin:-6px 0 12px">Pick your lifestyle. What is left over is what builds your future.</p>' +
        groupsHtml +
        '<div class="autobox"><div class="autobox-t">Already included</div>' +
          autoLines.map(function (a) { return '<div class="auto-row"><span>' + esc(a[0]) + '</span><b>' + money(a[1]) + '</b></div>'; }).join("") +
        '</div>' +
        '<button class="btn" id="next">Next: life happens</button>' +
        '<button class="btn ghost" id="back">Back</button>' +
      '</div>'
    ));
    Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (b) {
      b.onclick = function () {
        var g = b.getAttribute("data-g"), i = parseInt(b.getAttribute("data-i"), 10);
        state.choices[g] = i; save();
        Array.prototype.forEach.call(document.querySelectorAll('.chip[data-g="' + g + '"]'), function (x) { x.classList.remove("sel"); });
        b.classList.add("sel");
        updateBuild();
      };
    });
    document.getElementById("next").onclick = function () {
      if (!allChosen()) { alert("Make a choice in each category to continue."); return; }
      go(scen().status === "M" ? "debt" : "crystal");
    };
    document.getElementById("back").onclick = function () { go("scenario"); };
    updateBuild();
  }
  function updateBuild() {
    var c = document.getElementById("counter"); if (!c) return;
    var left = surplus();
    var v = document.getElementById("leftVal");
    v.textContent = money(left) + " / mo";
    c.classList.remove("ok", "over", "under");
    if (left < 0) c.classList.add("over"); else if (left === income()) c.classList.add("under"); else c.classList.add("ok");
  }

  /* ----- debt ----- */
  function renderDebt() {
    app.innerHTML = "";
    app.appendChild(el(
      '<div class="screen">' + steps(2) +
        '<div class="card">' +
          '<span class="step-tag">Marriage + money</span>' +
          '<h1 class="title">Your spouse\'s debt</h1>' +
          '<p class="lede">When you marry, you take on your spouse\'s debt too. Roll to see what they bring into the relationship.</p>' +
          '<div class="dice" id="dice">?</div>' +
          '<div id="debtResult" class="callout tax" style="' + (state.debtRolled ? "" : "display:none") + '">' + debtMsg() + '</div>' +
          '<button class="btn" id="roll">' + (state.debtRolled ? "Roll again" : "Roll the dice") + '</button>' +
          '<button class="btn dark" id="next" style="' + (state.debtRolled ? "" : "display:none") + '">Continue</button>' +
        '</div>' +
      '</div>'
    ));
    if (state.debtRolled) document.getElementById("dice").textContent = state.debtRoll;
    document.getElementById("roll").onclick = function () {
      var r = 1 + randInt(6);
      state.debtRoll = r; state.debtPaid = DEBT_ROLLS[r]; state.debtRolled = true; save();
      document.getElementById("dice").textContent = r;
      var d = document.getElementById("debtResult"); d.innerHTML = debtMsg(); d.style.display = "";
      document.getElementById("next").style.display = "";
      this.textContent = "Roll again";
    };
    document.getElementById("next").onclick = function () { go("crystal"); };
  }
  function debtMsg() {
    if (!state.debtRolled) return "";
    if (state.debtPaid === 0) return "<b>Lucky.</b> Your spouse brought no debt into the marriage.";
    return "<b>" + DEBT_DETAIL[state.debtPaid] + ".</b> That adds <b>" + money(state.debtPaid) + "/month</b> in debt payments to your budget.";
  }

  /* ----- crystal ----- */
  function renderCrystal() {
    app.innerHTML = "";
    var drawn = state.cardsDrawn;
    var cardsHtml = "";
    if (drawn) {
      cardsHtml = state.cards.map(function (ci) {
        var c = CRYSTAL[ci];
        var good = (c.k === "inc" || c.k === "cut");
        var eff = c.k === "inc" ? "+" + money(c.a) + " income" :
                  c.k === "dec" ? "-" + money(c.a) + " income" :
                  c.k === "cost" ? "+" + money(c.a) + " costs" :
                  c.k === "cut" ? "-" + money(c.a) + " costs" :
                  c.k === "divorce" ? "+" + money(c.a) + " costs, lose spouse income" : "adds a child (" + money(CHILD_MONTHLY) + "/mo)";
        return '<div class="cball ' + (good ? "good" : "bad") + '"><div class="cball-t">' + esc(c.t) + '</div>' +
          '<div class="cball-e">' + eff + '</div>' + (c.lesson ? '<div class="cball-lesson">' + esc(c.lesson) + '</div>' : "") + '</div>';
      }).join("");
    }
    app.appendChild(el(
      '<div class="screen">' + steps(2) +
        '<div class="card">' +
          '<span class="step-tag">The Crystal Ball</span>' +
          '<h1 class="title">Life happens</h1>' +
          '<p class="lede">Even the best budget meets the unexpected. Draw two cards and see how life changes your plan.</p>' +
          (drawn ? cardsHtml : '<div class="cball-back">Two cards face down</div>') +
          '<button class="btn" id="draw" style="' + (drawn ? "display:none" : "") + '">Draw 2 cards</button>' +
          '<button class="btn dark" id="next" style="' + (drawn ? "" : "display:none") + '">See how I did</button>' +
        '</div>' +
      '</div>'
    ));
    var d = document.getElementById("draw");
    if (d) d.onclick = function () {
      var a = randInt(CRYSTAL.length), b = randInt(CRYSTAL.length);
      while (b === a) b = randInt(CRYSTAL.length);
      state.cards = [a, b]; state.cardsDrawn = true; save(); renderCrystal();
    };
    var n = document.getElementById("next");
    if (n) n.onclick = function () { go("results"); };
  }

  /* ----- results ----- */
  function renderResults() {
    var s = scen();
    var inc = income(), exp = expenses(), sur = surplus(), rate = savingsRate();
    var nest = nestEgg(), rinc = retireIncome();
    var lbEntry = { name: state.name || "You", job: s.job, rate: rate, nest: nest };
    var coaches = buildCoaching(sur, rate);
    app.innerHTML = "";
    app.appendChild(el(
      '<div class="screen">' + steps(3) +
        '<div class="sum-hero">' +
          '<span class="cap">Your retirement nest egg at 65</span>' +
          '<div class="big">' + bignum(nest) + '</div>' +
          '<span class="cap">about ' + money(rinc) + ' / year to live on (4% rule)</span>' +
        '</div>' +
        '<div class="card" style="padding:14px 16px">' +
          '<div class="sum-row"><span class="nm">Take-home pay</span><span class="vl">' + money(inc) + '/mo</span></div>' +
          '<div class="sum-row"><span class="nm">Everything you spend</span><span class="vl">' + money(exp) + '/mo</span></div>' +
          '<div class="sum-row"><span class="nm">Left over each month</span><span class="vl" style="color:' + (sur < 0 ? "var(--bad)" : "var(--ok)") + '">' + money(sur) + '/mo</span></div>' +
          '<div class="sum-row"><span class="nm">Your savings rate</span><span class="vl">' + Math.round(rate * 100) + '%</span></div>' +
        '</div>' +
        '<div class="coach"><span class="ic">&#128200;</span><span>Your 401k plus what you invest each month, grown at ' + Math.round(RETIRE.rate * 100) + '% a year for ' + RETIRE.years + ' years, becomes <b>' + bignum(nest) + '</b>. That is the power of compounding.</span></div>' +
        coaches +
        '<div class="card">' +
          '<h3 style="margin:0 0 8px">Add your score to the leaderboard</h3>' +
          '<p class="sub" style="margin:0 0 10px">Ranked by savings rate, so smart budgeting beats a big salary.</p>' +
          '<input type="text" id="nm" placeholder="Your name or number" value="' + esc(state.name) + '" maxlength="18">' +
          '<button class="btn" id="addLb">Add me to the leaderboard</button>' +
          '<div id="lb"></div>' +
        '</div>' +
        '<div class="card" style="text-align:center">' +
          '<button class="btn dark" id="again">Play again with a new life</button>' +
          '<button class="btn ghost" id="reset">Clear everything</button>' +
        '</div>' +
        '<p class="disclaimer" style="text-align:left">This is a simplified simulation for learning, not financial advice. Real life has more moving parts.</p>' +
      '</div>'
    ));
    renderLeaderboard(null);
    document.getElementById("nm").addEventListener("input", function () { state.name = this.value; save(); });
    document.getElementById("addLb").onclick = function () {
      lbEntry.name = (state.name || "You").slice(0, 18);
      var lb = getLb(); lb.push(lbEntry); lb.sort(function (a, b) { return b.rate - a.rate; });
      setLb(lb); renderLeaderboard(lbEntry);
      this.textContent = "Added";
    };
    document.getElementById("again").onclick = function () {
      state.sIdx = randInt(SCENARIOS.length);
      state.choices = { housing: -1, food: -1, transport: -1, home: -1, lifestyle: -1 };
      state.debtRolled = false; state.debtRoll = 0; state.debtPaid = 0; state.cards = []; state.cardsDrawn = false;
      save(); go("scenario");
    };
    document.getElementById("reset").onclick = function () { if (confirm("Clear everything, including the leaderboard?")) { localStorage.removeItem("gol_lb_v1"); reset(); } };
  }
  function buildCoaching(sur, rate) {
    var out = [];
    if (sur < 0) out.push(coach("flag", "&#9888;&#65039;", "You are spending more than you make. In real life that means debt or dipping into savings. Trim the lifestyle choices and watch what happens to your future."));
    else if (rate < 0.10) out.push(coach("flag", "&#128184;", "You are keeping less than 10% of your pay. It works for now, but there is not much left to build wealth. Small cuts compound into a much bigger nest egg."));
    else if (rate >= 0.20) out.push(coach("good", "&#127775;", "You are saving over 20% of your pay. That is elite. Future you is going to be very grateful."));
    else out.push(coach("good", "&#9989;", "Solid. You are living below your means and building a real cushion for the future."));
    var eff = cardEffects();
    state.cards.forEach(function (ci) { if (CRYSTAL[ci].lesson) out.push(coach("flag", "&#128161;", CRYSTAL[ci].lesson)); });
    return out.map(function (c) { return '<div class="coach ' + c.type + '"><span class="ic">' + c.ic + '</span><span>' + c.msg + '</span></div>'; }).join("");
  }
  function coach(type, ic, msg) { return { type: type, ic: ic, msg: msg }; }

  function getLb() { try { return JSON.parse(localStorage.getItem("gol_lb_v1") || "[]"); } catch (e) { return []; } }
  function setLb(lb) { try { localStorage.setItem("gol_lb_v1", JSON.stringify(lb.slice(0, 50))); } catch (e) {} }
  function renderLeaderboard(highlight) {
    var lb = getLb().slice(0, 8), box = document.getElementById("lb");
    if (!box) return;
    if (!lb.length) { box.innerHTML = '<p class="hint" style="margin:10px 0 0">No scores yet. Be the first.</p>'; return; }
    box.innerHTML = '<div class="lbrd">' + lb.map(function (e, i) {
      var hot = highlight && e.name === highlight.name && Math.abs(e.rate - highlight.rate) < 0.0001 && Math.abs(e.nest - highlight.nest) < 1;
      return '<div class="lb-row' + (hot ? " me" : "") + '"><span class="lb-rank">' + (i + 1) + '</span>' +
        '<span class="lb-name">' + esc(e.name) + '<small>' + esc(e.job) + '</small></span>' +
        '<span class="lb-rate">' + Math.round(e.rate * 100) + '%</span>' +
        '<span class="lb-nest">' + bignum(e.nest) + '</span></div>';
    }).join("") + '</div>';
  }

  /* ---------- boot ---------- */
  applyBranding();
  load();
  render();
})();
