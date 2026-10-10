/* AGP live session: "Back to the session" bar for the standalone apps.
   Shows ONLY when the app was opened from the session page (?from=session),
   so the apps look unchanged when used on their own. No backend. */
(function () {
  "use strict";
  var q = new URLSearchParams(window.location.search);
  if (q.get("from") !== "session") return;
  var keep = new URLSearchParams();
  ["school", "team"].forEach(function (k) { if (q.get(k)) keep.set(k, q.get(k)); });
  var href = "/app/session/" + (keep.toString() ? "?" + keep.toString() : "");
  function add() {
    var bar = document.createElement("a");
    bar.href = href;
    bar.textContent = "← Back to the session";
    bar.setAttribute("style",
      "position:fixed;left:0;right:0;bottom:0;z-index:1000;display:block;text-align:center;" +
      "padding:14px 16px calc(14px + env(safe-area-inset-bottom));font:700 15px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;" +
      "background:var(--primary,#10243F);color:#fff;text-decoration:none;box-shadow:0 -2px 10px rgba(0,0,0,.15)");
    document.body.appendChild(bar);
    document.body.style.paddingBottom = "60px";
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add();
})();
