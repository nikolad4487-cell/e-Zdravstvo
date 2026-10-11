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
      priority_hospital_context: { Args: { manage: boolean }; Returns: Json };
      create_priority_hospital_service: {
        Args: {
          department_id: string;
          doctor_id: string;
          name: string;
          specialty: string;
          location: string;
          instructions: string;
        };
        Returns: string;
      };
      save_hospital_department: {
        Args: {
          department_id: string | null;
          institution_id: string;
          name: string;
          duration_minutes: number;
          active: boolean;
        };
        Returns: string;
      };
      assign_hospital_department: {
        Args: { service_id: string; department_id: string };
        Returns: undefined;
      };
      set_hospital_clinic_shift: {
        Args: { service_id: string; weekday: number; shift: string | null };
        Returns: undefined;
      };
      priority_hospital_slots: {
        Args: {
          patient_id: string;
          service_id: string;
          date_from: string;
          date_to: string;
        };
        Returns: Json;
      };
      priority_hospital_referrals: {
        Args: {
          patient_id: string;
          service_id: string;
          starts_at: string;
          search_term: string;
          page_number: number;
        };
        Returns: Json;
      };
      book_priority_hospital: {
        Args: {
          patient_id: string;
          service_id: string;
          starts_at: string;
          referral_id: string | null;
          new_referral: Json | null;
          priority_reason: string;
          request_id: string;
        };
        Returns: Json;
      };
      hospital_booking_email_status: {
        Args: { booking_id: string };
        Returns: string;
      };
      search_attachments: {
        Args: {
          patient_filter: string;
          include_archived: boolean;
          search_term: string;
          category_filter: string | null;
          date_from: string | null;
          date_to: string | null;
          page_number: number;
        };
        Returns: Json;
      };
      application_schema_version: {
        Args: Record<string, never>;
        Returns: number;
      };
      dispense_prescription_items: {
        Args: {
          document_id: string;
          patient_number: string;
          institution_id: string;
          items: Json;
          request_id: string;
        };
        Returns: string;
      };
      search_my_medications: {
        Args: {
          active_only: boolean;
          page_number: number;
          search_term: string;
        };
        Returns: Json;
      };
      grant_guardian_access: {
        Args: {
          patient_id: string;
          guardian_user_id: string;
          legal_basis: string;
          verification_reference: string;
          expires_on: string;
        };
        Returns: undefined;
      };
      revoke_guardian_access: {
        Args: { assignment_id: string; reason: string };
        Returns: undefined;
      };
      admin_patient_guardians: { Args: { patient_id: string }; Returns: Json };
      my_guardian_patients: { Args: { page_number: number }; Returns: Json };
      guardian_patient_record: { Args: { patient_id: string }; Returns: Json };
      export_patient_record: { Args: { patient_id: string }; Returns: Json };
      laboratory_trend_catalog: {
        Args: { patient_filter: string | null };
        Returns: Json;
      };
      laboratory_trend_points: {
        Args: {
          patient_filter: string | null;
          parameter_code: string;
          parameter_unit: string;
          date_from: string;
          date_to: string;
          page_number: number;
        };
        Returns: Json;
      };
      my_care_doctors: { Args: Record<string, never>; Returns: Json };
      clinic_appointment_requests: {
        Args: { personal: boolean; page_number: number };
        Returns: Json;
      };
      request_clinic_appointment: {
        Args: {
          doctor_id: string;
          preferred_date: string;
          preferred_period: string;
          note: string;
          request_id: string;
        };
        Returns: string;
      };
      resolve_clinic_request: {
        Args: {
          request_id: string;
          expected_version: number;
          approve: boolean;
          response: string;
          appointment_data: Json | null;
        };
        Returns: string | null;
      };
      cancel_clinic_request: {
        Args: { request_id: string; expected_version: number };
        Returns: undefined;
      };
      notification_preferences: { Args: Record<string, never>; Returns: Json };
      save_notification_preferences: {
        Args: { email_enabled: boolean; appointment_reminders: boolean };
        Returns: undefined;
      };
      mark_thread_read: {
        Args: { patient_id: string; doctor_id: string; read_through: string };
        Returns: undefined;
      };
      acknowledge_laboratory_result: {
        Args: { result_id: string };
        Returns: undefined;
      };
      laboratory_acknowledgement: {
        Args: { result_id: string };
        Returns: Json;
      };
      doctor_task_overview: { Args: Record<string, never>; Returns: Json };
      doctor_schedule: { Args: Record<string, never>; Returns: Json };
      set_doctor_hours: {
        Args: {
          doctor_id: string;
          weekday: number;
          starts_at: string;
          ends_at: string;
          enabled: boolean;
        };
        Returns: undefined;
      };
      record_doctor_absence: {
        Args: {
          doctor_id: string;
          starts_at: string;
          ends_at: string;
          substitute_id: string | null;
          reason: string;
        };
        Returns: string;
      };
      cancel_doctor_absence: {
        Args: { absence_id: string };
        Returns: undefined;
      };
      search_patients_page: {
        Args: { search_term: string; page_number: number };
        Returns: Json;
      };
      search_documents: {
        Args: {
          patient_filter: string | null;
          kind_filter: string | null;
          search_term: string;
          status_filter: string | null;
          date_from: string | null;
          date_to: string | null;
          page_number: number;
          institution_filter: string | null;
        };
        Returns: Json;
      };
      my_next_hospital_booking: { Args: Record<string, never>; Returns: Json };
      record_vaccination: {
        Args: {
          patient_id: string;
          previous_id: string | null;
          data: Json;
          request_id: string;
        };
        Returns: string;
      };
      list_vaccinations: {
        Args: { personal: boolean; patient_filter: string | null };
        Returns: Json;
      };
      pharmacy_lookup: {
        Args: { document_number: string; patient_number: string };
        Returns: Json;
      };
      dispense_prescription: {
        Args: {
          document_id: string;
          patient_number: string;
          institution_id: string;
        };
        Returns: undefined;
      };
      pharmacy_institutions: { Args: Record<string, never>; Returns: Json };
      my_medications: {
        Args: { active_only: boolean; page_number: number };
        Returns: Json;
      };
      my_patient_settings: { Args: Record<string, never>; Returns: Json };
      save_patient_contacts: { Args: { data: Json }; Returns: undefined };
      set_my_care_access: {
        Args: { target_user: string; allowed: boolean };
        Returns: undefined;
      };
      my_access_history: { Args: { page_number: number }; Returns: Json };
      publish_medical_report: {
        Args: {
          patient_id: string;
          booking_id: string | null;
          previous_id: string | null;
          data: Json;
          request_id: string;
        };
        Returns: string;
      };
      list_medical_reports: {
        Args: {
          personal: boolean;
          patient_filter: string | null;
          page_number: number;
        };
        Returns: Json;
      };
      download_medical_report: { Args: { report_id: string }; Returns: Json };
      download_laboratory_result: {
        Args: { result_id: string };
        Returns: Json;
      };
      set_messaging_enabled: {
        Args: { doctor_id: string; enabled: boolean };
        Returns: undefined;
      };
      message_threads: {
        Args: { personal: boolean; search_term: string };
        Returns: Json;
      };
      read_messages: {
        Args: {
          patient_id: string;
          doctor_id: string;
          before_time: string | null;
        };
        Returns: Json;
      };
      send_patient_message: {
        Args: {
          patient_id: string;
          doctor_id: string;
          body: string;
          request_id: string;
        };
        Returns: string;
      };
      set_renewal_allowed: {
        Args: { therapy_id: string; allowed: boolean };
        Returns: undefined;
      };
      renewal_overview: {
        Args: { personal: boolean; patient_filter: string | null };
        Returns: Json;
      };
      request_medication_renewal: {
        Args: { therapy_id: string; note: string };
        Returns: string;
      };
      resolve_medication_renewal: {
        Args: {
          renewal_id: string;
          approve: boolean;
          response: string;
          prescription_data: Json;
        };
        Returns: string | null;
      };
      reschedule_hospital_booking: {
        Args: {
          booking_id: string;
          new_slot_id: string;
          expected_version: number;
          reason: string;
          request_id: string;
        };
        Returns: undefined;
      };
      hospital_reschedule_history: {
        Args: { booking_id: string };
        Returns: Json;
      };
      hospital_context: { Args: { manage: boolean }; Returns: Json };
      save_hospital_service: {
        Args: { service_id: string | null; data: Json };
        Returns: string;
      };
      publish_hospital_slots: {
        Args: {
          service_id: string;
          local_start: string;
          duration: number;
          slot_count: number;
          priority_only: boolean;
        };
        Returns: undefined;
      };
      list_hospital_slots: {
        Args: {
          service_id: string;
          date_from: string;
          date_to: string;
          manage: boolean;
        };
        Returns: Json;
      };
      close_hospital_slot: { Args: { slot_id: string }; Returns: undefined };
      book_hospital_slot: {
        Args: {
          patient_id: string;
          slot_id: string;
          referral_id: string | null;
          priority: boolean;
          priority_reason: string;
          request_id: string;
        };
        Returns: string;
      };
      list_hospital_bookings: {
        Args: {
          mode: string;
          patient_filter: string | null;
          page_number: number;
        };
        Returns: Json;
      };
      change_hospital_booking: {
        Args: {
          booking_id: string;
          expected_version: number;
          new_status: string;
          reason: string;
        };
        Returns: undefined;
      };
      admin_patients: {
        Args: { search_term: string; page_number: number };
        Returns: Json;
      };
      admin_care_team: { Args: { patient_id: string }; Returns: Json };
      set_patient_care: {
        Args: {
          patient_id: string;
          kind: string;
          target_id: string;
          enabled: boolean;
          primary_doctor: boolean;
          reason: string;
        };
        Returns: undefined;
      };
      link_patient_account: {
        Args: { patient_id: string; target_user: string; reason: string };
        Returns: undefined;
      };
      laboratory_context: { Args: Record<string, never>; Returns: Json };
      search_laboratory: {
        Args: {
          mode: string;
          patient_filter: string | null;
          page_number: number;
          search_term: string;
          status_filter: string | null;
          priority_filter: string | null;
          date_from: string | null;
          date_to: string | null;
        };
        Returns: Json;
      };
      list_laboratory: {
        Args: {
          mode: string;
          patient_filter: string | null;
          page_number: number;
        };
        Returns: Json;
      };
      order_laboratory: {
        Args: { patient_id: string; data: Json; request_id: string };
        Returns: string;
      };
      set_lab_order_status: {
        Args: {
          order_id: string;
          expected_version: number;
          new_status: string;
          reason: string;
        };
        Returns: undefined;
      };
      publish_laboratory_result: {
        Args: { order_id: string; previous_result: string | null; data: Json };
        Returns: string;
      };
      appointment_doctors: { Args: { patient_id: string }; Returns: Json };
      list_appointments: {
        Args: {
          date_from: string;
          date_to: string;
          personal: boolean;
          patient_filter: string | null;
        };
        Returns: Json;
      };
      save_appointment: {
        Args: {
          appointment_id: string | null;
          expected_version: number | null;
          data: Json;
          request_id: string;
        };
        Returns: string;
      };
      set_appointment_status: {
        Args: {
          appointment_id: string;
          expected_version: number;
          new_status: string;
          reason: string;
        };
        Returns: undefined;
      };
      excuse_context: { Args: { patient_id: string }; Returns: Json };
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
      update_patient_details: {
        Args: { patient_id: string; data: Json; expected_data: Json };
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
