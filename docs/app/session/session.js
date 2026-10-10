/* AGP live-session pages: shared branding + on-device storage helpers.
   No backend. Nothing entered here leaves the device. No em dashes in user-facing copy. */
(function (w) {
  "use strict";
  var SCHOOLS = {
    agp:     { name: "",                 primary: "#10243F", accent: "#1FB57A" },
    ecu:     { name: "East Carolina",    primary: "#592C82", accent: "#FDC82F" },
    ccu:     { name: "Coastal Carolina", primary: "#006F71", accent: "#A27752" },
    gonzaga: { name: "Gonzaga",          primary: "#041E42", accent: "#C8102E" },
    shsu:    { name: "Sam Houston",      primary: "#F56423", accent: "#10243F" }
  };
  var TEAMS = { wglf: "Women's Golf" };
  var q = new URLSearchParams(w.location.search);
  var key = (q.get("school") || "agp").toLowerCase();
  var cfg = SCHOOLS[key] || SCHOOLS.agp;
  var team = TEAMS[(q.get("team") || "").toLowerCase()] || "";

  function brand() {
    var r = document.documentElement.style;
    r.setProperty("--primary", cfg.primary);
    r.setProperty("--accent", cfg.accent);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", cfg.primary);
    var sub = document.getElementById("brandSchool");
    if (sub && cfg.name) sub.textContent = cfg.name + " " + (team || "Athletics");
  }
  // Keep ?school= and ?team= on every internal link.
  function carry(url) {
    var keep = new URLSearchParams();
    if (q.get("school")) keep.set("school", q.get("school"));
    if (q.get("team")) keep.set("team", q.get("team"));
    var s = keep.toString();
    if (!s) return url;
    var hash = "", h = url.indexOf("#");
    if (h >= 0) { hash = url.slice(h); url = url.slice(0, h); }
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + s + hash;
  }
  function load(k) { try { return JSON.parse(localStorage.getItem(k)) || null; } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function clear(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var MOVES = [
    ["Build a five-bucket budget", "Taxes, Expenses, Saving, Investing, Fun. Know where every dollar goes before it arrives."],
    ["Start an emergency fund", "Begin with a small cushion, then grow it toward 3 to 6 months of living expenses."],
    ["Move savings to a high-yield savings account", "Same safety, much higher interest. Look for FDIC or NCUA insurance and no fees."],
    ["Pay yourself first, automatically", "Set a transfer to savings for the day money lands, so saving happens before spending."],
    ["Track your spending for 30 days", "Use your bank app or a budgeting app. Find your triggers and your lifestyle creep."],
    ["Cancel one subscription or skip one buy now, pay later", "Small leaks add up. Move what you save into Saving or Investing."],
    ["Open an investing account", "A Roth IRA if you have earned income, like a paycheck. Otherwise a regular brokerage account."],
    ["Invest automatically every month", "Even $25 to $100 a month into a broad index or target-date fund. Time does the heavy lifting."]
  ];

  w.AGPS = { brand: brand, carry: carry, load: load, save: save, clear: clear, school: key, team: team, cfg: cfg, MOVES: MOVES };
  document.addEventListener("DOMContentLoaded", brand);
})(window);
