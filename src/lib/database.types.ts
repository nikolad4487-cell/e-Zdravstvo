import type {
  AuditLog,
  Institution,
  Membership,
  Profile,
  RoleAssignment,
  UserRole,
} from "../types";
import type { Notification } from "../types/documents";
type Table<T> = {
  Row: { [K in keyof T]: T[K] };
  Insert: { [K in keyof T]?: T[K] };
  Update: { [K in keyof T]?: T[K] };
  Relationships: [];
};
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json | undefined };
export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile>;
      user_roles: Table<RoleAssignment>;
      institutions: Table<Institution>;
      institution_users: Table<Membership>;
      audit_logs: Table<AuditLog>;
      notifications: Table<Notification>;
    };
    Views: Record<string, never>;
    Functions: {
      admin_configuration: { Args: Record<string, never>; Returns: Json };
      central_overview: { Args: Record<string, never>; Returns: Json };
      admin_users: {
        Args: { search_term: string; page_number: number };
        Returns: Json;
      };
      admin_grant_role: {
        Args: {
          target_user: string;
          requested: UserRole;
          target_institution: string | null;
        };
        Returns: undefined;
      };
      revoke_role: { Args: { assignment_id: string }; Returns: undefined };
      create_institution: {
        Args: {
          institution_name: string;
          institution_code: string;
          institution_city: string;
        };
        Returns: string;
      };
      save_clinic: {
        Args: { institution_id: string; clinic_id: string | null; data: Json };
        Returns: string;
      };
      save_doctor_identity: {
        Args: { doctor_id: string; data: Json };
        Returns: undefined;
      };
      save_excuse_template: {
        Args: {
          institution_id: string;
          excuse_type: string;
          expected_version: number;
          data: Json;
        };
        Returns: string;
      };
      save_excuse_catalog: {
        Args: { catalog: string; entry_id: string | null; data: Json };
        Returns: string;
      };
      list_attachments: {
        Args: { patient_id: string; include_archived?: boolean };
        Returns: Json;
      };
      archive_attachment: {
        Args: { attachment_id: string; reason: string };
        Returns: undefined;
      };
      mark_notification_read: {
        Args: { notification_id?: string | null };
        Returns: undefined;
      };
      patient_dashboard: { Args: Record<string, never>; Returns: Json };
      issue_document: {
        Args: {
          patient_id: string;
          document_kind: string;
          data: Json;
          request_id: string;
        };
        Returns: string;
      };
      list_documents: {
        Args: { patient_id?: string | null; kind_filter?: string | null };
        Returns: Json;
      };
      get_document: {
        Args: { document_id: string; purpose?: string };
        Returns: Json;
      };
      revoke_document: {
        Args: { document_id: string; reason: string };
        Returns: undefined;
      };
      verify_document: { Args: { verification_code: string }; Returns: Json };
      create_encounter: {
        Args: { patient_id: string; data: Json; supersedes_id?: string | null };
        Returns: string;
      };
      add_patient_diagnosis: {
        Args: { patient_id: string; data: Json };
        Returns: string;
      };
      add_patient_therapy: {
        Args: { patient_id: string; data: Json };
        Returns: string;
      };
      set_clinical_status: {
        Args: { entity_type: string; entity_id: string; new_status: string };
        Returns: undefined;
      };
      search_patients: { Args: { search_term: string }; Returns: Json };
      get_patient_chart: { Args: { patient_id: string }; Returns: Json };
      clinical_context: { Args: Record<string, never>; Returns: Json };
      create_patient: {
        Args: { data: Json; doctor_id: string };
        Returns: string;
      };
      update_patient_record: {
        Args: { patient_id: string; blood_group: string; warnings: string };
        Returns: undefined;
      };
      add_patient_allergy: {
        Args: {
          patient_id: string;
          allergy_id: string;
          reaction: string;
          severity: string;
        };
        Returns: string;
      };
      institution_overview: { Args: Record<string, never>; Returns: Json };
      save_institution: {
        Args: { institution_id: string; data: Json };
        Returns: undefined;
      };
      add_department: {
        Args: { institution_id: string; name: string; code: string };
        Returns: string;
      };
      register_doctor: {
        Args: {
          target_user: string;
          institution_id: string;
          specialty: string;
        };
        Returns: string;
      };
      get_my_chart: { Args: Record<string, never>; Returns: Json };
      record_session_event: { Args: { event: string }; Returns: undefined };
    };
    Enums: { app_role: UserRole };
    CompositeTypes: Record<string, never>;
  };
};
