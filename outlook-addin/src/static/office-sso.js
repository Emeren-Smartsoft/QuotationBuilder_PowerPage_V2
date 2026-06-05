/*
 * office-sso.js — Office SSO bootstrap for the Quotation Builder add-in.
 *
 * Uses the identity of the already-signed-in Outlook/Entra user (no extra
 * login prompt) via Office.auth.getAccessToken(). The token is decoded locally
 * only to display the signed-in name/email and to expose it to the builder as
 * window.QT_SALESPERSON (e.g. to stamp "Prepared by" on a quotation).
 *
 * This is best-effort: if SSO is not yet configured/consented, the builders
 * still work fully — they just run without a known salesperson identity.
 */
(function () {
  "use strict";

  function decodeJwt(token) {
    try {
      var payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      var pad = payload.length % 4;
      if (pad) payload += new Array(5 - pad).join("=");
      return JSON.parse(decodeURIComponent(escape(atob(payload))));
    } catch (e) {
      return null;
    }
  }

  function showIdentity(name, email) {
    var el = document.getElementById("addin-identity");
    if (!el) return;
    el.textContent = "Signed in as " + (name || email || "your account");
    el.className = "addin-banner show";
  }

  function applyIdentity(claims) {
    if (!claims) return;
    var name = claims.name || claims.preferred_username || "";
    var email = claims.preferred_username || claims.upn || claims.email || "";
    // Expose to the builder logic (optional consumer).
    window.QT_SALESPERSON = { name: name, email: email };
    window.DQ_SALESPERSON = window.QT_SALESPERSON;
    showIdentity(name, email);
  }

  function trySso() {
    if (!window.Office || !Office.auth || !Office.auth.getAccessToken) return;
    Office.auth
      .getAccessToken({ allowSignInPrompt: true, allowConsentPrompt: true })
      .then(function (token) {
        applyIdentity(decodeJwt(token));
      })
      .catch(function (err) {
        // 13xxx error codes = consent/login needed or SSO not configured.
        if (window.console) console.warn("[ADDIN] SSO unavailable:", err && err.code, err && err.message);
      });
  }

  if (window.Office && Office.onReady) {
    Office.onReady(function () {
      trySso();
    });
  } else {
    window.addEventListener("DOMContentLoaded", trySso);
  }
})();
