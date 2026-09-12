/* Shared US program-area map.
 *
 * One component, one stylesheet; each aircraft's cities and service-area model
 * live in data/aircraft/<id>.json — the SAME file that feeds the calculator.
 *
 * serviceArea.model:
 *   "radius" — a hover/tap circle of serviceArea.miles around each city.
 *   "split"  — NO circles. The aircraft has no fixed base: it stays where the
 *              last owner left it and repositions to the next. Drawing a radius
 *              would assert a service area that does not exist. Instead a dashed
 *              meridian at serviceArea.dividerLongitude marks the program halves.
 */
function initFlightMap(root, spec) {
  var mapEl = root.querySelector('.us-flight-map') || root.querySelector('#us-flight-map') || root;
  /* Always assign a unique id: the original block hard-coded id="us-flight-map",
     so two maps on one page would both bind to the first div. */
  mapEl.id = 'us-flight-map-' + spec.id;

  var cfg = (spec.map && spec.map.serviceArea) || {};
  var cities = (spec.map && spec.map.cities) || [];
  var cssVar = function (n) {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  };

  var map = L.map(mapEl.id, { zoomControl: false, scrollWheelZoom: false, attributionControl: false });
  L.control.zoom({ position: 'topright' }).addTo(map);
  map.doubleClickZoom.disable();

  ['nation', 'states', 'circles', 'labels'].forEach(function (n, i) {
    map.createPane('pane-' + n);
    map.getPane('pane-' + n).style.zIndex = [400, 410, 420, 650][i];
  });

  var cityGroup = L.featureGroup().addTo(map);
  var activeCircle = null;
  function showExclusive(c) {
    if (activeCircle && map.hasLayer(activeCircle) && activeCircle !== c) map.removeLayer(activeCircle);
    if (!map.hasLayer(c)) c.addTo(map);
    activeCircle = c;
  }

  var useRadius = cfg.model === 'radius' && cfg.miles > 0;
  var radiusMeters = useRadius ? cfg.miles * 1609.344 : 0;
  var isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  cities.forEach(function (city) {
    var dot = L.marker([city.lat, city.lng], {
      icon: L.divIcon({ className: 'city-dot' }), pane: 'markerPane'
    }).addTo(cityGroup);

    var label = city.name;
    if (useRadius) label += '<br>' + cfg.miles + ' mile radius (~1 hr)';
    else if (cfg.dividerLongitude != null)
      label += '<br>' + (city.lng < cfg.dividerLongitude ? 'Western' : 'Eastern') + ' program half';
    dot.bindTooltip(label, { direction: 'top', offset: [0, -10], className: 'leaflet-tooltip city-label' });

    if (!useRadius) { if (isTouch) dot.on('click', function () { dot.openTooltip(); }); return; }

    var circle = L.circle([city.lat, city.lng], {
      radius: radiusMeters, color: cssVar('--accent'), weight: 2,
      fillColor: cssVar('--fill'), fillOpacity: 1, pane: 'pane-circles'
    });
    var toggle = function (e) {
      if (e && e.originalEvent) { e.originalEvent.preventDefault(); e.originalEvent.stopPropagation(); }
      if (activeCircle === circle) { map.removeLayer(circle); activeCircle = null; }
      else { showExclusive(circle); dot.openTooltip(); }
    };
    if (!isTouch) {
      dot.on('mouseover', function () { circle.addTo(map); });
      dot.on('mouseout', function () { if (activeCircle !== circle) map.removeLayer(circle); });
      dot.on('click', toggle);
    } else { dot.on('touchstart', toggle); dot.on('click', toggle); }
  });

  /* Dashed meridian marking the program halves. Drawn well beyond the border
     at both ends so it reads as a divider, not a feature of the geography. */
  if (cfg.model === 'split' && cfg.dividerLongitude != null) {
    L.polyline([[15, cfg.dividerLongitude], [60, cfg.dividerLongitude]], {
      color: cssVar('--accent') || '#e8820c',
      weight: 2, opacity: 0.85, dashArray: '8 8', pane: 'pane-circles', interactive: false
    }).addTo(map);
  }

  ['nation', 'states'].forEach(function (kind) {
    fetch('https://unpkg.com/us-atlas@3/' + kind + '-10m.json')
      .then(function (r) { return r.json(); })
      .then(function (topo) {
        L.geoJSON(topojson.feature(topo, topo.objects[kind]), {
          pane: 'pane-' + kind,
          style: { color: cssVar('--border'), weight: kind === 'nation' ? 1.6 : 1,
                   opacity: kind === 'nation' ? 0.9 : 0.8, fillOpacity: 0 }
        }).addTo(map);
      })
      .catch(function (e) { console.warn('[bopaero:flight-map] ' + kind + ' borders failed', e.message); });
  });

  var legend = L.control({ position: 'bottomleft' });
  legend.onAdd = function () {
    var div = L.DomUtil.create('div', 'ba-legend');
    var swatch = useRadius ? '<span class="ba-swatch"></span>' : '';
    var hint = cfg.legendNote || (useRadius
      ? 'Hover (desktop) or tap (mobile) a city to show its range.'
      : 'Dashed line divides the Western and Eastern program halves.');
    div.innerHTML =
      '<div class="ba-legend-row">' + swatch +
      '<span><strong>' + (cfg.legendTitle || 'Program Area') + ':</strong> ' +
      (cfg.legendText || '') + '</span></div>' +
      '<div class="ba-note">' + hint + '</div>';
    L.DomEvent.disableClickPropagation(div);
    return div;
  };
  legend.addTo(map);

  /* A coast-to-coast program must SHOW both coasts. Fitting to city bounds
     cropped the Pacific coast off the SF50 map, because its westernmost city is
     Denver — which made a bi-coastal map argue against itself. */
  var bounds = cfg.fitBounds
    ? L.latLngBounds(cfg.fitBounds[0], cfg.fitBounds[1])
    : cityGroup.getBounds();
  function refit() {
    var small = window.matchMedia('(max-width: 640px)').matches;
    var size = map.getSize();
    map.fitBounds(bounds, { paddingTopLeft: [small ? Math.round(Math.min(220, size.x * 0.26)) : 40, 20],
                            paddingBottomRight: [40, 40] });
  }
  refit();
  var t; window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(refit, 150); });
}
