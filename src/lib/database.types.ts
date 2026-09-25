import type {
  AuditLog,
  Institution,
  Membership,
  Profile,
  RoleAssignment,
  UserRole,
} from "../types";
type Table<T> = {
  Row: { [K in keyof T]: T[K] };
  Insert: { [K in keyof T]?: T[K] };
  Update: { [K in keyof T]?: T[K] };
  Relationships: [];
};
export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile>;
      user_roles: Table<RoleAssignment>;
      institutions: Table<Institution>;
      institution_users: Table<Membership>;
      audit_logs: Table<AuditLog>;
    };
    Views: Record<string, never>;
    Functions: {
      record_session_event: { Args: { event: string }; Returns: undefined };
    };
    Enums: { app_role: UserRole };
    CompositeTypes: Record<string, never>;
  };
};
