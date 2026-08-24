"""P04e1 policy decision log: a dedicated append-only hash-chain table.

Adds ``policy_decision_log``, never a reuse of ``audit_log``. It carries P04d's identity/hash-chain
payload shape (``id``, ``tenant_id``, ``entry_hash``, ``prev_hash``, ``payload``, ``recorded_at``)
behind the same guarantees S1 gives its own runtime tables: FORCE row-level security keyed off
``mfk_current_tenant()``, a runtime role limited to SELECT/INSERT, and a table-specific append-only
statement trigger the owner cannot bypass either.

Beyond that baseline, this table also enforces its own hash-chain shape in the database: the
payload's ``id``, ``prevHash`` and ``requestActor.tenantId`` must agree with the row's columns, a
row may never link to itself, and a per-tenant chain is single-threaded — one genesis row and at
most one successor per predecessor — via a self-referencing foreign key plus two partial unique
indexes. Canonical hash recomputation and verification is P04e2's job, not this table's DDL.

The downgrade removes only this revision's trigger, function and table.

Revision ID: 0003_policy_decision_log
Revises: 0002_customer_records
"""

from __future__ import annotations

from alembic import context, op

revision = "0003_policy_decision_log"
down_revision = "0002_customer_records"
branch_labels = None
depends_on = None

TABLE = "policy_decision_log"
APPEND_ONLY_FUNCTION = "mfk_policy_decision_log_append_only"


def _runtime_role() -> str:
    from metaframer_kernel_db.migrations import resolve_runtime_role

    return resolve_runtime_role(context.config.attributes.get("runtime_role"))


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE {TABLE} (
            id text PRIMARY KEY,
            tenant_id uuid NOT NULL,
            entry_hash text NOT NULL,
            prev_hash text,
            payload jsonb NOT NULL,
            recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            -- Canonical uppercase ULID: the top 3 bits of a 48-bit millisecond timestamp are
            -- always zero, so the first base32 character is restricted to 0-7; the remaining 25
            -- draw from the full Crockford alphabet.
            CONSTRAINT {TABLE}_id_is_ulid CHECK (id ~ '^[0-7][0-9A-HJKMNP-TV-Z]{{25}}$'),
            CONSTRAINT {TABLE}_entry_hash_is_hex64 CHECK (entry_hash ~ '^[0-9a-f]{{64}}$'),
            CONSTRAINT {TABLE}_prev_hash_is_hex64 CHECK (prev_hash IS NULL OR prev_hash ~ '^[0-9a-f]{{64}}$'),
            CONSTRAINT {TABLE}_payload_is_object CHECK (jsonb_typeof(payload) = 'object'),
            CONSTRAINT {TABLE}_no_self_link CHECK (prev_hash IS NULL OR prev_hash <> entry_hash),
            -- Every JSON binding below fails closed: a missing key, a wrong JSON type, or an
            -- unresolved comparison never yields SQL NULL, which PostgreSQL's CHECK would treat
            -- as satisfied. Each requires the key present with the expected type, then wraps the
            -- comparison in IS TRUE so anything other than an explicit match is rejected.
            CONSTRAINT {TABLE}_payload_id_matches CHECK (
                (payload ? 'id')
                AND jsonb_typeof(payload -> 'id') = 'string'
                AND (payload ->> 'id' = id) IS TRUE
            ),
            -- Genesis requires the JSON key actually present with a JSON null value (not merely
            -- absent, which would also read as JSON null through the -> operator); a successor
            -- requires the key present as a JSON string equal to the prev_hash column.
            CONSTRAINT {TABLE}_payload_prev_hash_matches CHECK (
                CASE
                    WHEN prev_hash IS NULL THEN
                        (payload ? 'prevHash') AND jsonb_typeof(payload -> 'prevHash') = 'null'
                    ELSE
                        (payload ? 'prevHash')
                        AND jsonb_typeof(payload -> 'prevHash') = 'string'
                        AND (payload ->> 'prevHash' = prev_hash) IS TRUE
                END
            ),
            CONSTRAINT {TABLE}_payload_tenant_matches CHECK (
                (payload ? 'requestActor')
                AND jsonb_typeof(payload -> 'requestActor') = 'object'
                AND (payload -> 'requestActor' ? 'tenantId')
                AND jsonb_typeof(payload #> '{{requestActor,tenantId}}') = 'string'
                AND (payload #>> '{{requestActor,tenantId}}' = tenant_id::text) IS TRUE
            ),
            CONSTRAINT {TABLE}_tenant_entry_hash_unique UNIQUE (tenant_id, entry_hash),
            CONSTRAINT {TABLE}_prev_hash_same_tenant_fk FOREIGN KEY (tenant_id, prev_hash)
                REFERENCES {TABLE} (tenant_id, entry_hash)
        )
        """
    )
    # Exactly one genesis row (prev_hash IS NULL) per tenant.
    op.execute(
        f"""
        CREATE UNIQUE INDEX {TABLE}_one_genesis_per_tenant
            ON {TABLE} (tenant_id)
            WHERE prev_hash IS NULL
        """
    )
    # At most one successor per predecessor: the chain never forks.
    op.execute(
        f"""
        CREATE UNIQUE INDEX {TABLE}_one_successor_per_predecessor
            ON {TABLE} (tenant_id, prev_hash)
            WHERE prev_hash IS NOT NULL
        """
    )
    op.execute(f"CREATE INDEX {TABLE}_tenant_recorded ON {TABLE} (tenant_id, recorded_at DESC)")

    op.execute(f"ALTER TABLE {TABLE} ENABLE ROW LEVEL SECURITY")
    # FORCE, so the owning migration role is subject to the policy too, exactly as S1 does.
    op.execute(f"ALTER TABLE {TABLE} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY {TABLE}_tenant_isolation ON {TABLE}
            FOR ALL
            USING (tenant_id = mfk_current_tenant())
            WITH CHECK (tenant_id = mfk_current_tenant())
        """
    )

    # A dedicated append-only trigger: DDL-owner and runtime role alike can neither UPDATE, DELETE
    # nor TRUNCATE, mirroring audit_log's privileged invariant for this table specifically.
    op.execute(
        f"""
        CREATE FUNCTION {APPEND_ONLY_FUNCTION}() RETURNS trigger
        LANGUAGE plpgsql AS $fn$
        BEGIN
            RAISE EXCEPTION '{TABLE} is append-only: % is not permitted', TG_OP
                USING ERRCODE = 'restrict_violation';
        END
        $fn$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER {TABLE}_append_only
            BEFORE UPDATE OR DELETE OR TRUNCATE ON {TABLE}
            FOR EACH STATEMENT EXECUTE FUNCTION {APPEND_ONLY_FUNCTION}()
        """
    )

    role = _runtime_role()
    op.execute(
        f"""
        DO $do$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = {_literal(role)}) THEN
                EXECUTE format(
                    'GRANT SELECT, INSERT ON TABLE {TABLE} TO %I', {_literal(role)}
                );
            END IF;
        END
        $do$
        """
    )


def downgrade() -> None:
    op.execute(f"DROP TRIGGER IF EXISTS {TABLE}_append_only ON {TABLE}")
    op.execute(f"DROP FUNCTION IF EXISTS {APPEND_ONLY_FUNCTION}()")
    op.execute(f"DROP TABLE IF EXISTS {TABLE}")


def _literal(value: str) -> str:
    """A single-quoted SQL literal. Role names come from configuration, never from a request."""
    escaped = value.replace("'", "''")
    return f"'{escaped}'"
