/* NEON DRIFT — icons: inline SVG glyphs for every upgrade.
 *
 * All icons are drawn on a 24x24 viewBox with `currentColor`, so they inherit
 * the card's accent colour. Kept as path data rather than files so the game
 * still loads with zero requests.
 */
(function (ND) {
  'use strict';

  const PATHS = {
    // ---- core stats ----
    dmg: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
    rate: '<path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 7v5l3.5 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 3v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    multi: '<path d="M4 12h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 12 20 5M9 12l11 7M9 12h11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    speed: '<path d="M3 7h9M3 12h13M3 17h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="m14 8 4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    hp: '<path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 8v6M9 11h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    pierce: '<path d="M2 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="m12 7 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 4v16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 3"/>',
    crit: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    magnet: '<path d="M6 3v9a6 6 0 0 0 12 0V3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M6 8h5M13 8h5" fill="none" stroke="currentColor" stroke-width="2.4"/>',
    dash: '<path d="m4 6 6 6-6 6M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    regen: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v10M7 12h10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    lifesteal: '<path d="M12 2s6 7 6 12a6 6 0 0 1-12 0c0-5 6-12 6-12Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 11v5M9.5 13.5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    bspeed: '<path d="M3 8h11M3 16h11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="m15 8 4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 12h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".5"/>',

    // ---- weapon specific ----
    scatterPellets: '<circle cx="6" cy="12" r="1.8" fill="currentColor"/><circle cx="10" cy="7" r="1.8" fill="currentColor"/><circle cx="10" cy="17" r="1.8" fill="currentColor"/><circle cx="15" cy="4" r="1.6" fill="currentColor"/><circle cx="15" cy="12" r="1.6" fill="currentColor"/><circle cx="15" cy="20" r="1.6" fill="currentColor"/>',
    railLance: '<path d="M2 12h18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M16 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="12" r="2.2" fill="currentColor"/>',
    railCharge: '<rect x="3" y="8" width="14" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19 10v4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M6 10v4M9 10v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    pulseFlak: '<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    ram: '<path d="M3 18h18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 18 12 5l7 13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M9 18h6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
  };

  // Fallback so an unknown id never renders an empty box.
  const FALLBACK = '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/>';

  ND.iconSvg = function (id, size) {
    const s = size || 24;
    const body = PATHS[id] || FALLBACK;
    return (
      '<svg class="icon" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" ' +
      'fill="none" aria-hidden="true" focusable="false">' + body + '</svg>'
    );
  };

  ND.hasIcon = function (id) {
    return Object.prototype.hasOwnProperty.call(PATHS, id);
  };
})(window.ND);
