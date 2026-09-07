// The app's top-level sections as breadcrumb nodes, so a section's label and
// route are spelled once and every trail that passes through it agrees.

export type CrumbLink = { label: string; href: string };

export const HOME_CRUMB: CrumbLink = { label: "Home", href: "/" };
export const MY_TICKETS_CRUMB: CrumbLink = { label: "My tickets", href: "/tickets" };
export const NOTES_CRUMB: CrumbLink = { label: "Notes", href: "/notes" };
export const ADMIN_CRUMB: CrumbLink = { label: "Admin", href: "/admin" };
