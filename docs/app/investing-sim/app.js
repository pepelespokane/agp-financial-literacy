/* AGP - Investing Simulation
   Self-contained, no backend. Runs on the athlete's device. Nothing is transmitted.
   Stocks and bonds use REAL historical sequences from data.js. The concentrated bet is a
   MODEL, calibrated to published single-stock research, and is labeled as a model in the UI.
   Calendar years are hidden during play and revealed at the end.
   Per-school branding via ?school=. No em dashes in user-facing copy. */

(function () {
  "use strict";

  /* ---------------- branding ---------------- */
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
  var MONTHS = YEARS * 12;
  var WAIT_OPTS = [3, 6, 9, 12];
  /* Concentrated-bet model, calibrated 2026-09-13 against Bessembinder (CRSP 1926-2016):
     ~30% of individual stocks beat the market over their lifetime, and slightly more than
     half deliver negative returns. Monte Carlo over 35,400 paths puts this parameter set at
     29.7% beating an 80/20 index and 50.5% losing real purchasing power.
     Deliberately NOT tuned to make the boring answer always win. */
  var BET_MEAN = 0.10, BET_DRIFT = 0.03, BET_AMP = 1.6, BET_NOISE_SD = 0.30;
  var BET_WIPEOUT_P = 0.008, BET_WIPEOUT_R = -0.90;

  var START_OPTS = [0, 250, 500, 1000];
  var MONTHLY_OPTS = [25, 50, 100, 150, 200];

  var CLASSES = [
    { key: "stocks", name: "Stocks", real: true,
      desc: "Small pieces of thousands of companies at once, the way an index fund works. Grows the most over long stretches and drops the hardest along the way." },
    { key: "bonds", name: "Bonds", real: true,
      desc: "Lending money to the government and collecting interest. Grows slower, falls less, and often holds up when stocks are falling." },
    { key: "bet", name: "One Big Bet", real: false,
      desc: "Everything riding on one company's stock instead of spread across thousands. If that one company does well you do great. If it runs into trouble there is nothing else to catch you." }
  ];

  /* ---------------- state ---------------- */
  var KEY = "agp_investsim_v3";   // v2 held the pre-monthly state shape
  var state = null;
  function freshState() {
    return {
      screen: "welcome",
      lump: 250,
      plans: [{ at: 0, monthly: 100, mix: { stocks: 70, bonds: 20, bet: 10 } }],
      startYear: null,
      salt: Math.floor(Math.random() * 1000000),
      cursorM: 0,
      outs: [],
      dipsUsed: 0,
      draft: null
    };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) { var s = JSON.parse(raw); if (s && s.plans) return s; } } catch (e) {}
    return freshState();
  }
  function reset(cleared) {
    try { localStorage.removeItem(KEY); } catch (e) {}
    state = freshState(); state.justCleared = !!cleared; render();
  }
  function plan0() { return state.plans[0]; }
  function lastPlan() { return state.plans[state.plans.length - 1]; }

  /* ---------------- helpers ---------------- */
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function money(n) {
    n = Math.round(n);
    if (Math.abs(n) >= 1000000) return "$" + (n / 1000000).toFixed(2).replace(/\.?0+$/, "") + "M";
    return "$" + n.toLocaleString("en-US");
  }
  function moneyFull(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function pctStr(n) { return (n >= 0 ? "+" : "") + (n * 100).toFixed(1) + "%"; }
  function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function el(h) { var d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstChild; }

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

  /* ---------------- market data ---------------- */
  var BY_YEAR = {};
  MARKET_DATA.forEach(function (r) { BY_YEAR[r[0]] = { sp: r[1] / 100, tbill: r[2] / 100, tbond: r[3] / 100, cpi: r[4] / 100 }; });
  var SHAPE = {};
  MONTHLY_SHAPE.forEach(function (r) { SHAPE[r[0]] = r[1]; });

  /* Monthly stock factors for a year: Shiller's real intra-year SHAPE (rescaled to a
     product of 1) times Damodaran's annual TOTAL return. The twelve factors multiply back
     to exactly (1 + annual), so every annual figure and the Bessembinder calibration are
     unchanged, and the path inside the year becomes the real one.
     Bonds, the bet and cash have no monthly series and are spread evenly. They are not
     what crashes. */
  function monthlyStock(year) {
    var sh = SHAPE[year], lvl = Math.pow(1 + BY_YEAR[year].sp, 1 / 12), out = [];
    for (var m = 0; m < 12; m++) out.push(sh[m] * lvl - 1);
    return out;
  }
  function evenMonthly(annual) { return Math.pow(1 + annual, 1 / 12) - 1; }
  var FIRST_YEAR = MARKET_DATA[0][0], LAST_YEAR = MARKET_DATA[MARKET_DATA.length - 1][0];
  function startYears() {
    var out = [];
    for (var y = FIRST_YEAR; y + YEARS - 1 <= LAST_YEAR; y++) out.push(y);
    return out;
  }

  /* Redrawn every play. Real history repeats identically on a replay; a single position
     does not, because that is what concentrated risk actually is. */
  function betPath(startYear) {
    var rng = mulberry32((startYear * 2654435761 + (state.salt || 0) * 40503) % 2147483647);
    var out = [], dead = false;
    for (var i = 0; i < YEARS; i++) {
      if (dead) { out.push(0); continue; }
      var sp = BY_YEAR[startYear + i].sp;
      var r = BET_MEAN + BET_DRIFT + BET_AMP * (sp - BET_MEAN) + gauss(rng) * BET_NOISE_SD;
      if (rng() < BET_WIPEOUT_P) { r = BET_WIPEOUT_R; dead = true; }
      out.push(Math.max(r, -0.95));
    }
    return out;
  }

  function normPct(m) { return { stocks: m.stocks, bonds: m.bonds, bet: m.bet }; }
  function normalize(m) {
    var s = num(m.stocks) + num(m.bonds) + num(m.bet);
    if (s <= 0) return { stocks: 1, bonds: 0, bet: 0 };
    return { stocks: num(m.stocks) / s, bonds: num(m.bonds) / s, bet: num(m.bet) / s };
  }

  /* ---------------- engine ---------------- */
  function plansMonthlyAt(plans, i) {
    var m = plans[0].monthly;
    for (var p = 1; p < plans.length; p++) if (plans[p].at <= i) m = plans[p].monthly;
    return m;
  }
  function isOut(m, outs) {
    for (var k = 0; k < (outs || []).length; k++) {
      var o = outs[k];
      if (m >= o.from && (o.to === null || o.to === undefined || m < o.to)) return true;
    }
    return false;
  }
  function simulate(lump, plans, startYear, outs) {
    var bet = betPath(startYear);
    var bal = { stocks: 0, bonds: 0, bet: 0, cash: 0 };
    var cur = normalize(plans[0].mix), monthly = plans[0].monthly;
    var hist = [], contributed = lump, wasOut = false, unit = 1, mktIdx = 1;

    bal.stocks = lump * cur.stocks; bal.bonds = lump * cur.bonds; bal.bet = lump * cur.bet;

    for (var y = 0; y < YEARS; y++) {
      /* a plan change takes effect at the start of the year: rebalance, then follow it */
      for (var p = 1; p < plans.length; p++) {
        if (plans[p].at !== y) continue;
        var nm = normalize(plans[p].mix);
        var tot = bal.stocks + bal.bonds + bal.bet;   // money in savings is not rebalanced
        bal.stocks = tot * nm.stocks; bal.bonds = tot * nm.bonds; bal.bet = tot * nm.bet;
        cur = nm; monthly = plans[p].monthly;
      }
      var yr = BY_YEAR[startYear + y];
      var ms = monthlyStock(startYear + y);
      var mb = evenMonthly(yr.tbond), mk = evenMonthly(bet[y]), mc = evenMonthly(yr.tbill);

      for (var k = 0; k < 12; k++) {
        var mi = y * 12 + k;
        contributed += monthly;
        var out = isOut(mi, outs);
        if (out && !wasOut) {
          bal.cash += bal.stocks + bal.bonds + bal.bet;
          bal.stocks = bal.bonds = bal.bet = 0;
        } else if (!out && wasOut) {
          bal.stocks += bal.cash * cur.stocks; bal.bonds += bal.cash * cur.bonds; bal.bet += bal.cash * cur.bet;
          bal.cash = 0;
        }
        wasOut = out;
        if (out) {
          bal.cash = (bal.cash + monthly) * (1 + mc);
          unit *= (1 + mc);
        } else {
          bal.stocks += monthly * cur.stocks; bal.bonds += monthly * cur.bonds; bal.bet += monthly * cur.bet;
          bal.stocks *= (1 + ms[k]); bal.bonds *= (1 + mb); bal.bet *= (1 + mk);
          unit *= (1 + cur.stocks * ms[k] + cur.bonds * mb + cur.bet * mk);
        }
        mktIdx *= (1 + ms[k]);
        hist.push({
          m: mi, y: y, year: startYear + y, month: k + 1, out: out, unit: unit, mkt: mktIdx,
          total: bal.stocks + bal.bonds + bal.bet + bal.cash,
          contributed: contributed,
          bal: { stocks: bal.stocks, bonds: bal.bonds, bet: bal.bet, cash: bal.cash },
          r: { stocks: ms[k], bonds: mb, bet: mk, cash: mc },
          ann: { stocks: yr.sp, bonds: yr.tbond, bet: bet[y], cash: yr.tbill }
        });
      }
    }
    var infl = 1, savings = lump;
    for (var j = 0; j < YEARS; j++) {
      infl *= (1 + BY_YEAR[startYear + j].cpi);
      savings = (savings + plansMonthlyAt(plans, j) * 12) * (1 + BY_YEAR[startYear + j].tbill);
    }
    var monthsOut = hist.filter(function (h) { return h.out; }).length;
    return { hist: hist, final: hist[MONTHS - 1].total, contributed: contributed,
             inflation: infl, savings: savings, monthsOut: monthsOut,
             yearsOut: Math.round(monthsOut / 12 * 10) / 10 };
  }
  /* Measured on the contribution-free unit value. Using the account balance hides
     drawdowns, because fresh money keeps topping it back up. */
  /* Compounded average per year for each asset over a stretch. Without this the
     check-in asks you to reallocate with no idea how each option actually did. */
  /* annualised from a run of months */
  function yearsOf(from, to) { return Math.max(1, (to - from)) / 12; }
  function spanLabel(from, to) {
    var y0 = Math.floor(from / 12) + 1, y1 = Math.ceil(to / 12);
    return y0 >= y1 ? "Year " + y1 : "Years " + y0 + " to " + y1;
  }
  function monthsWord(n) { return n + (n === 1 ? " month" : " months"); }
  function assetReturns(hist, from, to) {
    var out = {};
    CLASSES.forEach(function (c) {
      var g = 1, n = 0;
      for (var i = from; i < to && i < hist.length; i++) { g *= (1 + hist[i].r[c.key]); n++; }
      out[c.key] = n ? Math.pow(g, 12 / n) - 1 : 0;   // annualised
    });
    return out;
  }
  function assetTable(hist, from, to, mix, label) {
    var r = assetReturns(hist, from, to);
    var best = null;
    CLASSES.forEach(function (c) { if (best === null || r[c.key] > r[best]) best = c.key; });
    return '<div class="perf"><div class="perf-hd">' + label + '</div>' +
      CLASSES.map(function (c) {
        return '<div class="perf-row' + (c.key === best ? " top" : "") + '">' +
          '<span class="dot ' + c.key + '"></span>' +
          '<span class="nm">' + c.name + '</span>' +
          (mix ? '<span class="held">' + (mix[c.key] > 0 ? "you held " + mix[c.key] + "%" : "not held") + '</span>' : "") +
          '<span class="vl ' + (r[c.key] >= 0 ? "pos" : "neg") + '">' + pctStr(r[c.key]) + '<i>/yr</i></span>' +
        '</div>';
      }).join("") + '</div>';
  }
  function maxDrawdown(hist, from, to) {
    var peak = -Infinity, dd = 0;
    for (var i = Math.max(0, from - 1); i < to && i < hist.length; i++) {
      peak = Math.max(peak, hist[i].unit);
      if (peak > 0) dd = Math.max(dd, (peak - hist[i].unit) / peak);
    }
    return dd;
  }
  /* Trigger on how far the MARKET has fallen from its high, not on a single calendar
     year. Two reasons. A single year <= -15% happens only once in 28 of the 59 possible
     windows, so half of all players only ever saw one event. And people panic at an
     accumulated loss and a headline, not at a year-end summary.
     Measured on the market so a bond-heavy player still faces the decision; the screen
     then shows the market drop AND their own, which is the diversification lesson. */
  var DIP_DRAWDOWN = 0.10;
  var MAX_DIPS = 2;
  function currentlyOut() {
    var o = state.outs[state.outs.length - 1];
    return o && (o.to === null || o.to === undefined);
  }
  /* Where does the run pause next? Whichever comes first:
     - every year, while sitting in cash, so the choice to come back is live
     - a bad year big enough that real people bail (at most MAX_DIPS times)
     - the ten year check-in
     - the end */
  /* Market index and its drawdown, rebuilt from year 0 so it does not depend on the mix. */
  /* Monthly, so a crash that a calendar year hides is visible. 1987 fell 26% between
     August and November and still finished the year up 5.81%. */
  function marketDrawdowns(run) {
    var peak = 0, peakAt = 0, out = [];
    for (var i = 0; i < MONTHS; i++) {
      var idx = run.hist[i].mkt;
      if (idx > peak) { peak = idx; peakAt = i; }
      out.push({ dd: (peak - idx) / peak, since: i - peakAt });
    }
    return out;
  }
  /* Which two crashes does this athlete live through?
     Not the first two that cross 10%, because at monthly resolution that happens about
     eight times in forty years and both would land in the opening years. Instead: find
     every distinct episode (a peak, the fall, the recovery to a new peak), rank them by
     how deep they eventually got, and take the two worst.
     Across all 59 windows that yields two every time, averaging 38% deep, landing around
     year 16 and year 32.
     Each one FIRES at the month the fall first passes 10%, not at the bottom. That is the
     honest moment: you are down a tenth, it is going to get much worse, and nobody can
     tell you that yet. */
  function dipMonths(run) {
    var peak = 0, eps = [], cur = null;
    for (var i = 0; i < MONTHS; i++) {
      var v = run.hist[i].mkt;
      if (v >= peak) { if (cur && cur.fireAt !== null) eps.push(cur); cur = null; peak = v; continue; }
      var dd = (peak - v) / peak;
      if (!cur) cur = { depth: 0, fireAt: null };
      if (dd > cur.depth) cur.depth = dd;
      if (cur.fireAt === null && dd >= DIP_DRAWDOWN) cur.fireAt = i;
    }
    if (cur && cur.fireAt !== null) eps.push(cur);
    /* Nothing in the first three years: a crash decision with $1,000 at stake carries no
       weight, and the point of the moment is that it costs something to get wrong. */
    eps = eps.filter(function (e) { return e.fireAt >= 36; });
    eps.sort(function (a, b) { return b.depth - a.depth; });
    return eps.slice(0, MAX_DIPS).map(function (e) { return e.fireAt; })
              .sort(function (a, b) { return a - b; });
  }
  function nextStop(run) {
    var c = state.cursorM;
    if (c >= MONTHS) return { at: MONTHS, kind: "end" };
    if (currentlyOut()) return { at: Math.min(MONTHS, c + (state.waitFor || 3)), kind: "waiting" };
    var checkpoint = Math.min(MONTHS, (Math.floor(c / 120) + 1) * 120);
    var dm = dipMonths(run);
    for (var k = 0; k < dm.length; k++) {
      if (dm[k] >= c && dm[k] < checkpoint && !isOut(dm[k], state.outs)) {
        return { at: dm[k] + 1, kind: "dip" };
      }
    }
    return { at: checkpoint, kind: checkpoint >= MONTHS ? "end" : "checkpoint" };
  }


  /* ---------------- render ---------------- */
  var app = document.getElementById("app");
  function go(s) { state.screen = s; save(); render(); window.scrollTo(0, 0); }
  function render() {
    app.innerHTML = "";
    var f = { welcome: renderWelcome, allocate: renderAllocate, start: renderStart,
              segment: renderSegment, checkpoint: renderCheckpoint, dip: renderDip,
              waiting: renderWaiting, reveal: renderReveal }[state.screen];
    (f || renderWelcome)();
  }

  function chipRow(id, opts, val, fmt) {
    return '<div class="chips" id="' + id + '">' + opts.map(function (v) {
      return '<button class="chip' + (val === v ? " on" : "") + '" data-v="' + v + '">' + fmt(v) + '</button>';
    }).join("") + '</div>';
  }
  function wireChips(id, set) {
    Array.prototype.forEach.call(document.getElementById(id).querySelectorAll(".chip"), function (c) {
      c.onclick = function () { set(num(this.getAttribute("data-v"))); save(); render(); };
    });
  }

  function renderWelcome() {
    app.appendChild(el(
      '<div class="screen">' +
        (state.justCleared ? '<div class="callout ok">Cleared. Nothing from your run is left on this device.</div>' : "") +
        '<div class="card">' +
          '<span class="tag">The setup</span>' +
          '<h1 class="title">Starting today, what happens over the next 40 years?</h1>' +
          '<p class="lede">You put money in, you leave it alone, and time does the work. ' +
          'You will make a few decisions along the way, the same ones real investors make, and see where it lands.</p>' +
          '<div class="callout"><b>The market you get is real.</b> Stocks and bonds here follow an actual 40 year stretch of market history. ' +
          'The crashes are real crashes and the recoveries are real recoveries. <b>You find out which stretch at the end.</b></div>' +
          '<label class="fld" for="lumpIn">Anything to start with?</label>' +
          '<div class="money-in"><input type="number" inputmode="numeric" id="lumpIn" placeholder="0" min="0" step="50" value="' +
            (state.lump ? state.lump : "") + '"></div>' +
          '<p class="hint">Leave it blank if you are starting from nothing. That is where most people start.</p>' +
          '<label class="fld" for="monIn">How much can you add each month?</label>' +
          '<div class="money-in"><input type="number" inputmode="numeric" id="monIn" placeholder="0" min="0" step="25" value="' +
            (plan0().monthly ? plan0().monthly : "") + '"></div>' +
          chipRow("monChips", MONTHLY_OPTS, plan0().monthly, function (v) { return "$" + v; }) +
          '<p class="hint">Type any amount, or tap one. You get chances to change it later, and whether you do is part of the lesson.</p>' +
          '<button class="btn" id="next">Build my mix</button>' +
          '<button class="btn ghost" id="reset">Start over</button>' +
        '</div>' +
      '</div>'
    ));
    state.justCleared = false;
    var lumpIn = document.getElementById("lumpIn"), monIn = document.getElementById("monIn");
    lumpIn.addEventListener("input", function () { state.lump = Math.max(0, num(this.value)); save(); });
    monIn.addEventListener("input", function () {
      plan0().monthly = Math.max(0, num(this.value));
      Array.prototype.forEach.call(document.querySelectorAll("#monChips .chip"), function (c) {
        c.classList.toggle("on", num(c.getAttribute("data-v")) === plan0().monthly);
      });
      save();
    });
    Array.prototype.forEach.call(document.querySelectorAll("#monChips .chip"), function (c) {
      c.onclick = function () {
        plan0().monthly = num(this.getAttribute("data-v"));
        monIn.value = plan0().monthly; save(); render();
      };
    });
    document.getElementById("next").onclick = function () {
      if (state.lump <= 0 && plan0().monthly <= 0) { alert("Put in a starting amount or a monthly amount to get going."); return; }
      go("allocate");
    };
    document.getElementById("reset").onclick = function () { reset(false); };
  }

  function mixSliders(mix, prefix, compact) {
    return CLASSES.map(function (c) {
      return '<div class="alloc' + (compact ? " compact" : "") + '">' +
        '<div class="alloc-top">' +
          '<div><span class="dot ' + c.key + '"></span><b>' + c.name + '</b>' +
            (c.real ? '<span class="badge real">real history</span>' : '<span class="badge model">modeled</span>') + '</div>' +
          '<div class="alloc-val" id="' + prefix + 'v_' + c.key + '">' + mix[c.key] + '%</div>' +
        '</div>' +
        '<input type="range" class="' + c.key + '" min="0" max="100" step="5" id="' +
          prefix + 's_' + c.key + '" value="' + mix[c.key] + '" aria-label="' + c.name + ' percentage">' +
        (compact ? "" : '<div class="alloc-desc">' + c.desc + '</div>') +
      '</div>';
    }).join("") + mixBar(prefix);
  }
  function mixSummary(mix) {
    return CLASSES.filter(function (c) { return mix[c.key] > 0; })
      .map(function (c) { return mix[c.key] + "% " + c.name; }).join(" · ") || "Nothing allocated";
  }
  function mixBar(prefix) {
    return '<div class="mixbar" id="' + prefix + 'bar">' +
        CLASSES.map(function (c) { return '<i class="' + c.key + '" id="' + prefix + 'bar_' + c.key + '"></i>'; }).join("") +
      '</div><div class="mixlabel" id="' + prefix + 'barlbl"></div>';
  }
  /* Moving one slider redistributes the others so the mix always totals 100.
     On a phone, making someone hand-balance three numbers to exactly 100 is the
     fastest way to lose them. */
  function rebalanceMix(mix, movedKey) {
    var v = Math.max(0, Math.min(100, mix[movedKey]));
    mix[movedKey] = v;
    var others = CLASSES.map(function (c) { return c.key; }).filter(function (k) { return k !== movedKey; });
    var rest = 100 - v;
    var cur = others.reduce(function (a, k) { return a + mix[k]; }, 0);
    if (cur <= 0) {
      mix[others[0]] = Math.round(rest / 2 / 5) * 5;
      mix[others[1]] = rest - mix[others[0]];
    } else {
      var first = Math.round((mix[others[0]] / cur) * rest / 5) * 5;
      first = Math.max(0, Math.min(rest, first));
      mix[others[0]] = first;
      mix[others[1]] = rest - first;
    }
  }
  function wireMix(mix, prefix, btnId) {
    function paint() {
      CLASSES.forEach(function (c) {
        document.getElementById(prefix + "v_" + c.key).textContent = mix[c.key] + "%";
        var sl = document.getElementById(prefix + "s_" + c.key);
        if (num(sl.value) !== mix[c.key]) sl.value = mix[c.key];
        document.getElementById(prefix + "bar_" + c.key).style.width = mix[c.key] + "%";
      });
      document.getElementById(prefix + "barlbl").innerHTML = CLASSES.filter(function (c) { return mix[c.key] > 0; })
        .map(function (c) { return '<span>' + c.name + ' ' + mix[c.key] + '%</span>'; }).join("") || "<span>Nothing allocated</span>";
    }
    CLASSES.forEach(function (c) {
      document.getElementById(prefix + "s_" + c.key).addEventListener("input", function () {
        mix[c.key] = num(this.value);
        rebalanceMix(mix, c.key);
        paint(); save();
      });
    });
    paint();
  }

  function renderAllocate() {
    var mix = plan0().mix;
    app.appendChild(el(
      '<div class="screen"><div class="card">' +
        '<span class="tag">Your mix</span>' +
        '<h1 class="title">How do you want it split?</h1>' +
        '<p class="lede">Nothing here is recommended and there is no right answer. You are choosing how much of a ride you are willing to take.</p>' +
        '<div class="callout"><b>This is money you will not touch for 40 years.</b> Your emergency fund and your savings are a different job and they are not part of this. ' +
        'Never invest money you might need soon.</div>' +
        mixSliders(mix, "a") +
        '<p class="hint">Move one and the others adjust. It always adds up to 100.</p>' +
        '<button class="btn" id="next">Lock it in</button>' +
        '<button class="btn ghost" id="back">Back</button>' +
      '</div></div>'
    ));
    wireMix(mix, "a", "next");
    document.getElementById("next").onclick = function () {
      var ys = startYears();
      state.startYear = ys[Math.floor(Math.random() * ys.length)];
      state.salt = Math.floor(Math.random() * 1000000);
      state.cursorM = 0; state.outs = []; state.dipsUsed = 0;
      state.plans = [{ at: 0, monthly: plan0().monthly, mix: { stocks: mix.stocks, bonds: mix.bonds, bet: mix.bet } }];
      go("start");
    };
    document.getElementById("back").onclick = function () { go("welcome"); };
  }

  function renderStart() {
    app.appendChild(el(
      '<div class="screen"><div class="card center">' +
        '<span class="tag">Here we go</span>' +
        '<div class="hugeyear">Year 1</div>' +
        '<p class="lede">You are invested. From here the market does what the market does, and you get a look at things every ten years.</p>' +
        '<div class="callout">You did not get to choose which 40 years you get. <b>Nobody does.</b> That is the part nobody controls, ' +
        'and it matters less than what you do while it is happening.</div>' +
        '<button class="btn" id="next">Start the clock</button>' +
      '</div></div>'
    ));
    document.getElementById("next").onclick = function () { go("segment"); };
  }

  function currentRun() { return simulate(state.lump, state.plans, state.startYear, state.outs); }

  function renderSegment() {
    var run = currentRun();
    var stop = nextStop(run);
    /* A crash, or the next update while sitting out, interrupts. Showing a tidy summary
       first and making the athlete tap "keep going" defuses the whole moment. */
    if (stop.kind === "dip" || stop.kind === "waiting") {
      state.cursorM = stop.at; save(); go(stop.kind); return;
    }
    var b = { from: state.cursorM, to: stop.at };
    if (b.to <= b.from) { state.cursorM = b.to; go(stop.kind === "end" ? "reveal" : stop.kind); return; }
    var last = run.hist[b.to - 1], dd = maxDrawdown(run.hist, b.from, b.to);
    var growth = 1, seen = {}, yrList = [];
    for (var i = b.from; i < b.to; i++) {
      growth *= (1 + run.hist[i].r.stocks);
      var yi = run.hist[i].y;
      if (!seen[yi]) { seen[yi] = 1; yrList.push({ y: yi, r: run.hist[i].ann.stocks }); }
    }
    var worst = yrList[0], best = yrList[0];
    yrList.forEach(function (o) {
      if (o.r < worst.r) worst = o;
      if (o.r > best.r) best = o;
    });
    var avg = Math.pow(growth, 12 / (b.to - b.from)) - 1;   // annualised
    app.appendChild(el(
      '<div class="screen"><div class="card">' +
        '<span class="tag">' + spanLabel(b.from, b.to) + '</span>' +
        '<div class="bigfig">' + moneyFull(last.total) + '</div>' +
        '<div class="sub">You have put in ' + moneyFull(last.contributed) + '</div>' +
        chartSvg(run.hist, b.to) +
        assetTable(run.hist, b.from, b.to, normPct(lastPlan().mix), "How each one did, average per year") +
        '<div class="statrow">' +
          '<div class="stat"><span>Worst year</span><b class="neg">' + pctStr(worst.r) + '</b><i>stocks, year ' + (worst.y + 1) + '</i></div>' +
          '<div class="stat"><span>Best year</span><b class="pos">' + pctStr(best.r) + '</b><i>stocks, year ' + (best.y + 1) + '</i></div>' +
          '<div class="stat"><span>Your deepest drop</span><b class="' + (dd > 0.2 ? "neg" : "") + '">' +
            (Math.round(dd * 100) === 0 ? "none" : "-" + Math.round(dd * 100) + "%") + '</b><i>your mix</i></div>' +
        '</div>' +
        '<button class="btn" id="next">' + ({ end: "See how it ended", dip: "Keep reading",
            checkpoint: "Check in", waiting: "Keep reading" }[stop.kind] || "Continue") + '</button>' +
      '</div></div>'
    ));
    document.getElementById("next").onclick = function () {
      state.cursorM = b.to;
      if (stop.kind === "end") { save(); go("reveal"); return; }
      if (stop.kind === "checkpoint") {
        var lp = lastPlan();
        state.draft = { at: Math.round(b.to / 12), monthly: lp.monthly,
                        mix: { stocks: lp.mix.stocks, bonds: lp.mix.bonds, bet: lp.mix.bet } };
      }
      save(); go(stop.kind);
    };
  }

  /* Every ten years: put in more or less, change the mix, or change nothing. All real choices. */
  function renderCheckpoint() {
    var run = currentRun(), atM = state.cursorM, at = Math.round(atM / 12);
    var dd = maxDrawdown(run.hist, Math.max(0, atM - 120), atM);
    var lp = lastPlan(), d = state.draft, yrs = YEARS - at;
    var context = dd >= 0.25
      ? '<div class="callout warn"><b>That was a rough stretch.</b> At one point your money was down ' + Math.round(dd * 100) +
        '% from its high. This is where a lot of people cut back on what they put in, or move everything somewhere that feels safer. ' +
        'You have ' + yrs + ' years to go.</div>'
      : '<div class="callout"><b>' + yrs + ' years to go.</b> Life changes. Maybe you are earning more now, maybe money is tighter. ' +
        'This is a normal point to look at what you are doing and adjust.</div>';
    app.appendChild(el(
      '<div class="screen"><div class="card">' +
        '<span class="tag">Check in &middot; end of year ' + at + '</span>' +
        '<h1 class="title">Anything you want to change?</h1>' +
        context +
        assetTable(run.hist, Math.max(0, atM - 120), atM, normPct(lp.mix), "How each one did over the last stretch, per year") +
        '<label class="fld">Monthly amount</label>' +
        chipRow("cpMon", MONTHLY_OPTS, d.monthly, function (v) { return "$" + v; }) +
        '<p class="hint">You have been putting in ' + moneyFull(lp.monthly) + ' a month.</p>' +
        '<label class="fld">Your mix</label>' +
        '<p class="hint" style="margin:0 0 4px">Move one and the others adjust. Leaving it alone is fine.</p>' +
        mixSliders(d.mix, "c", true) +
        '<button class="btn" id="next">Confirm and keep going</button>' +
        '<p class="hint">Changing nothing is a real choice, and often the right one.</p>' +
      '</div></div>'
    ));
    Array.prototype.forEach.call(document.getElementById("cpMon").querySelectorAll(".chip"), function (c) {
      c.onclick = function () { state.draft.monthly = num(this.getAttribute("data-v")); save(); render(); };
    });
    wireMix(d.mix, "c", "next");
    document.getElementById("next").onclick = function () {
      var changed = d.monthly !== lp.monthly || d.mix.stocks !== lp.mix.stocks ||
                    d.mix.bonds !== lp.mix.bonds || d.mix.bet !== lp.mix.bet;
      if (changed) state.plans.push({ at: d.at, monthly: d.monthly, mix: d.mix });
      state.draft = null;
      save(); go("segment");
    };
  }

  /* A bad enough year that real people bail. The whole point is that you do not
     know how deep it goes or when it turns. */
  function renderDip() {
    var run = currentRun(), i = state.cursorM - 1, h = run.hist[i];
    var peak = 0;
    for (var k = 0; k <= i; k++) peak = Math.max(peak, run.hist[k].unit);
    var down = peak > 0 ? (peak - h.unit) / peak : 0;
    var md = marketDrawdowns(run)[i];
    var mdd = md.dd, since = Math.max(1, md.since);
    var cushioned = mdd - down >= 0.05;
    app.appendChild(el(
      '<div class="screen"><div class="card">' +
        '<span class="tag">Year ' + (h.y + 1) + ', month ' + h.month + '</span>' +
        '<h1 class="title">The market has fallen ' + Math.round(mdd * 100) + '% in ' + monthsWord(since) + '.</h1>' +
        '<div class="bigfig">' + moneyFull(h.total) + '</div>' +
        '<div class="sub">what you have right now, after putting in ' + moneyFull(h.contributed) + '</div>' +
        '<div class="callout warn">Your own money is down <b>' + Math.round(down * 100) + '%</b> from its high. ' +
        (cushioned ? '<b>Less than the market, because of what else you were holding.</b> ' : "") +
        'The news says it could get worse. <b>Nobody can tell you how far down it goes, or when it turns.</b></div>' +
        '<button class="choice" data-c="stay"><b>Ride it out</b><span>Stay invested and keep adding</span></button>' +
        '<button class="choice" data-c="out"><b>Get out and wait</b><span>Move everything to a high yield savings account until it settles down</span></button>' +
        '<p class="hint">A high yield savings account pays you interest and cannot lose money, but it does not grow the way the market can. ' +
        'Both of these are things real people do. You find out how it turned out at the end.</p>' +
      '</div></div>'
    ));
    Array.prototype.forEach.call(document.querySelectorAll(".choice"), function (btn) {
      btn.onclick = function () {
        if (this.getAttribute("data-c") === "out") {
          state.outs.push({ from: state.cursorM, to: null });
          state.waitFor = 3;
        }
        save(); go("segment");
      };
    });
  }

  /* Sitting in cash. Each year you learn only what just happened, never what is next. */
  function renderWaiting() {
    var run = currentRun(), i = state.cursorM - 1, h = run.hist[i];
    var o = state.outs[state.outs.length - 1];
    var monthsOut = state.cursorM - o.from;
    var span = Math.min(state.waitFor || 3, monthsOut);
    var before = run.hist[Math.max(0, i - span + 1)].mkt / (1 + run.hist[Math.max(0, i - span + 1)].r.stocks);
    var moved = before > 0 ? (h.mkt - before) / before : 0;
    var up = moved >= 0;
    var sinceOut = o.from > 0 ? (h.mkt - run.hist[o.from - 1].mkt) / run.hist[o.from - 1].mkt : 0;
    app.appendChild(el(
      '<div class="screen"><div class="card">' +
        '<span class="tag">Year ' + (h.y + 1) + ', month ' + h.month + ' &middot; sitting in savings</span>' +
        '<h1 class="title">Over those ' + monthsWord(span) + ' the market went ' +
          (up ? "UP" : "DOWN") + ' ' + Math.abs(Math.round(moved * 100)) + '%.</h1>' +
        '<div class="bigfig">' + moneyFull(h.total) + '</div>' +
        '<div class="sub">sitting in savings</div>' +
        '<div class="callout ' + (up ? "warn" : "") + '">' +
          (up ? '<b>You were not in it.</b> Your savings account kept earning its steady rate while that happened.'
              : '<b>Staying out looks smart so far.</b> Your savings account held its value instead.') +
          ' You have been out <b>' + monthsWord(monthsOut) + '</b>, and the market is ' +
          (sinceOut >= 0 ? '<b>up ' : '<b>down ') + Math.abs(Math.round(sinceOut * 100)) + '%</b> since you left.</div>' +
        '<button class="choice" data-c="in"><b>Get back in now</b><span>Put it all back to work at your mix</span></button>' +
        '<div class="waitrow">' + WAIT_OPTS.map(function (w) {
          return '<button class="chip" data-wait="' + w + '">' + w + ' mo</button>';
        }).join("") + '</div>' +
        '<p class="hint" style="margin-top:4px">Stay out a while longer and look again.</p>' +
        (monthsOut >= 9
          ? '<button class="choice" data-c="never" style="margin-top:12px"><b>I am done with the market</b>' +
            '<span>Leave it in the high yield savings account for the rest of the 40 years</span></button>'
          : "") +
        '<p class="hint">You still cannot see what happens next. Neither can anyone else.</p>' +
      '</div></div>'
    ));
    Array.prototype.forEach.call(document.querySelectorAll(".choice"), function (btn) {
      btn.onclick = function () {
        var c = this.getAttribute("data-c");
        if (c === "in") { o.to = state.cursorM; state.cursorM = Math.ceil(state.cursorM / 12) * 12; }
        if (c === "never") { o.to = MONTHS; state.cursorM = Math.ceil(state.cursorM / 12) * 12; }
        save(); go("segment");
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-wait]"), function (btn) {
      btn.onclick = function () {
        state.waitFor = num(this.getAttribute("data-wait"));
        save(); go("segment");
      };
    });
  }

  function renderReveal() {
    var run = currentRun();
    var never = simulate(state.lump, [state.plans[0]], state.startYear, []);
    var stayedIn = simulate(state.lump, state.plans, state.startYear, []);
    var satOut = run.monthsOut > 0;
    var timingDiff = stayedIn.final - run.final;
    var base = simulate(state.lump, [{ at: 0, monthly: plan0().monthly, mix: { stocks: 80, bonds: 20, bet: 0 } }], state.startYear, []);
    var real = run.final / run.inflation;
    var sy = state.startYear, ey = sy + YEARS - 1;

    var all = startYears().map(function (y) { return simulate(state.lump, [state.plans[0]], y, []).final; });
    var sorted = all.slice().sort(function (a, b) { return a - b; });
    var below = sorted.filter(function (v) { return v < never.final; }).length;
    var pctile = Math.round((below / sorted.length) * 100);
    var anyLost = sorted.filter(function (v) { return v < never.contributed; }).length;

    var changed = state.plans.length > 1;
    var diff = never.final - run.final;
    var rows = CLASSES.map(function (c) {
      var v = run.hist[MONTHS - 1].bal[c.key];
      return '<div class="sum-row"><span class="dot ' + c.key + '"></span><span class="nm">' + c.name + '</span>' +
        '<span class="pc">' + Math.round(run.final > 0 ? (v / run.final) * 100 : 0) + '%</span>' +
        '<span class="vl">' + money(v) + '</span></div>';
    }).join("");

    app.appendChild(el(
      '<div class="screen">' +
        '<div class="hero"><span class="cap">After 40 years</span>' +
          '<div class="huge">' + moneyFull(run.final) + '</div>' +
          '<span class="cap">You put in ' + moneyFull(run.contributed) + '. The market added ' + moneyFull(run.final - run.contributed) + '.</span></div>' +
        chartSvg(run.hist, MONTHS) +
        '<div class="card" style="padding:14px 16px">' + rows + '</div>' +
        '<div class="card">' + assetTable(run.hist, 0, MONTHS, normPct(plan0().mix), "Across all 40 years, average per year") +
          '<p class="hint">This is what each choice did over the whole stretch. Your result depends on how much you had in each one, and for how long.</p></div>' +

        '<div class="card"><h3>Those 40 years were real</h3>' +
          '<p class="sub">You were invested from <b>' + sy + ' to ' + ey + '</b>. Every stock and bond number you just saw is what actually happened in those years. Look it up.</p>' +
          '<p class="hint">You were not told at the time, because while you are living through it nobody tells you which year you are in either.</p></div>' +

        '<div class="card"><h3>What it actually buys</h3>' +
          '<p class="sub">Prices rose over those 40 years, so ' + moneyFull(run.final) + ' at the end does not buy what it would have on day one. ' +
          'In day-one money that is <b>' + moneyFull(real) + '</b>.</p>' +
          '<p class="hint">The same money in a plain savings account would have grown to ' + moneyFull(run.savings) + ', which is only <b>' +
          moneyFull(run.savings / run.inflation) + '</b> in day-one money against the ' + moneyFull(run.contributed) + ' you put in. ' +
          '<b>That is why savings and investing are two different jobs.</b> Savings keeps money safe and available. It does not grow it.</p></div>' +

        (satOut
          ? (timingDiff > 0
            ? '<div class="card flag"><h3>' + (run.monthsOut >= MONTHS - 24
                ? "You got out and never went back"
                : "You sat in savings for " + (run.monthsOut < 24 ? monthsWord(run.monthsOut) : run.yearsOut + " years")) + '</h3>' +
              '<p class="sub">Everything else identical, staying invested the whole way would have finished at <b>' + moneyFull(stayedIn.final) + '</b>. ' +
              'Sitting out cost you <b>' + moneyFull(timingDiff) + '</b>.</p>' +
              '<p class="hint">The drop was real and getting out felt sensible, and a high yield savings account was doing its job the whole time. ' +
              '<b>The problem is that the best years tend to arrive right after the worst ones, while it still feels far too early to go back.</b> ' +
              'You have to be right twice: once on the way out, and once on the way back in.</p></div>'
            : '<div class="card ok"><h3>You sat in savings for ' + run.yearsOut + ' year' + (run.yearsOut === 1 ? "" : "s") + ', and it worked</h3>' +
              '<p class="sub">Staying invested throughout would have finished at <b>' + moneyFull(stayedIn.final) + '</b>. Getting out put you <b>' +
              moneyFull(-timingDiff) + '</b> ahead.</p>' +
              '<p class="hint">That does happen, and pretending otherwise would be dishonest. <b>You had to be right twice, on the way out and on the way back in, ' +
              'and you were.</b> Run it again from a different stretch and count how often that holds.</p></div>')
          : '') +

        (changed
          ? (diff > 0
            ? '<div class="card flag"><h3>You changed your plan along the way</h3>' +
              '<p class="sub">Set once on day one and never touched again, it would have finished at <b>' + moneyFull(never.final) + '</b>. ' +
              'Everything you changed, together, cost you <b>' + moneyFull(diff) + '</b>.</p>' +
              '<p class="hint">Nobody changes course because they are careless. They do it because a drop feels unbearable, or money got tight. ' +
              'That is exactly why you decide what you will do before it happens.</p></div>'
            : '<div class="card ok"><h3>You made changes, and they helped</h3>' +
              '<p class="sub">Leaving it alone would have finished at <b>' + moneyFull(never.final) + '</b>. Your changes put you <b>' + moneyFull(-diff) + '</b> ahead.</p>' +
              '<p class="hint">That really does happen. <b>The catch is that almost nobody knows in advance which change is the right one, ' +
              'including the people who got it right last time.</b> Run it again and count how often it works.</p></div>')
          : '<div class="card ok"><h3>You set it and left it alone</h3>' +
            '<p class="sub">Same plan for all 40 years, through every drop. That is the hardest thing on this screen and it is the one that mattered most.</p></div>') +

        '<div class="card"><h3>Against a plain index mix</h3>' +
          '<p class="sub">A boring 80% stocks and 20% bonds, never touched, same stretch and same monthly amount, finished at <b>' + moneyFull(base.final) + '</b>. ' +
          'You finished at <b>' + moneyFull(run.final) + '</b>.</p>' +
          '<p class="hint">' + (run.final >= base.final
            ? "You beat it. Worth asking how much more of a ride you took to get there."
            : "It beat you. That happens to most people most of the time, and it is not because they are dumb.") + '</p></div>' +

        '<div class="card"><h3>Every other 40 years you could have got</h3>' +
          '<p class="sub">Your starting mix, held without touching it, run through all <b>' + sorted.length + '</b> different 40 year stretches in this data. ' +
          'Yours came out at the <b>' + ordinal(pctile) + ' percentile</b>.</p>' +
          '<div class="range">' +
            '<div class="range-row"><span>Worst stretch</span><b>' + money(sorted[0]) + '</b></div>' +
            '<div class="range-row"><span>Middle</span><b>' + money(sorted[Math.floor(sorted.length / 2)]) + '</b></div>' +
            '<div class="range-row"><span>Best stretch</span><b>' + money(sorted[sorted.length - 1]) + '</b></div>' +
          '</div>' +
          '<div class="callout ' + (anyLost === 0 ? "ok" : "warn") + '">' +
            (anyLost === 0
              ? "<b>Not one of those " + sorted.length + " stretches finished below what was put in.</b> Some were far better than others. None of them lost. The stretch you get changes the ride, not the destination."
              : "<b>" + anyLost + " of those " + sorted.length + " stretches finished below what was put in.</b> Worth asking which part of your mix does that.") +
          '</div></div>' +

        '<div class="card center"><h3>Run it again</h3>' +
          '<p class="sub">Change one thing. A different mix, a different amount, a different call at the check-in. Watch what actually moves the number.</p>' +
          '<button class="btn" id="again">Play again</button>' +
          '<a class="btn dark" href="https://calendar.app.google/SQV7d9eK7hsu2rLm8" target="_blank" rel="noopener">Book a free 1-on-1</a></div>' +

        '<div class="card privacy"><h4>Where this lives</h4>' +
          '<p class="sub">Nothing you did here was sent anywhere. It is in this browser, on this device only. <b>AGP never sees it.</b></p>' +
          '<button class="btn ghost danger" id="wipe">Clear my data from this device</button>' +
          '<p class="hint">On a borrowed or shared device? Tap this before you hand it back.</p></div>' +
      '</div>'
    ));
    document.getElementById("again").onclick = function () {
      /* back to the very start, so the amounts can change too, not just the mix */
      state.screen = "welcome"; state.cursorM = 0; state.outs = []; state.dipsUsed = 0;
      state.startYear = null; state.draft = null;
      state.plans = [state.plans[0]]; save(); render();
    };
    document.getElementById("wipe").onclick = function () {
      if (confirm("Erase this run from the device? Screenshot it first if you want to keep it.")) reset(true);
    };
  }

  /* ---------------- chart ---------------- */
  function chartSvg(hist, upTo) {
    var W = 640, H = 220, PADL = 6, PADB = 18, PADT = 8;
    var pts = hist.slice(0, upTo), max = 0;
    pts.forEach(function (p) { max = Math.max(max, p.total, p.contributed); });
    if (max <= 0) max = 1;
    function x(i) { return PADL + (i / Math.max(1, MONTHS - 1)) * (W - PADL * 2); }
    function y(v) { return PADT + (1 - v / max) * (H - PADT - PADB); }
    var step = Math.max(1, Math.floor(pts.length / 240));
    var thin = pts.filter(function (p, i) { return i % step === 0 || i === pts.length - 1; });
    function xi(p) { return x(p.m); }
    var line = thin.map(function (p, i) { return (i ? "L" : "M") + xi(p).toFixed(1) + "," + y(p.total).toFixed(1); }).join(" ");
    var area = line + " L" + xi(thin[thin.length - 1]).toFixed(1) + "," + y(0).toFixed(1) + " L" + xi(thin[0]).toFixed(1) + "," + y(0).toFixed(1) + " Z";
    var cont = thin.map(function (p, i) { return (i ? "L" : "M") + xi(p).toFixed(1) + "," + y(p.contributed).toFixed(1); }).join(" ");
    var ticks = "";
    for (var d = 0; d < MONTHS; d += 120) {
      ticks += '<text class="tick" x="' + x(d).toFixed(1) + '" y="' + (H - 4) + '">Yr ' + (d / 12 + 1) + '</text>';
    }
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Value over time">' +
      '<path class="area" d="' + area + '"/><path class="cont" d="' + cont + '"/><path class="line" d="' + line + '"/>' + ticks + '</svg>' +
      '<div class="legend"><span><i class="sw line"></i>What it is worth</span><span><i class="sw cont"></i>What you put in</span></div>';
  }

  /* ---------------- boot ---------------- */
  applyBranding();
  state = load();
  render();
})();
