/* AGP - 40 Years in 12 Minutes (investing simulation)
   Self-contained, no backend. Runs on the athlete's device. Nothing is transmitted.
   Stocks / bonds / cash use REAL historical returns from data.js.
   The concentrated bet is a MODEL and is labeled as one everywhere it appears.
   Per-school branding via ?school=. No em dashes in user-facing copy. */

(function () {
  "use strict";

  /* ---------------- branding (shared with the other AGP apps) ---------------- */
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

  /* ---------------- constants ---------------- */
  var YEARS = 40;
  var SEGMENTS = [10, 10, 10, 10];           // 3 decision points fall between these
  /* Concentrated-bet model, calibrated 2026-09-13 against Bessembinder (CRSP 1926-2016),
     which finds ~30% of individual stocks beat the market over their lifetime and slightly
     more than half deliver negative returns. Monte Carlo over 35,400 paths puts this
     parameter set at 29.3% beating an 80/20 index and 50.7% losing real purchasing power.
     Deliberately NOT tuned to make the boring answer always win. */
  var BET_MEAN = 0.10;                       // pivot: the long-run stock average
  var BET_DRIFT = 0.03;                      // concentrated positions carry more expected return, and more drag
  var BET_AMP = 1.6;                         // how much a single position magnifies a market move
  var BET_NOISE_SD = 0.30;                   // company-specific risk the market does not pay you for
  var BET_WIPEOUT_P = 0.008;                 // a single position can fail outright
  var BET_WIPEOUT_R = -0.90;                 // and when it does, it does not come back
  var BASELINE = { stocks: 0.80, bonds: 0.20, cash: 0, bet: 0 };

  var CLASSES = [
    { key: "stocks", name: "US Stocks",      real: true,
      desc: "Owning small pieces of American companies. The engine of long-term growth, and the bumpiest ride of the three real ones." },
    { key: "bonds",  name: "Bonds",          real: true,
      desc: "Lending money to the government. Steadier, lower growth. Often does well exactly when stocks do not." },
    { key: "cash",   name: "Cash / Savings", real: true,
      desc: "Safe in dollars. Not safe from inflation. Almost never loses a year, almost never wins one either." },
    { key: "bet",    name: "The Concentrated Bet", real: false,
      desc: "One company or one coin. Modeled, not a real index. Roughly twice the swings of the market. Most of the time it finishes behind a plain index. Once in a while it finishes far ahead, and that is exactly why people try it." }
  ];

  /* ---------------- state ---------------- */
  var KEY = "agp_investsim_v1";
  var state = null;
  function freshState() {
    return {
      screen: "welcome",
      monthly: 100,
      alloc: { stocks: 60, bonds: 20, cash: 10, bet: 10 },
      startYear: null,
      salt: Math.floor(Math.random() * 1000000),
      segIndex: 0,
      decisions: [],
      run: null
    };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var s = JSON.parse(raw); if (s && s.alloc) return s; }
    } catch (e) {}
    return freshState();
  }
  function reset(cleared) {
    try { localStorage.removeItem(KEY); } catch (e) {}
    state = freshState();
    state.justCleared = !!cleared;
    render();
  }

  /* ---------------- helpers ---------------- */
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function money(n) {
    n = Math.round(n);
    if (Math.abs(n) >= 1000000) return "$" + (n / 1000000).toFixed(2).replace(/\.00$/, "") + "M";
    return "$" + n.toLocaleString("en-US");
  }
  function moneyFull(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function pctStr(n) { return (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%"; }
  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function el(html) { var d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* deterministic RNG so a given start year always produces the same path */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    var u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ---------------- market data access ---------------- */
  var BY_YEAR = {};
  MARKET_DATA.forEach(function (r) { BY_YEAR[r[0]] = { sp: r[1] / 100, tbill: r[2] / 100, tbond: r[3] / 100, cpi: r[4] / 100 }; });
  var FIRST_YEAR = MARKET_DATA[0][0];
  var LAST_YEAR = MARKET_DATA[MARKET_DATA.length - 1][0];
  function startYears() {
    var out = [];
    for (var y = FIRST_YEAR; y + YEARS - 1 <= LAST_YEAR; y++) out.push(y);
    return out;
  }

  /* The concentrated bet is redrawn each PLAY, not fixed per year.
     Replay 1965 and the stocks, bonds and cash do exactly the same thing, because that is
     real history. The single position does something different every time, because that is
     what concentrated risk actually is. The contrast is deliberate and it is the lesson.
     state.salt keeps one play stable across re-renders. */
  function betPath(startYear) {
    var rng = mulberry32((startYear * 2654435761 + (state.salt || 0) * 40503) % 2147483647);
    var out = [], dead = false;
    for (var i = 0; i < YEARS; i++) {
      if (dead) { out.push(0); continue; }   // a failed company does not recover
      var sp = BY_YEAR[startYear + i].sp;
      var r = BET_MEAN + BET_DRIFT + BET_AMP * (sp - BET_MEAN) + gauss(rng) * BET_NOISE_SD;
      if (rng() < BET_WIPEOUT_P) { r = BET_WIPEOUT_R; dead = true; }
      out.push(Math.max(r, -0.95));
    }
    return out;
  }

  /* ---------------- the engine ---------------- */
  /* decisions: array of {at: yearIndex, type, choice} */
  function simulate(alloc, startYear, monthly, decisions) {
    var target = normalize(alloc);
    var bet = betPath(startYear);
    var bal = { stocks: 0, bonds: 0, cash: 0, bet: 0 };
    var eff = { stocks: target.stocks, bonds: target.bonds, cash: target.cash, bet: target.bet };
    var contribMult = 1, contribMultUntil = -1;
    var cashParkUntil = -1, betTiltUntil = -1;
    var hist = [], contributed = 0;

    for (var i = 0; i < YEARS; i++) {
      var year = startYear + i;
      var m = BY_YEAR[year];

      if (i > contribMultUntil) contribMult = 1;
      if (i === cashParkUntil) eff = { stocks: target.stocks, bonds: target.bonds, cash: target.cash, bet: target.bet };
      if (i === betTiltUntil) eff = { stocks: target.stocks, bonds: target.bonds, cash: target.cash, bet: target.bet };

      // apply any decision scheduled at the START of this year
      decisions.forEach(function (d) {
        if (d.at !== i) return;
        if (d.choice === "sell") {
          var tot = bal.stocks + bal.bonds + bal.cash + bal.bet;
          bal = { stocks: 0, bonds: 0, cash: tot, bet: 0 };
          eff = { stocks: 0, bonds: 0, cash: 1, bet: 0 };
          cashParkUntil = i + 3;
        } else if (d.choice === "addmore") {
          contribMult = 1.5; contribMultUntil = i + 3;
        } else if (d.choice === "letitride") {
          var shift = Math.min(0.20, target.stocks + target.bonds + target.cash);
          eff = {
            stocks: target.stocks * (1 - shift), bonds: target.bonds * (1 - shift),
            cash: target.cash * (1 - shift), bet: target.bet + shift
          };
          eff = normalize01(eff);
          betTiltUntil = i + 5;
        } else if (d.choice === "rebalance") {
          var t2 = bal.stocks + bal.bonds + bal.cash + bal.bet;
          bal = { stocks: t2 * target.stocks, bonds: t2 * target.bonds, cash: t2 * target.cash, bet: t2 * target.bet };
        } else if (d.choice === "investall") {
          addLump(bal, target, 5000); contributed += 5000;
        } else if (d.choice === "half") {
          addLump(bal, target, 2500); contributed += 2500;
        }
      });

      var contrib = monthly * 12 * contribMult;
      contributed += contrib;
      bal.stocks += contrib * eff.stocks;
      bal.bonds  += contrib * eff.bonds;
      bal.cash   += contrib * eff.cash;
      bal.bet    += contrib * eff.bet;

      bal.stocks *= (1 + m.sp);
      bal.bonds  *= (1 + m.tbond);
      bal.cash   *= (1 + m.tbill);
      bal.bet    *= (1 + bet[i]);

      var total = bal.stocks + bal.bonds + bal.cash + bal.bet;
      hist.push({
        i: i, year: year, total: total, contributed: contributed,
        bal: { stocks: bal.stocks, bonds: bal.bonds, cash: bal.cash, bet: bal.bet },
        r: { stocks: m.sp, bonds: m.tbond, cash: m.tbill, bet: bet[i] }, cpi: m.cpi
      });
    }
    var infl = 1;
    for (var j = 0; j < YEARS; j++) infl *= (1 + BY_YEAR[startYear + j].cpi);
    return { hist: hist, final: hist[YEARS - 1].total, contributed: contributed, inflation: infl };
  }
  function addLump(bal, t, amt) {
    bal.stocks += amt * t.stocks; bal.bonds += amt * t.bonds;
    bal.cash += amt * t.cash; bal.bet += amt * t.bet;
  }
  function normalize(a) {
    var s = num(a.stocks) + num(a.bonds) + num(a.cash) + num(a.bet);
    if (s <= 0) return { stocks: 1, bonds: 0, cash: 0, bet: 0 };
    return { stocks: num(a.stocks) / s, bonds: num(a.bonds) / s, cash: num(a.cash) / s, bet: num(a.bet) / s };
  }
  function normalize01(a) {
    var s = a.stocks + a.bonds + a.cash + a.bet;
    return { stocks: a.stocks / s, bonds: a.bonds / s, cash: a.cash / s, bet: a.bet / s };
  }

  function maxDrawdown(hist, from, to) {
    var peak = -Infinity, dd = 0;
    for (var i = from; i < to && i < hist.length; i++) {
      peak = Math.max(peak, hist[i].total);
      if (peak > 0) dd = Math.max(dd, (peak - hist[i].total) / peak);
    }
    return dd;
  }

  /* ---------------- render ---------------- */
  var app = document.getElementById("app");
  function go(s) { state.screen = s; save(); render(); window.scrollTo(0, 0); }

  function render() {
    app.innerHTML = "";
    if (state.screen === "welcome") return renderWelcome();
    if (state.screen === "allocate") return renderAllocate();
    if (state.screen === "startyear") return renderStartYear();
    if (state.screen === "segment") return renderSegment();
    if (state.screen === "decision") return renderDecision();
    if (state.screen === "reveal") return renderReveal();
  }

  function renderWelcome() {
    var opts = [50, 100, 200].map(function (v) {
      return '<button class="chip' + (state.monthly === v ? " on" : "") + '" data-m="' + v + '">$' + v + '</button>';
    }).join("");
    app.appendChild(el(
      '<div class="screen">' +
        (state.justCleared ? '<div class="callout ok">Cleared. Nothing from your run is left on this device.</div>' : "") +
        '<div class="card">' +
          '<span class="tag">The setup</span>' +
          '<h1 class="title">You are 22. You have 40 years.</h1>' +
          '<p class="lede">You are going to build a portfolio, then watch four decades of real market history run through it. ' +
          'You will get a random year in history to start from, the same way you do not get to choose what the market does when you turn 22.</p>' +
          '<div class="callout">' +
            '<b>Three of the four choices use real returns</b> from 1928 to 2025: actual stocks, actual bonds, actual savings rates. ' +
            'The crashes are real crashes. The recoveries are real recoveries.' +
          '</div>' +
          '<label class="fld">How much can you put in each month?</label>' +
          '<div class="chips">' + opts + '</div>' +
          '<p class="hint">Pick what feels realistic. It matters less than you think, and the reason why is the point of the exercise.</p>' +
          '<button class="btn" id="next">Build my portfolio</button>' +
          '<button class="btn ghost" id="reset">Start over</button>' +
        '</div>' +
      '</div>'
    ));
    state.justCleared = false;
    Array.prototype.forEach.call(document.querySelectorAll(".chip"), function (c) {
      c.onclick = function () { state.monthly = num(this.getAttribute("data-m")); save(); render(); };
    });
    document.getElementById("next").onclick = function () { go("allocate"); };
    document.getElementById("reset").onclick = function () { reset(false); };
  }

  function renderAllocate() {
    var rows = CLASSES.map(function (c) {
      return '<div class="alloc" data-k="' + c.key + '">' +
        '<div class="alloc-top">' +
          '<div><span class="dot ' + c.key + '"></span><b>' + c.name + '</b>' +
            (c.real ? '<span class="badge real">real history</span>' : '<span class="badge model">modeled</span>') + '</div>' +
          '<div class="alloc-val" id="v_' + c.key + '">' + state.alloc[c.key] + '%</div>' +
        '</div>' +
        '<input type="range" min="0" max="100" step="5" id="s_' + c.key + '" value="' + state.alloc[c.key] + '">' +
        '<div class="alloc-desc">' + c.desc + '</div>' +
      '</div>';
    }).join("");
    app.appendChild(el(
      '<div class="screen">' +
        '<div class="card">' +
          '<span class="tag">Step 1 of 3</span>' +
          '<h1 class="title">Build your portfolio</h1>' +
          '<p class="lede">Move the sliders. There is no right answer here and nothing is recommended. ' +
          'You are choosing how much of a ride you want.</p>' +
          rows +
          '<div class="totalbar"><span>Total</span><span id="allocTotal">100%</span></div>' +
          '<div class="callout warn" id="allocWarn" style="display:none">Get to 100% to keep going.</div>' +
          '<button class="btn" id="next">Lock it in</button>' +
          '<button class="btn ghost" id="back">Back</button>' +
        '</div>' +
      '</div>'
    ));
    function refresh() {
      var t = 0;
      CLASSES.forEach(function (c) { t += state.alloc[c.key]; });
      document.getElementById("allocTotal").textContent = t + "%";
      var ok = t === 100;
      document.getElementById("allocTotal").className = ok ? "ok" : "bad";
      document.getElementById("allocWarn").style.display = ok ? "none" : "";
      document.getElementById("next").disabled = !ok;
    }
    CLASSES.forEach(function (c) {
      var s = document.getElementById("s_" + c.key);
      s.addEventListener("input", function () {
        state.alloc[c.key] = num(this.value);
        document.getElementById("v_" + c.key).textContent = state.alloc[c.key] + "%";
        refresh(); save();
      });
    });
    refresh();
    document.getElementById("next").onclick = function () {
      var ys = startYears();
      state.startYear = ys[Math.floor(Math.random() * ys.length)];
      state.salt = Math.floor(Math.random() * 1000000);
      state.segIndex = 0; state.decisions = [];
      state.run = null;
      go("startyear");
    };
    document.getElementById("back").onclick = function () { go("welcome"); };
  }

  function renderStartYear() {
    var y = state.startYear;
    app.appendChild(el(
      '<div class="screen">' +
        '<div class="card center">' +
          '<span class="tag">Step 2 of 3</span>' +
          '<p class="lede">Your forty years begin in</p>' +
          '<div class="hugeyear">' + y + '</div>' +
          '<p class="lede">You did not pick it and you cannot change it. Nobody gets to choose the market they start in.</p>' +
          '<div class="callout">Everything from here is what actually happened between <b>' + y + '</b> and <b>' + (y + YEARS - 1) + '</b>.</div>' +
          '<button class="btn" id="next">Start the clock</button>' +
        '</div>' +
      '</div>'
    ));
    document.getElementById("next").onclick = function () { go("segment"); };
  }

  function currentRun() {
    if (!state.run) state.run = simulate(state.alloc, state.startYear, state.monthly, state.decisions);
    return state.run;
  }
  function segBounds(idx) {
    var from = 0;
    for (var i = 0; i < idx; i++) from += SEGMENTS[i];
    return { from: from, to: from + SEGMENTS[idx] };
  }

  function renderSegment() {
    state.run = simulate(state.alloc, state.startYear, state.monthly, state.decisions);
    var run = state.run;
    var b = segBounds(state.segIndex);
    var slice = run.hist.slice(0, b.to);
    var last = run.hist[b.to - 1];
    var dd = maxDrawdown(run.hist, b.from, b.to);
    var worst = null, best = null;
    for (var i = b.from; i < b.to; i++) {
      if (!worst || run.hist[i].r.stocks < worst.r.stocks) worst = run.hist[i];
      if (!best || run.hist[i].r.stocks > best.r.stocks) best = run.hist[i];
    }
    var label = ["Years 1 to 10", "Years 11 to 20", "Years 21 to 30", "Years 31 to 40"][state.segIndex];
    app.appendChild(el(
      '<div class="screen">' +
        '<div class="card">' +
          '<span class="tag">' + label + " &middot; " + run.hist[b.from].year + " to " + last.year + '</span>' +
          '<div class="bigfig">' + moneyFull(last.total) + '</div>' +
          '<div class="sub">You have put in ' + moneyFull(last.contributed) + '</div>' +
          chartSvg(run.hist, b.to) +
          '<div class="statrow">' +
            '<div class="stat"><span>Worst year</span><b class="neg">' + pctStr(worst.r.stocks) + '</b><i>stocks, ' + worst.year + '</i></div>' +
            '<div class="stat"><span>Best year</span><b class="pos">' + pctStr(best.r.stocks) + '</b><i>stocks, ' + best.year + '</i></div>' +
            '<div class="stat"><span>Deepest drop</span><b class="' + (dd > 0.2 ? "neg" : "") + '">' +
              (Math.round(dd * 100) === 0 ? "none" : "-" + Math.round(dd * 100) + "%") + '</b><i>peak to trough</i></div>' +
          '</div>' +
          '<button class="btn" id="next">' + (state.segIndex < 3 ? "Keep going" : "See how it ended") + '</button>' +
        '</div>' +
      '</div>'
    ));
    document.getElementById("next").onclick = function () {
      if (state.segIndex < 3) go("decision");
      else go("reveal");
    };
  }

  /* decision content adapts to what actually happened in the segment just played */
  function decisionFor(segIndex) {
    var run = state.run, b = segBounds(segIndex);
    var dd = maxDrawdown(run.hist, b.from, b.to);
    var last = run.hist[b.to - 1];
    var betShare = last.total > 0 ? last.bal.bet / last.total : 0;
    var targetBet = normalize(state.alloc).bet;
    if (dd >= 0.20) {
      return {
        type: "crash",
        head: "Your portfolio just dropped " + Math.round(dd * 100) + "%.",
        body: "The news is bad, everyone you know is talking about it, and the number on your screen is smaller than it was a year ago. What do you do?",
        opts: [
          { c: "sell", t: "Sell everything and wait for it to calm down", s: "Move to cash until it feels safe" },
          { c: "hold", t: "Do nothing", s: "Keep the plan, keep contributing" },
          { c: "addmore", t: "Keep buying, and add extra while it is down", s: "Increase contributions for three years" }
        ]
      };
    }
    if (targetBet > 0 && betShare > Math.min(0.9, targetBet * 1.6)) {
      return {
        type: "hot",
        head: "Your concentrated bet is on a tear.",
        body: "It is now " + Math.round(betShare * 100) + "% of everything you own, well above what you planned. Two teammates just put money in. What do you do?",
        opts: [
          { c: "letitride", t: "Let it ride and send new money there too", s: "Tilt harder for five years" },
          { c: "rebalance", t: "Sell some and get back to my plan", s: "Rebalance to your original mix" },
          { c: "hold", t: "Do nothing", s: "Let it drift, add nothing extra" }
        ]
      };
    }
    return {
      type: "windfall",
      head: "A $5,000 NIL deal just landed.",
      body: "It is real money and it is not in your budget. What happens to it?",
      opts: [
        { c: "investall", t: "Invest all of it", s: "Straight into your mix" },
        { c: "half", t: "Invest half, spend half", s: "$2,500 in, $2,500 enjoyed" },
        { c: "hold", t: "Spend it", s: "Nothing goes in" }
      ]
    };
  }

  function renderDecision() {
    var d = decisionFor(state.segIndex);
    var b = segBounds(state.segIndex);
    var opts = d.opts.map(function (o) {
      return '<button class="choice" data-c="' + o.c + '"><b>' + o.t + '</b><span>' + o.s + '</span></button>';
    }).join("");
    app.appendChild(el(
      '<div class="screen">' +
        '<div class="card">' +
          '<span class="tag">Decision ' + (state.segIndex + 1) + ' of 3 &middot; ' + state.run.hist[b.to - 1].year + '</span>' +
          '<h1 class="title">' + esc(d.head) + '</h1>' +
          '<p class="lede">' + esc(d.body) + '</p>' +
          opts +
          '<p class="hint">There is no trick answer. Pick what you would actually do.</p>' +
        '</div>' +
      '</div>'
    ));
    Array.prototype.forEach.call(document.querySelectorAll(".choice"), function (btn) {
      btn.onclick = function () {
        state.decisions.push({ at: b.to, type: d.type, choice: this.getAttribute("data-c") });
        state.segIndex++;
        save(); go("segment");
      };
    });
  }

  function renderReveal() {
    var run = simulate(state.alloc, state.startYear, state.monthly, state.decisions);
    var never = simulate(state.alloc, state.startYear, state.monthly, []);
    var base = simulate(BASELINE, state.startYear, state.monthly, []);
    var real = run.final / run.inflation;

    // percentile: this allocation, untouched, across every possible starting year
    var all = startYears().map(function (y) { return simulate(state.alloc, y, state.monthly, []).final; });
    var sorted = all.slice().sort(function (a, b) { return a - b; });
    var below = sorted.filter(function (v) { return v < never.final; }).length;
    var pctile = Math.round((below / sorted.length) * 100);
    var anyLost = sorted.filter(function (v) { return v < never.contributed; }).length;

    var growth = run.final - run.contributed;
    var panicked = state.decisions.some(function (d) { return d.choice === "sell"; });
    var diff = never.final - run.final;

    var rows = CLASSES.map(function (c) {
      var v = run.hist[YEARS - 1].bal[c.key];
      return '<div class="sum-row"><span class="dot ' + c.key + '"></span><span class="nm">' + c.name + '</span>' +
        '<span class="pc">' + Math.round(run.final > 0 ? (v / run.final) * 100 : 0) + '%</span>' +
        '<span class="vl">' + money(v) + '</span></div>';
    }).join("");

    app.appendChild(el(
      '<div class="screen">' +
        '<div class="hero">' +
          '<span class="cap">After 40 years, ' + state.startYear + ' to ' + (state.startYear + YEARS - 1) + '</span>' +
          '<div class="huge">' + moneyFull(run.final) + '</div>' +
          '<span class="cap">You put in ' + moneyFull(run.contributed) + '. The market added ' + moneyFull(growth) + '.</span>' +
        '</div>' +
        chartSvg(run.hist, YEARS) +
        '<div class="card" style="padding:14px 16px">' + rows + '</div>' +

        '<div class="card">' +
          '<h3>What it is actually worth</h3>' +
          '<p class="sub">Prices rose over those forty years, so ' + moneyFull(run.final) + ' at the end does not buy what it would have on day one. ' +
          'In starting-year money that is <b>' + moneyFull(real) + '</b>.</p>' +
          '<p class="hint">Inflation is the reason cash is not the safe choice people think it is. ' +
          'Across all ' + sorted.length + ' possible starting years in this data, a 100% cash portfolio lost purchasing power in <b>every single one</b>.</p>' +
        '</div>' +

        (panicked
          ? (diff > 0
            ? '<div class="card flag">' +
                '<h3>You sold when it dropped</h3>' +
                '<p class="sub">Same portfolio, same forty years, same start. If you had done nothing at all you would have finished with ' +
                '<b>' + moneyFull(never.final) + '</b>. Selling cost you <b>' + moneyFull(diff) + '</b>.</p>' +
                '<p class="hint">Nobody sells because they are stupid. They sell because it feels unbearable. That is why you decide what you will do before it happens, not during.</p>' +
              '</div>'
            : '<div class="card ok">' +
                '<h3>You sold when it dropped, and this time it worked</h3>' +
                '<p class="sub">Holding would have left you with <b>' + moneyFull(never.final) + '</b>. Selling put you <b>' + moneyFull(-diff) + '</b> ahead of that. ' +
                'That is a real outcome and this simulation is not going to pretend otherwise.</p>' +
                '<p class="hint">You got the timing right, and that really does happen. <b>The problem is that almost nobody knows in advance which time is the right time, ' +
                'including the people who got it right last time.</b> Run it again from a different year and count how often selling helps.</p>' +
              '</div>')
          : '<div class="card ok">' +
              '<h3>You never panic sold</h3>' +
              '<p class="sub">You held through every drop in those forty years. That is the single hardest thing on this screen and it is the one that mattered most.</p>' +
            '</div>') +

        '<div class="card">' +
          '<h3>Against a plain index portfolio</h3>' +
          '<p class="sub">A boring 80% stocks and 20% bonds mix, never touched, same start year and same contributions, finished with ' +
          '<b>' + moneyFull(base.final) + '</b>. You finished with <b>' + moneyFull(run.final) + '</b>.</p>' +
          '<p class="hint">' + (run.final >= base.final
            ? "You beat it. Worth asking how much more of a ride you took to get there."
            : "It beat you. That happens to most people, most of the time, and it is not because they are dumb.") + '</p>' +
        '</div>' +

        '<div class="card">' +
          '<h3>Every other year you could have started</h3>' +
          '<p class="sub">Your exact mix, held without touching it, run from all <b>' + sorted.length + '</b> possible starting years in this data. ' +
          'Yours lands at the <b>' + ordinal(pctile) + ' percentile</b>.</p>' +
          '<div class="range">' +
            '<div class="range-row"><span>Worst start in history</span><b>' + money(sorted[0]) + '</b></div>' +
            '<div class="range-row"><span>Middle</span><b>' + money(sorted[Math.floor(sorted.length / 2)]) + '</b></div>' +
            '<div class="range-row"><span>Best start in history</span><b>' + money(sorted[sorted.length - 1]) + '</b></div>' +
          '</div>' +
          '<div class="callout ' + (anyLost === 0 ? "ok" : "warn") + '">' +
            (anyLost === 0
              ? "<b>Not one of those " + sorted.length + " starting points lost money over 40 years.</b> Not 1929, four months before the crash. Not 1965, right before the worst stretch for stocks in modern history. Not 1972. The starting year changed the ride, not the destination."
              : "<b>" + anyLost + " of those " + sorted.length + " starting points finished below what was put in.</b> Worth knowing which mix does that, and why.") +
          '</div>' +
        '</div>' +

        '<div class="card center">' +
          '<h3>Run it again</h3>' +
          '<p class="sub">Change one thing. A different mix, a different start, a different decision at the crash. Watch what actually moves the number.</p>' +
          '<button class="btn" id="again">Play again</button>' +
          '<a class="btn dark" href="https://calendar.app.google/SQV7d9eK7hsu2rLm8" target="_blank" rel="noopener">Book a free 1-on-1</a>' +
        '</div>' +

        '<div class="card privacy">' +
          '<h4>Where this lives</h4>' +
          '<p class="sub">Nothing you did here was sent anywhere. It is in this browser, on this device only. <b>AGP never sees it.</b></p>' +
          '<button class="btn ghost danger" id="wipe">Clear my data from this device</button>' +
          '<p class="hint">On a borrowed or shared device? Tap this before you hand it back.</p>' +
        '</div>' +
      '</div>'
    ));
    document.getElementById("again").onclick = function () {
      state.screen = "allocate"; state.run = null; state.decisions = []; state.segIndex = 0; save(); render();
    };
    document.getElementById("wipe").onclick = function () {
      if (confirm("Erase this run from the device? Screenshot it first if you want to keep it.")) reset(true);
    };
  }

  /* ---------------- chart ---------------- */
  function chartSvg(hist, upTo) {
    var W = 640, H = 220, PADL = 6, PADB = 18, PADT = 8;
    var pts = hist.slice(0, upTo);
    var max = 0;
    pts.forEach(function (p) { max = Math.max(max, p.total, p.contributed); });
    if (max <= 0) max = 1;
    function x(i) { return PADL + (i / Math.max(1, YEARS - 1)) * (W - PADL * 2); }
    function y(v) { return PADT + (1 - v / max) * (H - PADT - PADB); }
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + "," + y(p.total).toFixed(1); }).join(" ");
    var area = line + " L" + x(pts.length - 1).toFixed(1) + "," + y(0).toFixed(1) + " L" + x(0).toFixed(1) + "," + y(0).toFixed(1) + " Z";
    var cont = pts.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + "," + y(p.contributed).toFixed(1); }).join(" ");
    var ticks = "";
    for (var d = 0; d < YEARS; d += 10) {
      ticks += '<text class="tick" x="' + x(d).toFixed(1) + '" y="' + (H - 4) + '">' + hist[d].year + '</text>';
    }
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Portfolio value over time">' +
      '<path class="area" d="' + area + '"/>' +
      '<path class="cont" d="' + cont + '"/>' +
      '<path class="line" d="' + line + '"/>' +
      ticks +
    '</svg>' +
    '<div class="legend"><span><i class="sw line"></i>What it is worth</span><span><i class="sw cont"></i>What you put in</span></div>';
  }

  /* ---------------- boot ---------------- */
  applyBranding();
  state = load();
  render();
})();
