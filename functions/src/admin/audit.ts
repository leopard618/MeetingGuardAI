/**
 * Admin audit log (owner: admin; docs/v1/ADMIN.md "Roles and the audit log").
 *
 * Every administrative WRITE records one document in adminAudit/{autoId}: who did it (the
 * caller's uid), what (the action and its target), the state before and after as far as the
 * handler knows it, and the outcome. Reads are never audited. The collection is server-only:
 * firestore.rules deny every client access by default, and the dashboard will read it through
 * a callable. Entries never contain secrets (the key rotation records a version number only).
 *
 * Writes are best effort: the administrative action has already happened by the time the entry
 * is written, so a failing audit write is logged as an error and never turns a completed action
 * into a reported failure.
 */
import type { Firestore } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

export const ADMIN_AUDIT_COLLECTION = 'adminAudit';

export const ADMIN_AUDIT_ACTIONS = ['setUserDisabled', 'setUserPlan', 'rotateOpenAiKey', 'reconcileEntitlement'] as const;
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

export interface AdminAuditEntry {
  /** ISO timestamp of the action. */
  at: string;
  actorUid: string;
  action: AdminAuditAction;
  /** The user the action was about, or null for product-wide actions (key rotation). */
  targetUid: string | null;
  /** Small, display-safe summaries; never raw documents with unknown fields, never secrets. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** 'ok' or a short reason string. */
  outcome: string;
}

export interface AuditWriter {
  writeAudit(entry: AdminAuditEntry): Promise<void>;
}

export function firestoreAuditWriter(db: Firestore): AuditWriter {
  return {
    async writeAudit(entry) {
      try {
        await db.collection(ADMIN_AUDIT_COLLECTION).add(entry);
      } catch (error) {
        logger.error('adminAudit.write_failed', {
          action: entry.action,
          actorUid: entry.actorUid,
          targetUid: entry.targetUid,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message.slice(0, 300) : '',
        });
      }
    },
  };
}

/** Keeps only the display fields of an entitlement document for the before/after columns. */
export function entitlementSummary(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const doc = raw as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ['plan', 'status', 'expiresAt', 'source'] as const) {
    if (key in doc) summary[key] = doc[key] ?? null;
  }
  return Object.keys(summary).length > 0 ? summary : null;
}
