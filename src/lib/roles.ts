import type { UserRole } from "../types";
export const portals: {
  role: UserRole;
  path: string;
  title: string;
  description: string;
}[] = [
  {
    role: "SYSTEM_ADMIN",
    path: "/central",
    title: "e-Zdravstvo Central",
    description: "Administracija ekosustava",
  },
  {
    role: "DOCTOR",
    path: "/ordinacija",
    title: "e-Zdravstvo Ordinacija",
    description: "Vaša ordinacija na jednom mjestu",
  },
  {
    role: "NURSE",
    path: "/ordinacija",
    title: "e-Zdravstvo Ordinacija",
    description: "Podrška svakodnevnoj skrbi",
  },
  {
    role: "INSTITUTION_ADMIN",
    path: "/ustanove",
    title: "e-Zdravstvo Ustanove",
    description: "Organizacija vaše ustanove",
  },
  {
    role: "PHARMACIST",
    path: "/ljekarna",
    title: "e-Zdravstvo Ljekarna",
    description: "Portal ljekarne",
  },
  {
    role: "LAB_TECHNICIAN",
    path: "/laboratorij",
    title: "e-Zdravstvo Laboratorij",
    description: "Portal laboratorija",
  },
  {
    role: "PATIENT",
    path: "/moje",
    title: "Moje e-Zdravstvo",
    description: "Vaše zdravlje, na jednom mjestu",
  },
  {
    role: "SCHOOL_ADMIN",
    path: "/skola",
    title: "e-Zdravstvo Škole",
    description: "Portal za provjeru ispričnica",
  },
];
export const roleLabels: Record<UserRole, string> = {
  SYSTEM_ADMIN: "Administrator sustava",
  INSTITUTION_ADMIN: "Administrator ustanove",
  DOCTOR: "Liječnik",
  NURSE: "Medicinska sestra / tehničar",
  PHARMACIST: "Ljekarnik",
  LAB_TECHNICIAN: "Laboratorijski tehničar",
  PATIENT: "Pacijent",
  SCHOOL_ADMIN: "Administrator škole",
};
export function homeFor(roles: UserRole[]) {
  return portals.find((p) => roles.includes(p.role))?.path ?? "/bez-pristupa";
}
export function canAccess(path: string, roles: UserRole[]) {
  return portals.some((p) => p.path === path && roles.includes(p.role));
}
