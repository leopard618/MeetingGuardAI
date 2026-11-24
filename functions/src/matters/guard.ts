/**
 * The content guard of a reply draft (A2; docs/v1/ARCHITECTURE.md section 36). Plain code, never
 * the model: a draft with any flag never goes out automatically. It becomes an approval card that
 * shows the flags, and the owner decides (the send check still applies to what they approve).
 *
 * Flags (EN and ES, accents folded, whole words):
 * - money:    prices, payments, invoices, discounts, refunds, currencies and amounts;
 * - contract: contracts, agreements, signatures, terms and clauses;
 * - link:     any URL, "www." or bare host name (the assistant never sends links);
 * - address:  an email address that is not a contact of the mandate or the owner;
 * - length:   longer than MATTER_LIMITS.replyChars;
 * - promise:  (A4) a promise or commitment made for the owner ("I promise", "we will deliver",
 *             "te lo garantizo"): the assistant never promises beyond the mandate.
 * A4 widened money and contract (bank details, cards, payment apps, crypto, quotations, salaries,
 * penalties; e-signatures, liability, warranties, licences, leases, purchase orders) and added
 * promise (docs/v2/A4-THREAT-MODEL.md). False positives are cheap (a card instead of an automatic
 * reply); a missed term is what the list guards against, so it errs on the wide side. A flagged
 * draft is never sent on its own: only the owner can send it, after reading it on its card.
 */
import type { MatterGuardFlag } from '../shared/aiContract';
import { hasBareHost } from '../commitments/grounding';
import { MATTER_LIMITS } from './model';

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const words = (list: string) => new RegExp(`\\b(?:${list})\\b`, 'i');

const MONEY = words(
  [
    'price', 'prices', 'pricing', 'priced', 'cost', 'costs', 'fee', 'fees', 'pay', 'pays', 'paid', 'paying', 'payment', 'payments',
    'invoice', 'invoices', 'discount', 'discounts', 'refund', 'refunds', 'deposit', 'budget', 'quote for', 'rate', 'rates',
    'euro', 'euros', 'eur', 'dollar', 'dollars', 'usd', 'gbp', 'pound', 'pounds', 'cheaper', 'expensive', 'money', 'wire', 'transfer',
    'precio', 'precios', 'coste', 'costes', 'costo', 'costos', 'tarifa', 'tarifas', 'pago', 'pagos', 'pagar', 'pagado', 'pagamos',
    'factura', 'facturas', 'descuento', 'descuentos', 'reembolso', 'deposito', 'presupuesto', 'dolar', 'dolares', 'dinero',
    'transferencia', 'importe', 'cobrar', 'cobro',
    // A4
    'iban', 'swift', 'bic', 'bank account', 'bank details', 'account number', 'routing number', 'sort code', 'credit card', 'debit card',
    'card number', 'cvv', 'paypal', 'venmo', 'zelle', 'stripe', 'bizum', 'crypto', 'bitcoin', 'btc', 'usdt', 'ethereum', 'quotation',
    'quotations', 'salary', 'salaries', 'commission', 'commissions', 'penalty', 'penalties', 'tax', 'taxes', 'vat',
    'cuenta bancaria', 'numero de cuenta', 'datos bancarios', 'tarjeta de credito', 'tarjeta de debito', 'cripto', 'criptomoneda',
    'cotizacion', 'cotizaciones', 'salario', 'salarios', 'sueldo', 'comision', 'comisiones', 'penalizacion', 'multa', 'multas',
    'impuesto', 'impuestos', 'iva', 'abonar', 'abono',
  ].join('|'),
);
const CURRENCY = /[$€£¥]|\b\d+(?:[.,]\d+)?\s?(?:k|eur|usd|euros?|dollars?|dolares?)\b/i;

const CONTRACT = words(
  [
    'contract', 'contracts', 'agreement', 'agreements', 'sign', 'signs', 'signed', 'signing', 'signature', 'signatures',
    'terms', 'clause', 'clauses', 'nda', 'legal', 'binding', 'commit to', 'guarantee', 'guaranteed',
    'contrato', 'contratos', 'acuerdo', 'acuerdos', 'firma', 'firmas', 'firmar', 'firmado', 'firmada', 'clausula', 'clausulas',
    'condiciones', 'terminos', 'garantia', 'garantizamos', 'vinculante',
    // A4
    'e-sign', 'esign', 'docusign', 'hereby', 'liability', 'liable', 'indemnify', 'indemnity', 'indemnification', 'warranty',
    'warranties', 'license', 'licence', 'licensing', 'lease', 'leases', 'purchase order', 'statement of work', 'non-disclosure',
    'exclusivity', 'penalty clause', 'responsabilidad legal', 'indemnizacion', 'indemnizar', 'licencia', 'licencias', 'arrendamiento',
    'orden de compra', 'confidencialidad', 'exclusividad',
  ].join('|'),
);

/** A4: promises and commitments made for the owner (EN and ES, accents folded). */
const PROMISE = words(
  [
    'i promise', 'we promise', 'promise you', 'i guarantee', 'we guarantee', 'i assure you', 'we assure you', 'we will deliver',
    'i will deliver', 'we commit', 'i commit', 'we are committed to', 'you have my word', 'rest assured', 'without fail',
    'te prometo', 'le prometo', 'les prometo', 'prometemos', 'prometo', 'te lo garantizo', 'se lo garantizo', 'garantizo',
    'te aseguro', 'le aseguro', 'nos comprometemos', 'me comprometo', 'tienes mi palabra', 'tiene mi palabra', 'sin falta',
  ].join('|'),
);

const URL = /\bhttps?:\/\/|\bwww\./i;
const EMAIL = /[^\s<>()[\],;:"']+@[^\s<>()[\],;:"']+\.[a-z]{2,}/gi;

export interface GuardInput {
  /** The draft as the model wrote it (before the code adds the signature and footer). */
  text: string;
  /** Addresses the draft may name: the mandate's contacts and the owner's email. */
  allowedAddresses: readonly string[];
}

/** The flags of a draft (empty = it may go out automatically, if everything else allows it). */
export function guardReply(input: GuardInput): MatterGuardFlag[] {
  const flags = new Set<MatterGuardFlag>();
  const text = fold(input.text);
  if (MONEY.test(text) || CURRENCY.test(text)) flags.add('money');
  if (CONTRACT.test(text)) flags.add('contract');
  if (PROMISE.test(text)) flags.add('promise');
  const allowed = new Set(input.allowedAddresses.map((a) => a.trim().toLowerCase()));
  const addresses = input.text.match(EMAIL) ?? [];
  if (addresses.some((a) => !allowed.has(a.replace(/[.!?]+$/, '').toLowerCase()))) flags.add('address');
  // a host name inside an allowed address is not a link
  const withoutAddresses = input.text.replace(EMAIL, ' ');
  if (URL.test(withoutAddresses) || hasBareHost(withoutAddresses)) flags.add('link');
  if (input.text.length > MATTER_LIMITS.replyChars) flags.add('length');
  return [...flags];
}
