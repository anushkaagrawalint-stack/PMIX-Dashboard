// Canonical tab list — single source of truth for both the dashboard nav
// (components/Dashboard.tsx) and the tab-permission admin UI
// (components/tabs/AdminPanel.tsx), so the two never drift apart.
// Client-safe: no DB imports here (see lib/tabPermissions.ts for that).
export const TAB_META = [
  { id: 'overview',   label: 'Overview',           icon: 'ti-layout-dashboard' },
  { id: 'itemmix',    label: 'Item Mix',            icon: 'ti-list' },
  { id: 'entreemix',  label: 'Entree Mix',          icon: 'ti-bowl' },
  { id: 'loccompare', label: 'Location Compare',    icon: 'ti-map-pin' },
  { id: 'chanmenu',   label: 'Channels',            icon: 'ti-chart-pie' },
  { id: 'byo',        label: 'BYO Breakdown',       icon: 'ti-salad' },
  { id: 'payment',    label: 'Payment Source',      icon: 'ti-credit-card' },
  { id: 'meoverall',  label: 'Menu Engineering',    icon: 'ti-layout-grid' },
  { id: 'pinksheets', label: 'Pink Sheets',         icon: 'ti-file-spreadsheet' },
  { id: 'bikky',      label: 'Customer Retention',  icon: 'ti-users' },
  { id: 'attachment', label: 'Analytics',           icon: 'ti-link' },
  { id: 'renames',    label: 'Renames Audit',       icon: 'ti-refresh' },
  { id: 'renamesdemo',label: 'Rename Demo',         icon: 'ti-flask' },
  { id: 'needs',      label: 'Needs Review',        icon: 'ti-alert-triangle' },
  { id: 'openitems',  label: 'Open Items',          icon: 'ti-package' },
  { id: 'admin',      label: 'Admin Panel',         icon: 'ti-settings' },
] as const;

export type TabId = typeof TAB_META[number]['id'];

// Tabs hidden from the 'user' role before this permission system existed
// (owner request 2026-07-04: BYO Breakdown + Pink Sheets are admin-only;
// Admin Panel was built admin/tester-only from the start). Attachment Rate
// (owner request 2026-07-14) launched tester-only and defaults hidden from
// user here too until admin/tester explicitly turns it on.
// Used once to seed analytics.tab_permissions so rollout changes nothing until
// a tester/admin explicitly edits a toggle — see lib/tabPermissions.ts.
export const DEFAULT_USER_HIDDEN: TabId[] = ['byo', 'pinksheets', 'admin', 'attachment', 'renamesdemo'];

// Tabs hidden from the 'admin' role by default — Attachment Rate launched
// tester-only (owner request 2026-07-14); Rename Demo (owner request
// 2026-07-17) is a tester-only exploratory view comparing a broader rename-
// detection definition against the real Renames Audit tab. Both stay off for
// admin until tester explicitly turns them on via the Admin Panel.
export const DEFAULT_ADMIN_HIDDEN: TabId[] = ['attachment', 'renamesdemo'];
