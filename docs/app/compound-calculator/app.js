/* AGP Compound Interest Calculator - modeled on the NerdWallet calculator.
   Self-contained, phone-first, ?school= branding. No em dashes. */
(function () {
  "use strict";

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

  var COMPOUND_M = { daily: 365, monthly: 12, semiannually: 2, annually: 1 };
  var state = { start: 1000, contribution: 100, contribFreq: "monthly", years: 20, rate: 7, compound: "monthly" };
  var ui = { rateOpen: false, retireOpen: false };
  var PRESETS = [
    { label: "$50/mo, 40 yrs, 10%", start: 0, contribution: 50, contribFreq: "monthly", years: 40, rate: 10, compound: "monthly" },
    { label: "$200/mo, 30 yrs, 8%", start: 0, contribution: 200, contribFreq: "monthly", years: 30, rate: 8, compound: "monthly" },
    { label: "$500/mo, 25 yrs, 7%", start: 0, contribution: 500, contribFreq: "monthly", years: 25, rate: 7, compound: "monthly" }
  ];

  function num(v) { var n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; }
  function money(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function el(h) { var d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstChild; }

  // Simulate month by month. Effective monthly growth reflects the compound frequency.
  function simulate() {
    var years = Math.max(1, Math.min(60, Math.round(state.years) || 1));
    var annual = (state.rate || 0) / 100;
    var m = COMPOUND_M[state.compound] || 12;
    var g = Math.pow(1 + annual / m, m / 12); // effective monthly growth factor
    var months = years * 12;
    var monthlyContrib = state.contribFreq === "monthly";
    var bal = state.start, contributed = state.start, yearly = [];
    for (var mo = 1; mo <= months; mo++) {
      bal *= g;
      if (monthlyContrib) { bal += state.contribution; contributed += state.contribution; }
      else if (mo % 12 === 0) { bal += state.contribution; contributed += state.contribution; }
      if (mo % 12 === 0) yearly.push({ y: mo / 12, bal: bal, contributed: contributed });
    }
    return {
      years: years, fv: bal, initial: state.start,
      contributions: contributed - state.start, interest: Math.max(0, bal - contributed),
      contributed: contributed, yearly: yearly
    };
  }

  var app = document.getElementById("app");
  function render() {
    app.innerHTML = "";
    app.appendChild(el(
      '<div class="screen">' +
        '<div class="card">' +
          '<span class="step-tag">See it grow</span>' +
          '<h1 class="title">Compound Interest Calculator</h1>' +
          '<p class="lede">Small amounts, invested and left alone, become big amounts. Change the numbers and watch.</p>' +
          moneyField("start", "Initial deposit", state.start) +
          moneyField("contribution", "Contribution amount", state.contribution) +
          selectField("contribFreq", "Contribute every", state.contribFreq, [["monthly", "Month"], ["annually", "Year"]]) +
          plainField("years", "Years to grow", state.years) +
          '<label class="fld" for="in_rate">Estimated interest rate <span class="info-ic" id="rateInfo" title="What rate should I use?">i</span></label>' +
          '<div class="ibox suf"><input type="number" inputmode="decimal" id="in_rate" value="' + state.rate + '"><span class="isym post">%</span></div>' +
          '<div class="infopanel' + (ui.rateOpen ? " open" : "") + '" id="ratePanel">Over the past 100 years or so, the U.S. stock market has averaged about <b>10%</b> a year. Inflation (things getting more expensive) runs about <b>2% to 3%</b> a year. So people often use <b>10%</b> to show raw growth, or about <b>7%</b> to account for inflation, which is closer to what your money is really worth down the road.</div>' +
          selectField("compound", "Compound frequency", state.compound, [["daily", "Daily"], ["monthly", "Monthly"], ["semiannually", "Semiannually"], ["annually", "Annually"]]) +
          '<div class="presets" id="presets"></div>' +
        '</div>' +
        '<div class="sum-hero">' +
          '<span class="cap" id="capTop"></span>' +
          '<div class="big" id="fv"></div>' +
          '<span class="cap" id="capSub"></span>' +
        '</div>' +
        '<div class="card">' +
          '<div class="splitbar" id="splitbar"></div>' +
          '<div class="brk">' +
            '<div class="brk-row"><span><i class="sw initial"></i>Initial deposit</span><b id="bkInit"></b></div>' +
            '<div class="brk-row"><span><i class="sw contrib"></i>Total contributions</span><b id="bkContrib"></b></div>' +
            '<div class="brk-row"><span><i class="sw earned"></i>Total interest</span><b id="bkInt"></b></div>' +
          '</div>' +
          '<div class="chartwrap"><div class="chart" id="chart"></div></div>' +
          '<div class="chart-x"><span>Year 1</span><span id="chartEnd"></span></div>' +
        '</div>' +
        '<div class="expander">' +
          '<button class="exp-btn" id="retireBtn">What about retirement? The 4% rule <span class="caret" id="retireCaret">' + (ui.retireOpen ? "&#8722;" : "+") + '</span></button>' +
          '<div class="retire-panel' + (ui.retireOpen ? " open" : "") + '" id="retirePanel"></div>' +
        '</div>' +
        '<p class="disclaimer" style="text-align:left">An illustration only. It assumes a steady return that never changes, which real markets do not. Returns are not guaranteed.</p>' +
      '</div>'
    ));
    var pres = document.getElementById("presets");
    PRESETS.forEach(function (p, i) {
      var b = el('<button class="pchip" data-p="' + i + '">' + p.label + '</button>');
      b.onclick = function () { Object.assign(state, p); render(); };
      pres.appendChild(b);
    });
    ["start", "contribution", "years", "rate"].forEach(function (k) {
      document.getElementById("in_" + k).addEventListener("input", function () { state[k] = num(this.value); update(); });
    });
    ["contribFreq", "compound"].forEach(function (k) {
      document.getElementById("in_" + k).addEventListener("change", function () { state[k] = this.value; update(); });
    });
    document.getElementById("rateInfo").onclick = function () {
      ui.rateOpen = !ui.rateOpen;
      document.getElementById("ratePanel").classList.toggle("open", ui.rateOpen);
    };
    document.getElementById("retireBtn").onclick = function () {
      ui.retireOpen = !ui.retireOpen;
      document.getElementById("retirePanel").classList.toggle("open", ui.retireOpen);
      document.getElementById("retireCaret").innerHTML = ui.retireOpen ? "&#8722;" : "+";
      update();
    };
    update();
  }

  function retireHtml(nest) {
    var annual = nest * 0.04, monthly = annual / 12, rate = (state.rate || 0) / 100;
    var bal = nest, runOut = 0, YEARS = 30;
    for (var y = 1; y <= YEARS; y++) { bal = bal * (1 + rate) - annual; if (bal <= 0) { runOut = y; bal = 0; break; } }
    var tail = runOut
      ? "Growing at " + (state.rate || 0) + "% while you withdraw 4%, your money would run out around <b>year " + runOut + "</b> of retirement (about age " + (65 + runOut) + ")."
      : "Growing at " + (state.rate || 0) + "% while you withdraw 4%, after a 30-year retirement (about age 65 to 95) you would still have about <b>" + money(bal) + "</b> left.";
    return "In retirement, a common guideline is to withdraw about <b>4%</b> a year. On this nest egg that is:" +
      '<div class="rbig">' + money(annual) + " / year  <span>(" + money(monthly) + " / month)</span></div>" +
      tail + '<div class="hint" style="margin-top:8px">Simplified: this does not adjust your withdrawals for inflation.</div>';
  }

  function moneyField(key, label, val) {
    return '<label class="fld" for="in_' + key + '">' + label + '</label>' +
      '<div class="ibox pre"><span class="isym">$</span><input type="number" inputmode="decimal" id="in_' + key + '" value="' + val + '"></div>';
  }
  function pctField(key, label, val) {
    return '<label class="fld" for="in_' + key + '">' + label + '</label>' +
      '<div class="ibox suf"><input type="number" inputmode="decimal" id="in_' + key + '" value="' + val + '"><span class="isym post">%</span></div>';
  }
  function plainField(key, label, val) {
    return '<label class="fld" for="in_' + key + '">' + label + '</label>' +
      '<div class="ibox"><input type="number" inputmode="decimal" id="in_' + key + '" value="' + val + '"></div>';
  }
  function selectField(key, label, val, opts) {
    var o = opts.map(function (p) { return '<option value="' + p[0] + '"' + (val === p[0] ? " selected" : "") + '>' + p[1] + '</option>'; }).join("");
    return '<label class="fld" for="in_' + key + '">' + label + '</label>' +
      '<select class="freq" id="in_' + key + '" style="width:100%;max-width:100%">' + o + '</select>';
  }

  function update() {
    var r = simulate();
    document.getElementById("capTop").textContent = "In " + r.years + " years, you would have";
    document.getElementById("fv").textContent = money(r.fv);
    document.getElementById("capSub").textContent = "at " + (state.rate || 0) + "% compounded " + state.compound;
    document.getElementById("bkInit").textContent = money(r.initial);
    document.getElementById("bkContrib").textContent = money(r.contributions);
    document.getElementById("bkInt").textContent = money(r.interest);
    var fv = r.fv || 1;
    var wi = (r.initial / fv) * 100, wc = (r.contributions / fv) * 100, we = (r.interest / fv) * 100;
    document.getElementById("splitbar").innerHTML =
      '<span class="seg initial" style="width:' + wi + '%"></span>' +
      '<span class="seg contrib" style="width:' + wc + '%"></span>' +
      '<span class="seg earned" style="width:' + we + '%"></span>';
    var maxBal = r.fv || 1, bars = "";
    r.yearly.forEach(function (pt) {
      var c = Math.min(pt.contributed, pt.bal), h = (pt.bal / maxBal) * 100;
      var cShare = pt.bal > 0 ? (c / pt.bal) * 100 : 100;
      bars += '<div class="bar" style="height:' + h + '%" title="Year ' + pt.y + ': ' + money(pt.bal) + '">' +
        '<span class="bseg earned" style="height:' + (100 - cShare) + '%"></span>' +
        '<span class="bseg contrib" style="height:' + cShare + '%"></span></div>';
    });
    document.getElementById("chart").innerHTML = bars;
    document.getElementById("chartEnd").textContent = "Year " + r.years;
    var rp = document.getElementById("retirePanel");
    if (rp) rp.innerHTML = retireHtml(r.fv);
  }

  applyBranding();
  render();
})();
