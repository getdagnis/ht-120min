import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const PUBLIC_SNAPSHOT_MAX_BYTES = 1_048_576;
export const PUBLIC_WITHDRAWAL_TARGET_MS = 60_000;

/** Each component must supply an allowlisting decoder; whole source rows are not a contract. */
export interface PublicSnapshotContract<Payload extends object> {
  targetKey: string;
  version: number;
  parse: (input: unknown) => Payload;
}

export interface PublicSnapshotLease {
  targetKey: string;
  contractVersion: number;
  sourceGeneration: number;
  token: string;
  expiresAt: string;
}

export type WithdrawalFailure = 'purge_failed' | 'probe_failed' | 'coverage_missing';

export interface PublicWithdrawalStatus {
  label: 'Withdrawal pending' | 'Withdrawal verified';
  requestedAt: string;
  deadlineAt: string;
  verifiedAt: string | null;
  targetBreached: boolean;
  errorCode: WithdrawalFailure | null;
}

function objectRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid publication metadata.');
  }
  return value as Record<string, unknown>;
}

function generation(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('Invalid publication generation.');
  }
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('Invalid publication timestamp.');
  }
  return value;
}

/** Server/admin status only. A successful invalidation invocation is not verification. */
export function parsePublicWithdrawalStatus(input: unknown, nowMs = Date.now()): PublicWithdrawalStatus | null {
  const row = objectRow(input);
  if (row.exposure !== 'withdrawn') return null;
  if (!Number.isFinite(nowMs)) throw new Error('Invalid withdrawal observation time.');
  const requestedAt = timestamp(row.withdrawal_requested_at);
  const deadlineAt = timestamp(row.withdrawal_deadline_at);
  if (Date.parse(deadlineAt) - Date.parse(requestedAt) !== PUBLIC_WITHDRAWAL_TARGET_MS) {
    throw new Error('Invalid withdrawal deadline.');
  }
  const verifiedAt = row.withdrawal_verified_at == null ? null : timestamp(row.withdrawal_verified_at);
  if (verifiedAt && Date.parse(verifiedAt) < Date.parse(requestedAt)) {
    throw new Error('Invalid withdrawal verification time.');
  }
  const errorCode = row.error_code == null ? null : row.error_code;
  if (errorCode !== null && !['purge_failed', 'probe_failed', 'coverage_missing'].includes(String(errorCode))) {
    throw new Error('Invalid withdrawal failure code.');
  }
  return {
    label: verifiedAt ? 'Withdrawal verified' : 'Withdrawal pending',
    requestedAt,
    deadlineAt,
    verifiedAt,
    targetBreached: (verifiedAt ? Date.parse(verifiedAt) : nowMs) > Date.parse(deadlineAt),
    errorCode: errorCode as WithdrawalFailure | null,
  };
}

/**
 * Internal persistence adapter. Callers provide a service-role client and must verify
 * fresh command authority before approval/withdrawal. Not a public API or cache.
 * No source-table fallback, CHPP request, scheduler, or producer switch lives here.
 */
export function createPublicSnapshotStore<Payload extends object>(
  supabase: SupabaseClient,
  contract: PublicSnapshotContract<Payload>,
) {
  if (!/^(home|tournament|season|fixture|identity|news):[A-Za-z0-9:_-]+$/.test(contract.targetKey)
    || contract.targetKey.length > 200
    || !Number.isSafeInteger(contract.version) || contract.version < 1
    || typeof contract.parse !== 'function') {
    throw new Error('Invalid public publication contract.');
  }
  // Capture identity/decoder rather than accepting mutable target changes later.
  const { targetKey, version, parse } = contract;
  const scope = { p_target_key: targetKey, p_contract_version: version };

  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await supabase.rpc(name, { ...scope, ...args });
    if (error) throw new Error('Public publication persistence failed.');
    return data;
  }

  async function booleanRpc(name: string, args: Record<string, unknown>): Promise<boolean> {
    const result = await rpc(name, args);
    if (typeof result !== 'boolean') throw new Error('Invalid publication mutation response.');
    return result;
  }

  function leaseArgs(lease: PublicSnapshotLease) {
    if (lease.targetKey !== targetKey || lease.contractVersion !== version
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lease.token)) {
      throw new Error('Publication lease does not match this contract.');
    }
    timestamp(lease.expiresAt);
    return { p_source_generation: generation(lease.sourceGeneration), p_lease_token: lease.token };
  }

  return {
    async readPublished(): Promise<{ payload: Payload; generation: number } | null> {
      const { data, error } = await supabase.from('public_snapshots')
        .select('payload, published_generation, exposure')
        .eq('target_key', targetKey).eq('contract_version', version)
        .eq('exposure', 'public').maybeSingle();
      if (error) throw new Error('Public publication read failed.');
      if (data === null) return null;
      const row = objectRow(data);
      // Defense in depth if a transport/mock returns a row outside the filter.
      if (row.exposure !== 'public') return null;
      return { payload: parse(row.payload), generation: generation(row.published_generation) };
    },

    /** Bootstrap/explicit repair only. Domain writes need the SQL call in their own transaction. */
    async markDirty(): Promise<number> {
      return generation(await rpc('mark_public_snapshot_dirty', {}));
    },

    async approvePublication(expectedGeneration: number): Promise<number | null> {
      const result = await rpc('approve_public_snapshot', { p_expected_generation: generation(expectedGeneration) });
      return result === null ? null : generation(result);
    },

    async claimBuild(leaseSeconds = 90): Promise<PublicSnapshotLease | null> {
      if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 90) {
        throw new Error('Invalid publication lease duration.');
      }
      const rows = await rpc('claim_public_snapshot_build', { p_lease_seconds: leaseSeconds });
      if (!Array.isArray(rows) || rows.length > 1) throw new Error('Invalid publication claim response.');
      if (!rows.length) return null;
      const row = objectRow(rows[0]);
      const lease = {
        targetKey, contractVersion: version,
        sourceGeneration: generation(row.source_generation),
        token: typeof row.lease_token === 'string' ? row.lease_token : '',
        expiresAt: timestamp(row.lease_expires_at),
      };
      leaseArgs(lease);
      return lease;
    },

    async publish(lease: PublicSnapshotLease, candidate: unknown): Promise<boolean> {
      const args = leaseArgs(lease);
      const payload = parse(candidate);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Public publication payload must be an object.');
      }
      const serialized = JSON.stringify(payload);
      if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > PUBLIC_SNAPSHOT_MAX_BYTES) {
        throw new Error('Public publication payload exceeds the component size limit.');
      }
      return booleanRpc('publish_public_snapshot', {
        ...args, p_payload: JSON.parse(serialized),
        p_payload_checksum: createHash('sha256').update(serialized).digest('hex'),
      });
    },

    async failBuild(lease: PublicSnapshotLease): Promise<boolean> {
      return booleanRpc('fail_public_snapshot_build', leaseArgs(lease));
    },

    async withdraw(expectedGeneration: number): Promise<number | null> {
      const result = await rpc('withdraw_public_snapshot', { p_expected_generation: generation(expectedGeneration) });
      return result === null ? null : generation(result);
    },

    async acknowledgeInvalidation(snapshotGeneration: number): Promise<boolean> {
      return booleanRpc('acknowledge_public_snapshot_invalidation', { p_generation: generation(snapshotGeneration) });
    },

    /** Invoke only after final purge/drain and two clean, properly covered probe rounds. */
    async verifyWithdrawal(snapshotGeneration: number): Promise<boolean> {
      return booleanRpc('verify_public_snapshot_withdrawal', { p_generation: generation(snapshotGeneration) });
    },

    async failWithdrawal(snapshotGeneration: number, errorCode: WithdrawalFailure): Promise<boolean> {
      if (!['purge_failed', 'probe_failed', 'coverage_missing'].includes(errorCode)) {
        throw new Error('Invalid withdrawal failure code.');
      }
      return booleanRpc('fail_public_snapshot_withdrawal', {
        p_generation: generation(snapshotGeneration), p_error_code: errorCode,
      });
    },

    async readWithdrawalStatus(nowMs = Date.now()): Promise<PublicWithdrawalStatus | null> {
      const { data, error } = await supabase.from('public_snapshots')
        .select('exposure, withdrawal_requested_at, withdrawal_deadline_at, withdrawal_verified_at, error_code')
        .eq('target_key', targetKey).eq('contract_version', version).maybeSingle();
      if (error) throw new Error('Withdrawal status read failed.');
      return data === null ? null : parsePublicWithdrawalStatus(data, nowMs);
    },
  };
}
