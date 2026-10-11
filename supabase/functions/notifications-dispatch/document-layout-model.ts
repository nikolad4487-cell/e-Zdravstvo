export interface LabPdfRow {
  code: string;
  name: string;
  value: string;
  unit: string;
  referenceLow: string | null;
  referenceHigh: string | null;
  flag: "NORMAL" | "HIGH" | "LOW" | "CRITICAL" | null;
}
export interface SchoolPrintDocument {
  number: string;
  status: string;
  issued_at: string;
  expires_on: string;
  revocation_reason: string | null;
  verification_token?: string;
  payload: {
    patient: {
      first_name: string;
      last_name: string;
      birth_date: string;
      patient_number: string;
    };
    doctor: string;
    institution: string;
    institution_address: string;
    signature_disclaimer: string;
    details: {
      date_from?: string;
      date_to?: string;
      category?: string;
      school?: string;
      notes?: string;
      diagnosis_code?: string | null;
      doctor_code?: string;
      signer_fingerprint?: string;
      excuse_type?: "REGULAR" | "PE";
      clinic?: {
        name: string;
        code: string;
        address: string;
        city: string;
        phone: string;
        email: string;
      };
      template?: {
        title: string;
        body_text: string;
        footer_text: string;
        font_family: "SERIF" | "SANS";
        font_size: number;
        header_align: "CENTER" | "LEFT";
        accent: string;
        show_separator: boolean;
        excuse_type: "REGULAR" | "PE";
      };
    };
  };
  signature: {
    status: string;
    integrity_valid: boolean;
    signature_hash: string;
  };
}
export interface DocumentPrintLayout {
  referralCode?: string;
  referralCodeName?: string;
  examinationCode?: string;
  examinationName?: string;
  visitCode?: string;
  visitName?: string;

  laboratoryRows?: LabPdfRow[];
  schoolDocument?: SchoolPrintDocument;
  verificationToken?: string;
  status?: string;
}

export const referralTypeLabels: Record<string, string> = {
  SPECIALIST: "Specijalistički pregled",
  LABORATORY: "Laboratorijska pretraga",
  DIAGNOSTICS: "Dijagnostički pregled",
  HOSPITAL: "Bolnički pregled",
  FOLLOW_UP: "Kontrolni pregled",
  PHYSICAL_THERAPY: "Fizikalna terapija",
  OTHER: "Ostalo",
};
