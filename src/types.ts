export type ISODate = string;

export type BucketKind =
  | 'purchase'
  | 'balance_transfer'
  | 'flex_plan'
  | 'cash_advance';

export interface Bucket {
  id: string;
  label: string;
  kind: BucketKind;
  balance: number;
  apr: number;
  promoApr?: number;
  promoEndDate?: ISODate;
  /** Store-card style: unpaid promo balance gets all waived interest back-charged. */
  deferredInterest?: boolean;
  /** Fixed installment required each cycle (Amex Plan It / Citi Flex Pay). */
  flexMonthlyPayment?: number;
  /** Monthly fee as % of the ORIGINAL plan amount, charged instead of APR. */
  flexMonthlyFeePct?: number;
  flexOriginalAmount?: number;
  flexRemainingMonths?: number;
}

export interface CreditCard {
  id: string;
  kind: 'credit_card';
  name: string;
  issuer?: string;
  creditLimit?: number;
  statementDay: number;
  dueDay: number;
  /** Percent of statement balance used in the minimum payment formula. */
  minPaymentPct: number;
  minPaymentFloor: number;
  /** Most issuers add the cycle's interest+fees on top of the percentage. */
  minIncludesInterest: boolean;
  buckets: Bucket[];
  /** Drives grace period: no purchase interest while true. */
  paidInFullLastStatement?: boolean;
  notes?: string;
}

export type PaymentFrequency = 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';

export interface Loan {
  id: string;
  kind: 'loan';
  name: string;
  lender?: string;
  balance: number;
  apr: number;
  paymentFrequency: PaymentFrequency;
  paymentAmount: number;
  nextPaymentDate: ISODate;
  /** Informal debts to friends/family: no interest, flexible. */
  informal?: boolean;
  notes?: string;
}

export type Debt = CreditCard | Loan;

export type StrategyId =
  | 'avalanche'
  | 'snowball'
  | 'cashflow'
  | 'deadline';

export interface Settings {
  monthlyBudget: number;
  startDate: ISODate;
  strategy: StrategyId;
}

export interface StatementRecord {
  id: string;
  debtId: string;
  bucketId?: string;
  closeDate: ISODate;
  statementBalance: number;
  interestCharged: number;
  feesCharged: number;
  paymentsCredited: number;
  purchases: number;
  minimumDue: number;
  source: 'manual' | 'csv' | 'pdf';
  importedAt: string;
}

export interface AppState {
  debts: Debt[];
  settings: Settings;
  statements: StatementRecord[];
}
