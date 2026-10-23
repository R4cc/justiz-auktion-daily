// Shared store illustrations and product icons.
window.townArtwork = (() => {
  const paths = {
    wine:'<path d="M8 3h4v5l2 3v10H6V11l2-3V3Z"/><path d="M6 14h8M17 4h5v5a2.5 2.5 0 0 1-5 0V4ZM19.5 12v8m-2.5 0h5"/>',
    toys:'<circle cx="7" cy="5" r="3"/><circle cx="17" cy="5" r="3"/><circle cx="12" cy="10" r="6"/><path d="M8 15c-5 1-5 7-1 7l2-2m7-5c5 1 5 7 1 7l-2-2M9 16v4h6v-4"/><path d="M9 9h.01M15 9h.01m-4 3h2"/>',
    electronics:'<rect x="3" y="3" width="18" height="14" rx="2"/><path d="M1 21h22l-2-4H3l-2 4Zm8-13 3 2-3 2m5 0h3"/>',
    cars:'<path d="m4 10 2-6h12l2 6M3 11l1-1h16l1 1v8H3v-8Zm2 8v2m14-2v2M4 10h16M6 14h2m8 0h2"/>',
    jeweler:'<path d="m3 8 4-5h10l4 5-9 13L3 8Zm0 0h18M7 3l5 18 5-18M8 8l4-5 4 5"/>',
    hardware:'<path d="m3 21 11-11a6 6 0 0 0 7-7l-4 4-3-3 4-4a6 6 0 0 0-7 7L0 18l3 3Z"/><path d="m15 14 6 6m-3-9 4 4m-6-2 3-3"/>',
    pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    bag:'<path d="M4 7h16l1 14H3L4 7Z"/><path d="M8 7V5a4 4 0 0 1 8 0v2"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    person:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>'
  };
  function icon(type) {
    return `<svg class="town-product-icon" data-product-icon="${paths[type]?type:'plus'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[type]||paths.plus}</svg>`;
  }
  function storefront() {
    return '<svg class="town-store-building" viewBox="0 0 90 62" aria-hidden="true"><ellipse cx="45" cy="57" rx="36" ry="4" fill="#183e3616"/><path d="M12 15 21 5h48l9 10" fill="var(--shop-roof)" stroke="#183e3660"/><rect x="16" y="16" width="58" height="39" rx="2" fill="#faf7ec" stroke="#183e3660"/><path d="M13 15h64l4 13H9Z" fill="var(--shop-color)"/><path d="m22 15-3 13m16-13-1 13m15-13 1 13m13-13 3 13" stroke="#fffdf7" stroke-width="7"/><path d="M9 28h72" stroke="#183e3640"/><rect x="21" y="32" width="30" height="18" rx="1" fill="#cee2dd" stroke="#183e3640"/><path d="m24 45 11-10m-3 13 12-12" stroke="#fffdf780" stroke-width="2"/><rect x="57" y="31" width="12" height="24" rx="1" fill="#abc6bd" stroke="#183e3660"/><path d="M65 43v3M14 55h62" stroke="#183e3660"/></svg>';
  }
  return {icon,storefront};
})();
