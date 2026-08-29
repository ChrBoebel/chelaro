export type InvoiceStatus =
  | "unverified"
  | "verified"
  | "open"
  | "paid"
  | "archived";

export type WorkbookColumn = {
  key: string;
  label: string;
  data_type:
    | "text"
    | "date"
    | "money"
    | "currency"
    | "category"
    | "status"
    | "document";
  editable: boolean;
  width: number;
  options: string[] | null;
};

export type InvoiceWorkbookRow = {
  id: string;
  version: number;
  document_id: string;
  document_filename: string;
  document_download_url: string;
  vendor: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  gross_amount: string | null;
  currency: string;
  category: string | null;
  status: InvoiceStatus;
  notes: string | null;
  updated_at: string;
};

export type InvoiceWorkbook = {
  id: "invoices";
  name: string;
  version: number;
  columns: WorkbookColumn[];
  rows: InvoiceWorkbookRow[];
  pending_proposals: number;
};

export type InvoiceWorkbookResponse = {
  data: InvoiceWorkbook;
};

export type EditableInvoiceField =
  | "vendor"
  | "invoice_number"
  | "invoice_date"
  | "gross_amount"
  | "currency"
  | "category"
  | "status"
  | "notes";

export type WorkbookChangeSetResponse = {
  data: {
    id: string;
    rows: InvoiceWorkbookRow[];
  };
};

export type ChangeProposalItem = {
  row_id: string;
  field: EditableInvoiceField;
  before: unknown;
  proposed: unknown;
  expected_version: number;
};

export type ChangeProposal = {
  id: string;
  agent_id: string;
  rationale: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_at: string | null;
  items: ChangeProposalItem[];
};

export type ChangeProposalListResponse = {
  data: ChangeProposal[];
};

export type ChangeProposalResponse = {
  data: ChangeProposal;
};
