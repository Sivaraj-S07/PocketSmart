/* PocketSmart AI - small frontend helpers (no backend changes).
   If the username is not in localStorage (new browser/device, cleared site data),
   read it from the existing /api/me endpoint so the nav chip and greeting stay correct. */
(function () {
  var chip = document.getElementById('userChip');
  if (!chip) return;
  var stored = null;
  try { stored = localStorage.getItem('username'); } catch (e) {}
  if (stored) return;
  fetch('/api/me', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (me) {
      if (!me || !me.username) return;
      try { localStorage.setItem('username', me.username); } catch (e) {}
      chip.textContent = '\uD83D\uDC64 ' + me.username;
      var hero = document.getElementById('heroUser');
      if (hero) hero.textContent = me.full_name || me.username;
    })
    .catch(function () {});
})();
