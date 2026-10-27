export const icons = {
  phone:
    '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7A2 2 0 0 1 22 16.9Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  home: '<path d="m3 10 9-7 9 7v10H5V10"/><path d="M9 20v-7h6v7"/>',
  people:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6m2 10v-3a6 6 0 0 0-3-5"/>',
  rooms: '<path d="M4 4h16v12H9l-5 4V4Z"/>',
  mission:
    '<path d="m12 3 8 4v5c0 5-4 8-8 10-4-2-8-5-8-10V7l8-4Z"/><path d="m8 12 3 3 5-6"/>',
  field: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/>',
  calendar:
    '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16"/>',
  governance: '<path d="m3 8 9-5 9 5H3Zm2 3v7m7-7v7m7-7v7M3 21h18"/>',
  texting:
    '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="m8 18-4 3v-3M7 8h10M7 12h6"/>',
  petition: '<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"/>',
  amplify: '<path d="M4 11h5l10-6v14L9 13H4v-2Zm4 3 2 7h3l-2-6"/>',
  ballot: '<path d="M6 3h12v18H6zM9 7h6m-6 4h6m-6 4h4"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/>',
  settings:
    '<path d="m10 3-1 3-3 1-3-1-1 4 3 2v3l-2 2 3 3 3-1 3 1 1 2 4-1v-3l2-2 3-1-1-4-3-1-2-2V3h-6Z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0v7l3 3H3l3-3V9Zm3 12h6"/>',
  chevronDown: '<path d="m8 10 4 4 4-4"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  minus: '<path d="M4 12h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-2 8m2-14v6h-6"/>',
  locate:
    '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  pin: '<path d="M19 10c0 5-7 12-7 12S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.field}</svg>`;
