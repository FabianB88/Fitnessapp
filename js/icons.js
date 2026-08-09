// Lucide icons (ISC license, lucide.dev) inlined as SVG strings.
// One custom icon (barbell) drawn in the same 24px / stroke-2 style.

const wrap = (paths) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const icons = {
  barbell: wrap('<path d="M2 12h2"/><rect x="4" y="7" width="3" height="10" rx="1"/><rect x="17" y="7" width="3" height="10" rx="1"/><path d="M7 12h10"/><path d="M20 12h2"/>'),
  history: wrap('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'),
  trendingUp: wrap('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>'),
  settings: wrap('<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>'),
  check: wrap('<path d="M20 6 9 17l-5-5"/>'),
  x: wrap('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  chevronLeft: wrap('<path d="m15 18-6-6 6-6"/>'),
  timer: wrap('<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>'),
  plus: wrap('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  minus: wrap('<path d="M5 12h14"/>'),
  info: wrap('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  refresh: wrap('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  circleCheck: wrap('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  circleAlert: wrap('<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'),
  arrowUpRight: wrap('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>'),
  arrowDownRight: wrap('<path d="m7 7 10 10"/><path d="M17 7v10H7"/>'),
  download: wrap('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'),
  calendar: wrap('<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>'),
  arrowRight: wrap('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
};
