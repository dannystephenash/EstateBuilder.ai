// EstateBuilder.ai · Landing — minimal client script.
// Just keeps the masthead date line current. Page load reveal is CSS.

(function () {
  var el = document.getElementById('dateLine');
  if (!el) return;
  var now = new Date();
  var month = now.toLocaleString('en-US', { month: 'long' });
  var year = now.getFullYear();
  // Season heuristic for the masthead — small detail, but adds to the
  // "newspaper edition" feel of the top strip.
  var m = now.getMonth();
  var season = m >= 2 && m <= 4 ? 'Spring'
             : m >= 5 && m <= 7 ? 'Summer'
             : m >= 8 && m <= 10 ? 'Autumn'
             : 'Winter';
  el.textContent = 'Toronto · ' + season + ' ' + year;
  el.setAttribute('title', month + ' ' + year);
})();
