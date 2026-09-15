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
  /* Read tokens from the COMPONENT's own root, not from :root.
     REGRESSION 2026-09-15: tokens moved from :root onto .bop-embed during the
     re-skin, and this still queried document.documentElement - so every lookup
     returned '' and Leaflet fell back to SVG defaults: black fill, no stroke. The
     coastlines went invisible on the navy background on BOTH breakpoints, while
     the dots (styled by CSS class) and the divider (which had a hard-coded
     fallback) kept drawing, so the map looked half-alive rather than broken.
     Every call now carries a fallback too: no token lookup should ever be the
     difference between a drawn map and an invisible one. */
  var cssVar = function (n, fallback) {
    var scope = (mapEl.closest && mapEl.closest('.bop-embed')) || mapEl;
    var v = getComputedStyle(scope).getPropertyValue(n).trim();
    if (!v) v = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return v || fallback || '';
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
      radius: radiusMeters, color: cssVar('--accent', '#FF6700'), weight: 2,
      fillColor: cssVar('--fill', 'rgba(255,103,0,0.14)'), fillOpacity: 1, pane: 'pane-circles'
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
      color: cssVar('--accent', '#FF6700'),
      weight: 2, opacity: 0.85, dashArray: '8 8', pane: 'pane-circles', interactive: false
    }).addTo(map);
  }

  /* Raymond 2026-09-15: show the CONTIGUOUS US only - no Alaska, Hawaii or
     territories. Filtering the geometry rather than framing them out of shot means
     they cannot reappear at any zoom or container shape, which is what went wrong
     on a phone: the bounds were right, but a portrait box zoomed out far enough to
     bring Alaska into view and left the contiguous states a thin strip.
     FIPS excluded: 02 AK, 15 HI, 60 American Samoa, 66 Guam, 69 N. Mariana Is.,
     72 Puerto Rico, 78 US Virgin Islands. The nation outline is one multipolygon
     covering all of it, so drop its rings by position instead of by id. */
  var OFFSHORE_FIPS = { '02': 1, '15': 1, '60': 1, '66': 1, '69': 1, '72': 1, '78': 1 };
  var CONUS = { west: -125.5, east: -66.0, south: 23.5, north: 49.8 };

  function ringIsContiguous(ring) {
    for (var i = 0; i < ring.length; i++) {
      var lng = ring[i][0], lat = ring[i][1];
      if (lng >= CONUS.west && lng <= CONUS.east && lat >= CONUS.south && lat <= CONUS.north) return true;
    }
    return false;
  }

  function contiguousOnly(fc) {
    var out = [];
    (fc.features || []).forEach(function (f) {
      if (f.id != null && OFFSHORE_FIPS[String(f.id).padStart(2, '0')]) return;
      var g = f.geometry;
      if (g && g.type === 'MultiPolygon') {
        var kept = g.coordinates.filter(function (poly) { return ringIsContiguous(poly[0]); });
        if (!kept.length) return;
        f = { type: 'Feature', id: f.id, properties: f.properties,
              geometry: { type: 'MultiPolygon', coordinates: kept } };
      } else if (g && g.type === 'Polygon') {
        if (!ringIsContiguous(g.coordinates[0])) return;
      }
      out.push(f);
    });
    return { type: 'FeatureCollection', features: out };
  }

  ['nation', 'states'].forEach(function (kind) {
    fetch('https://unpkg.com/us-atlas@3/' + kind + '-10m.json')
      .then(function (r) { return r.json(); })
      .then(function (topo) {
        L.geoJSON(contiguousOnly(topojson.feature(topo, topo.objects[kind])), {
          pane: 'pane-' + kind,
          style: { color: cssVar('--border', '#fff'), weight: kind === 'nation' ? 1.6 : 1,
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
    /* The left inset keeps the westernmost cities clear of the legend. On a phone
       26% of the width was reserving ~89px of a 343px map, which forced the zoom
       down far enough to bring Alaska into frame. Cap it in proportion to how much
       room there actually is. */
    var insetLeft = small ? Math.round(Math.min(48, size.x * 0.06)) : 40;
    map.fitBounds(bounds, { paddingTopLeft: [insetLeft, small ? 12 : 20],
                            paddingBottomRight: [small ? 12 : 40, small ? 56 : 40] });
  }
  refit();
  var t; window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(refit, 150); });
}
