import type { Debt, StatementRecord } from '../types';
import { uid } from './format';

export interface ParsedTxn {
  date: string;
  description: string;
  /** Positive = charge/increases balance. Negative = payment/credit. */
  amount: number;
}

export interface ParsedStatement {
  source: 'csv' | 'pdf';
  fileName: string;
  transactions: ParsedTxn[];
  statementBalance?: number;
  previousBalance?: number;
  minimumDue?: number;
  dueDate?: string;
  closeDate?: string;
  interestCharged: number;
  feesCharged: number;
  paymentsCredited: number;
  purchases: number;
  aprsFound: { label: string; apr: number }[];
  warnings: string[];
}

const INTEREST_RE =
  /(interest charge|finance charge|purchase interest|interest on|periodic rate)/i;
// \bfee\b deliberately avoids matching inside words such as "COFFEE".
const FEE_RE = /(\bfees?\b|annual membership|late charge|returned payment|foreign transaction)/i;
const PAYMENT_RE = /(payment|autopay|thank you|online pmt|e-payment|pymt)/i;

/* ------------------------------ CSV ------------------------------ */

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else cur += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function toNumber(raw: string): number | undefined {
  if (!raw) return undefined;
  let s = raw.replace(/[$\s,]/g, '');
  if (!s) return undefined;
  let neg = false;
  if (/^\((.*)\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return neg ? -n : n;
}

function normalizeDate(raw: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (m) {
    let [, mo, d, y] = m;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return undefined;
}

const find = (headers: string[], ...names: string[]) =>
  headers.findIndex((h) => names.some((n) => h === n || h.includes(n)));

/**
 * Issuer CSVs disagree on sign: some write purchases positive, others negative.
 * The majority sign of rows that look like payments decides the convention.
 */
function detectSignConvention(rows: ParsedTxn[]): boolean {
  const payments = rows.filter((r) => PAYMENT_RE.test(r.description));
  if (!payments.length) return false;
  const positive = payments.filter((p) => p.amount > 0).length;
  return positive > payments.length / 2;
}

export function parseCsv(text: string, fileName: string): ParsedStatement {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('The file is empty.');

  let headerIdx = lines.findIndex((l) => /date/i.test(l) && /(amount|debit|credit)/i.test(l));
  if (headerIdx < 0) headerIdx = 0;

  const headers = splitCsvLine(lines[headerIdx]).map((h) => h.toLowerCase().replace(/^"|"$/g, ''));
  const iDate = find(headers, 'transaction date', 'post date', 'posting date', 'date');
  const iDesc = find(headers, 'description', 'payee', 'merchant', 'details', 'name');
  const iAmount = find(headers, 'amount');
  const iDebit = find(headers, 'debit', 'charges');
  const iCredit = find(headers, 'credit', 'payments');
  const iType = find(headers, 'type', 'category', 'transaction type');

  if (iDate < 0) warnings.push('No date column found — dates may be missing.');
  if (iAmount < 0 && iDebit < 0 && iCredit < 0) {
    throw new Error('No amount, debit, or credit column found in this CSV.');
  }

  const transactions: ParsedTxn[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < 2) continue;

    let amount: number | undefined;
    if (iAmount >= 0) amount = toNumber(cells[iAmount]);
    if (amount === undefined && (iDebit >= 0 || iCredit >= 0)) {
      const debit = iDebit >= 0 ? toNumber(cells[iDebit]) : undefined;
      const credit = iCredit >= 0 ? toNumber(cells[iCredit]) : undefined;
      if (debit !== undefined && debit !== 0) amount = Math.abs(debit);
      else if (credit !== undefined && credit !== 0) amount = -Math.abs(credit);
    }
    if (amount === undefined) continue;

    const desc = [iDesc >= 0 ? cells[iDesc] : '', iType >= 0 ? cells[iType] : '']
      .filter(Boolean)
      .join(' — ');

    transactions.push({
      date: (iDate >= 0 ? normalizeDate(cells[iDate]) : undefined) ?? '',
      description: desc || '(no description)',
      amount,
    });
  }

  if (!transactions.length) warnings.push('No transaction rows were recognised.');

  // Normalise so charges are positive and payments negative.
  if (detectSignConvention(transactions)) {
    for (const t of transactions) t.amount = -t.amount;
  }

  return { ...summarize(transactions), source: 'csv', fileName, transactions, aprsFound: [], warnings };
}

/* ------------------------------ PDF ------------------------------ */

export async function parsePdf(file: File): Promise<ParsedStatement> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString();

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    text += content.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ');
    text += '\n';
  }
  return parseStatementText(text, file.name);
}

const money = String.raw`\$?\s*(-?[\d,]+\.\d{2})`;

function grab(text: string, patterns: RegExp[]): number | undefined {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const n = toNumber(m[1]);
      if (n !== undefined) return n;
    }
  }
  return undefined;
}

export function parseStatementText(text: string, fileName: string): ParsedStatement {
  const warnings: string[] = [];
  const flat = text.replace(/\s+/g, ' ');

  const statementBalance = grab(flat, [
    new RegExp(String.raw`new balance(?:\s*total)?[^\d$-]{0,25}${money}`, 'i'),
    new RegExp(String.raw`statement balance[^\d$-]{0,25}${money}`, 'i'),
    new RegExp(String.raw`balance as of[^\d$-]{0,25}${money}`, 'i'),
  ]);
  const previousBalance = grab(flat, [
    new RegExp(String.raw`previous balance[^\d$-]{0,25}${money}`, 'i'),
  ]);
  const minimumDue = grab(flat, [
    new RegExp(String.raw`minimum payment (?:due|amount)[^\d$-]{0,25}${money}`, 'i'),
    new RegExp(String.raw`minimum (?:amount )?due[^\d$-]{0,25}${money}`, 'i'),
  ]);
  const interestCharged =
    grab(flat, [
      new RegExp(String.raw`total interest (?:charged )?(?:for this period|this period)?[^\d$-]{0,25}${money}`, 'i'),
      new RegExp(String.raw`interest charged[^\d$-]{0,25}${money}`, 'i'),
      new RegExp(String.raw`finance charges?[^\d$-]{0,25}${money}`, 'i'),
    ]) ?? 0;
  const feesCharged =
    grab(flat, [
      new RegExp(String.raw`total fees (?:charged )?(?:for this period)?[^\d$-]{0,25}${money}`, 'i'),
      new RegExp(String.raw`fees charged[^\d$-]{0,25}${money}`, 'i'),
    ]) ?? 0;
  const paymentsCredited = Math.abs(
    grab(flat, [
      new RegExp(String.raw`payments(?: and other credits| ?/ ?credits)?[^\d$-]{0,25}${money}`, 'i'),
      new RegExp(String.raw`total payments[^\d$-]{0,25}${money}`, 'i'),
    ]) ?? 0,
  );
  const purchases =
    grab(flat, [
      new RegExp(String.raw`purchases(?: and adjustments)?[^\d$-]{0,25}${money}`, 'i'),
      new RegExp(String.raw`total purchases[^\d$-]{0,25}${money}`, 'i'),
    ]) ?? 0;

  const dueMatch =
    /payment due date[^\d]{0,25}(\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]{2,8} \d{1,2},? \d{4})/i.exec(flat);
  const closeMatch =
    /(?:closing date|statement (?:closing )?date|billing (?:cycle|period)[^.]{0,40}?-)\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Z][a-z]{2,8} \d{1,2},? \d{4})/i.exec(flat);

  const aprsFound: { label: string; apr: number }[] = [];
  const aprRe =
    /(purchases?|balance transfers?|cash advances?|promotional[a-z ]*|plan[a-z ]*)[^%]{0,60}?(\d{1,2}\.\d{2,4})\s*%/gi;
  let m: RegExpExecArray | null;
  while ((m = aprRe.exec(flat)) && aprsFound.length < 12) {
    const label = m[1].trim().replace(/\s+/g, ' ');
    const apr = Number(m[2]);
    if (apr > 0 && apr < 40 && !aprsFound.some((a) => a.label.toLowerCase() === label.toLowerCase())) {
      aprsFound.push({ label, apr });
    }
  }

  const transactions: ParsedTxn[] = [];
  const txnRe = new RegExp(String.raw`(\d{1,2}\/\d{1,2})\s+([A-Za-z0-9][^$]{3,60}?)\s+(-?\$?[\d,]+\.\d{2})`, 'g');
  const year = new Date().getFullYear();
  while ((m = txnRe.exec(flat)) && transactions.length < 400) {
    const [, md, desc, amt] = m;
    const n = toNumber(amt);
    if (n === undefined) continue;
    const [mo, d] = md.split('/');
    transactions.push({
      date: `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`,
      description: desc.trim(),
      amount: n,
    });
  }

  if (statementBalance === undefined) {
    warnings.push(
      'Could not find a "new balance" line. Check the numbers below and correct anything wrong before applying.',
    );
  }
  if (!transactions.length) {
    warnings.push('No individual transactions were extracted — statement totals were used instead.');
  }

  return {
    source: 'pdf',
    fileName,
    transactions,
    statementBalance,
    previousBalance,
    minimumDue,
    dueDate: dueMatch ? normalizeDate(dueMatch[1]) : undefined,
    closeDate: closeMatch ? normalizeDate(closeMatch[1]) : undefined,
    interestCharged: Math.abs(interestCharged),
    feesCharged: Math.abs(feesCharged),
    paymentsCredited,
    purchases: Math.abs(purchases),
    aprsFound,
    warnings,
  };
}

/* --------------------------- summarising --------------------------- */

function summarize(txns: ParsedTxn[]) {
  let interestCharged = 0;
  let feesCharged = 0;
  let paymentsCredited = 0;
  let purchases = 0;

  for (const t of txns) {
    if (INTEREST_RE.test(t.description)) interestCharged += Math.abs(t.amount);
    else if (FEE_RE.test(t.description)) feesCharged += Math.abs(t.amount);
    else if (t.amount < 0) paymentsCredited += Math.abs(t.amount);
    else purchases += t.amount;
  }

  return {
    interestCharged: Math.round(interestCharged * 100) / 100,
    feesCharged: Math.round(feesCharged * 100) / 100,
    paymentsCredited: Math.round(paymentsCredited * 100) / 100,
    purchases: Math.round(purchases * 100) / 100,
    statementBalance: undefined as number | undefined,
    previousBalance: undefined as number | undefined,
    minimumDue: undefined as number | undefined,
    dueDate: undefined as string | undefined,
    closeDate: undefined as string | undefined,
  };
}

/** Balance implied by the parsed activity, when the file has no explicit total. */
export function impliedBalance(
  currentBalance: number,
  s: Pick<ParsedStatement, 'purchases' | 'interestCharged' | 'feesCharged' | 'paymentsCredited'>,
): number {
  return (
    Math.round(
      (currentBalance + s.purchases + s.interestCharged + s.feesCharged - s.paymentsCredited) * 100,
    ) / 100
  );
}

export function toStatementRecord(
  debt: Debt,
  bucketId: string | undefined,
  s: ParsedStatement,
  newBalance: number,
  closeDate: string,
): StatementRecord {
  return {
    id: uid(),
    debtId: debt.id,
    bucketId,
    closeDate,
    statementBalance: newBalance,
    interestCharged: s.interestCharged,
    feesCharged: s.feesCharged,
    paymentsCredited: s.paymentsCredited,
    purchases: s.purchases,
    minimumDue: s.minimumDue ?? 0,
    source: s.source,
    importedAt: new Date().toISOString(),
  };
}
