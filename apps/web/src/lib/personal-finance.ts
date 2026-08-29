export type TransactionDirection = "income" | "expense";
export type ReceivableStatus = "open" | "partial" | "paid" | "overdue";
export type PaymentMethod = "bank_transfer" | "cash" | "paypal" | "card" | "other";

export type FinancialTransaction = {
  id: string;
  direction: TransactionDirection;
  amount: string;
  currency: string;
  booked_on: string;
  counterparty: string;
  category: string;
  description: string | null;
  source: "manual" | "receivable";
  receivable_id: string | null;
  created_at: string;
};

export type Receivable = {
  id: string;
  version: number;
  debtor_name: string;
  original_amount: string;
  received_amount: string;
  outstanding_amount: string;
  currency: string;
  due_date: string | null;
  description: string;
  status: ReceivableStatus;
  created_at: string;
  updated_at: string;
};

export type ReceivablePaymentReversal = {
  id: string;
  transaction_id: string;
  reason: string;
  actor_type: "owner" | "agent" | "system";
  actor_id: string;
  proposal_id: string | null;
  created_at: string;
};

export type ReceivablePayment = {
  id: string;
  transaction_id: string;
  amount: string;
  booked_on: string;
  purpose: string;
  payment_method: PaymentMethod;
  note: string | null;
  actor_type: "owner" | "agent" | "system";
  actor_id: string;
  proposal_id: string | null;
  created_at: string;
  reversal: ReceivablePaymentReversal | null;
};

export type ReceivableEvent = {
  id: string;
  event_type: "created" | "details_updated" | "payment_recorded" | "payment_reversed";
  actor_type: "owner" | "agent" | "system";
  actor_id: string;
  proposal_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type ReceivableDetail = Receivable & {
  payments: ReceivablePayment[];
  history: ReceivableEvent[];
  pending_proposals: number;
};

export type FinanceChangeProposal = {
  id: string;
  agent_id: string;
  action: "receivable_create" | "receivable_update" | "payment_record" | "payment_reverse";
  receivable_id: string | null;
  debtor_name: string;
  expected_version: number | null;
  current_version: number | null;
  payload: Record<string, unknown>;
  rationale: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decided_at: string | null;
};

export type CashflowPoint = {
  month: string;
  label: string;
  income: string;
  expenses: string;
  net: string;
};

export type PersonalFinanceDashboard = {
  period: {
    key: string;
    label: string;
    start: string;
    end: string;
  };
  summary: {
    income: string;
    expenses: string;
    net: string;
    outstanding_receivables: string;
    overdue_receivables: number;
    pending_finance_proposals: number;
    currency: string;
  };
  cashflow: CashflowPoint[];
  open_receivables: Receivable[];
  recent_transactions: FinancialTransaction[];
};

export type PersonalFinanceDashboardResponse = {
  data: PersonalFinanceDashboard;
};

export type ReceivableResponse = { data: Receivable };
export type ReceivableDetailResponse = { data: ReceivableDetail };
export type FinanceChangeProposalListResponse = { data: FinanceChangeProposal[] };
export type FinanceChangeProposalResponse = { data: FinanceChangeProposal };
export type FinancialTransactionResponse = { data: FinancialTransaction };
