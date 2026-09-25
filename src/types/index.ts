export const USER_ROLES = [
  "SYSTEM_ADMIN",
  "INSTITUTION_ADMIN",
  "DOCTOR",
  "NURSE",
  "PHARMACIST",
  "LAB_TECHNICIAN",
  "PATIENT",
  "SCHOOL_ADMIN",
] as const;
export type UserRole = (typeof USER_ROLES)[number];
export interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}
export interface Institution {
  id: string;
  name: string;
  code: string;
  city: string | null;
  address: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}
export interface RoleAssignment {
  id: string;
  user_id: string;
  role: UserRole;
  institution_id: string | null;
}
export interface Membership {
  id: string;
  institution_id: string;
  user_id: string;
  active: boolean;
}
export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}
