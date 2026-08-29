export type TanMethod = "unknown" | "push_tan" | "chip_tan" | "other";

export type BankConnection = {
  id: string;
  version: number;
  provider: "fints";
  access_mode: "read_only";
  institution_name: string;
  bank_code: string;
  bic: string | null;
  endpoint: string | null;
  tan_method: TanMethod;
  transaction_access_confirmed: boolean | null;
  statement_access_confirmed: boolean | null;
  created_at: string;
  updated_at: string;
};

export type BankingReadinessCheck = {
  code: string;
  label: string;
  complete: boolean;
  detail: string;
};

export type BankingReadiness = {
  connection: BankConnection | null;
  checks: BankingReadinessCheck[];
  ready_for_live_sync: boolean;
  security_notice: string;
};

export type BankingReadinessResponse = { data: BankingReadiness };
