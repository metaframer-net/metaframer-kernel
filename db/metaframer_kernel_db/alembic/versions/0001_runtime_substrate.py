"""MetaFramer Kernel runtime substrate baseline.

One cohesive revision creating the entire substrate: the per-database context key, the two
tenant-owned runtime tables under FORCE row-level security, the attestation functions that make a
tenant context trustworthy, the append-only invariant on the audit trail, and the runtime grants.

It is one revision because the parts are not independently meaningful. A table without its policy
is an isolation hole; a policy without its attestation functions is advisory; an audit table
without its trigger is merely inconvenient to tamper with. Splitting them would create
intermediate states that are worse than either end.

The downgrade removes only what this revision created. The ``pgcrypto`` extension is deliberately
left in place: it is a database-level object that other users may share, and dropping something
this package does not own would be the opposite of a clean rollback.

Revision ID: 0001_runtime_substrate
Revises:
"""

from __future__ import annotations

from alembic import context, op

revision = "0001_runtime_substrate"
down_revision = None
branch_labels = None
depends_on = None

TENANT_SETTING = "mfk.tenant_id"
ATTESTATION_SETTING = "mfk.tenant_attestation"
OUTBOX_TABLE = "transactional_outbox"
AUDIT_TABLE = "audit_log"
CONTEXT_KEY_TABLE = "mfk_context_key"


def _runtime_role() -> str:
    from metaframer_kernel_db.migrations import resolve_runtime_role

    return resolve_runtime_role(context.config.attributes.get("runtime_role"))


def upgrade() -> None:
    # pgcrypto is a trusted extension from PostgreSQL 13 onward, so the database owner can create
    # it without a superuser. It supplies gen_random_bytes and hmac.
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    # --- the per-database signing secret ------------------------------------------------------
    # Generated here, inside the migration, so it exists once per database and never in version
    # control. The runtime role is granted nothing on this table, so it cannot read the key and
    # therefore cannot compute an attestation.
    op.execute(
        f"""
        CREATE TABLE {CONTEXT_KEY_TABLE} (
            id smallint PRIMARY KEY DEFAULT 1,
            secret bytea NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT {CONTEXT_KEY_TABLE}_singleton CHECK (id = 1),
            CONSTRAINT {CONTEXT_KEY_TABLE}_secret_length CHECK (octet_length(secret) >= 32)
        )
        """
    )
    op.execute(f"REVOKE ALL ON TABLE {CONTEXT_KEY_TABLE} FROM PUBLIC")
    op.execute(f"INSERT INTO {CONTEXT_KEY_TABLE} (id, secret) VALUES (1, gen_random_bytes(32))")

    # --- runtime table 1: the transactional outbox --------------------------------------------
    op.execute(
        f"""
        CREATE TABLE {OUTBOX_TABLE} (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            event_type text NOT NULL,
            event_version integer NOT NULL DEFAULT 1,
            payload jsonb NOT NULL DEFAULT '{{}}'::jsonb,
            dedup_key text,
            correlation_id uuid,
            causation_id uuid,
            actor_id text,
            occurred_at timestamptz NOT NULL DEFAULT now(),
            recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            available_at timestamptz NOT NULL DEFAULT now(),
            claim_token uuid,
            claimed_at timestamptz,
            claim_expires_at timestamptz,
            attempts integer NOT NULL DEFAULT 0,
            published_at timestamptz,
            CONSTRAINT {OUTBOX_TABLE}_event_type_present CHECK (btrim(event_type) <> ''),
            CONSTRAINT {OUTBOX_TABLE}_event_version_positive CHECK (event_version >= 1),
            CONSTRAINT {OUTBOX_TABLE}_attempts_non_negative CHECK (attempts >= 0),
            CONSTRAINT {OUTBOX_TABLE}_payload_is_object CHECK (jsonb_typeof(payload) = 'object'),
            -- A claim is all three fields or none of them; a half-claimed row is not a state.
            CONSTRAINT {OUTBOX_TABLE}_claim_coherent CHECK (
                (claimed_at IS NULL AND claim_token IS NULL AND claim_expires_at IS NULL)
                OR (claimed_at IS NOT NULL AND claim_token IS NOT NULL AND claim_expires_at IS NOT NULL)
            ),
            CONSTRAINT {OUTBOX_TABLE}_published_implies_claimed CHECK (
                published_at IS NULL OR claimed_at IS NOT NULL
            )
        )
        """
    )
    # Idempotency, scoped per tenant and only where a caller actually supplied a key.
    op.execute(
        f"""
        CREATE UNIQUE INDEX {OUTBOX_TABLE}_tenant_dedup_key
            ON {OUTBOX_TABLE} (tenant_id, dedup_key)
            WHERE dedup_key IS NOT NULL
        """
    )
    # The two arms of the claim predicate, each with its own partial index. Both predicates use
    # only IS NULL / IS NOT NULL, so they are immutable and the indexes stay valid — a predicate
    # mentioning now() would not be allowed here and would silently rot if it were.
    #
    # Arm one, the hot path: rows never claimed. Ordered exactly as the claim query orders them.
    op.execute(
        f"""
        CREATE INDEX {OUTBOX_TABLE}_unclaimed
            ON {OUTBOX_TABLE} (tenant_id, available_at, recorded_at, id)
            WHERE claimed_at IS NULL AND published_at IS NULL
        """
    )
    # Arm two, the recovery path: rows claimed but not published, sought by lease expiry.
    op.execute(
        f"""
        CREATE INDEX {OUTBOX_TABLE}_expired_claims
            ON {OUTBOX_TABLE} (tenant_id, claim_expires_at, available_at, recorded_at, id)
            WHERE claimed_at IS NOT NULL AND published_at IS NULL
        """
    )
    op.execute(
        f"CREATE INDEX {OUTBOX_TABLE}_tenant_recorded ON {OUTBOX_TABLE} (tenant_id, recorded_at DESC)"
    )

    # --- runtime table 2: the append-only audit trail ------------------------------------------
    op.execute(
        f"""
        CREATE TABLE {AUDIT_TABLE} (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            event_type text NOT NULL,
            event_ref uuid,
            actor_id text,
            correlation_id uuid,
            details jsonb NOT NULL DEFAULT '{{}}'::jsonb,
            occurred_at timestamptz NOT NULL DEFAULT now(),
            recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            CONSTRAINT {AUDIT_TABLE}_event_type_present CHECK (btrim(event_type) <> ''),
            CONSTRAINT {AUDIT_TABLE}_details_is_object CHECK (jsonb_typeof(details) = 'object')
        )
        """
    )
    op.execute(
        f"CREATE INDEX {AUDIT_TABLE}_tenant_recorded ON {AUDIT_TABLE} (tenant_id, recorded_at DESC)"
    )
    op.execute(
        f"""
        CREATE INDEX {AUDIT_TABLE}_tenant_event_ref
            ON {AUDIT_TABLE} (tenant_id, event_ref)
            WHERE event_ref IS NOT NULL
        """
    )

    # --- the attestation ------------------------------------------------------------------------
    # Who owns these objects. Used to recognise the administrative identity, which is already
    # total and gains nothing from being asked for an attestation.
    op.execute(
        """
        CREATE FUNCTION mfk_object_owner() RETURNS name
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
            SELECT pg_get_userbyid(c.relowner)
            FROM pg_class c
            WHERE c.oid = to_regclass('public.audit_log')
        $fn$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION mfk_object_owner() FROM PUBLIC")

    # The signature itself. Bound to the transaction id as well as the tenant, so an attestation
    # minted in one transaction is worthless in the next — the context is transaction-local by
    # construction, not by convention. Executable by nobody but the owner: a runtime role able to
    # call this could mint its own attestation and the whole scheme would be decorative.
    op.execute(
        """
        CREATE FUNCTION mfk_attestation(p_tenant uuid, p_xid text) RETURNS text
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
            -- convert_to keeps this on pgcrypto's hmac(bytea, bytea, text) overload; passing the
            -- message as text would silently need a text key, which is not what is stored.
            SELECT encode(
                hmac(convert_to(p_tenant::text || ':' || p_xid, 'UTF8'), k.secret, 'sha256'),
                'hex'
            )
            FROM mfk_context_key k
            WHERE k.id = 1
        $fn$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION mfk_attestation(uuid, text) FROM PUBLIC")

    # The controlled entry point. This is the only way to obtain a usable tenant context.
    op.execute(
        f"""
        CREATE FUNCTION mfk_begin_tenant_context(p_tenant uuid) RETURNS text
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
        DECLARE
            v_attestation text;
        BEGIN
            IF p_tenant IS NULL THEN
                RAISE EXCEPTION 'a tenant identity is required'
                    USING ERRCODE = 'invalid_parameter_value';
            END IF;
            v_attestation := mfk_attestation(p_tenant, pg_current_xact_id()::text);
            PERFORM set_config('{TENANT_SETTING}', p_tenant::text, true);
            PERFORM set_config('{ATTESTATION_SETTING}', v_attestation, true);
            RETURN v_attestation;
        END
        $fn$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION mfk_begin_tenant_context(uuid) FROM PUBLIC")

    # What the policy consults. Returns NULL — and therefore denies, since `tenant_id = NULL` is
    # never true — for a missing, blank, malformed or unattested context.
    op.execute(
        f"""
        CREATE FUNCTION mfk_current_tenant() RETURNS uuid
        LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
        DECLARE
            v_raw text := current_setting('{TENANT_SETTING}', true);
            v_attestation text := current_setting('{ATTESTATION_SETTING}', true);
            v_xid text;
            v_tenant uuid;
        BEGIN
            IF v_raw IS NULL OR btrim(v_raw) = '' THEN
                RETURN NULL;
            END IF;
            BEGIN
                v_tenant := v_raw::uuid;
            EXCEPTION WHEN others THEN
                RETURN NULL;
            END;

            -- The owner of these objects can drop them outright; requiring a signature from it
            -- would buy nothing. It stays fully subject to the tenant filter below.
            IF session_user = mfk_object_owner() THEN
                RETURN v_tenant;
            END IF;

            IF v_attestation IS NULL OR btrim(v_attestation) = '' THEN
                RETURN NULL;
            END IF;
            v_xid := pg_current_xact_id_if_assigned()::text;
            IF v_xid IS NULL THEN
                RETURN NULL;
            END IF;
            IF v_attestation <> mfk_attestation(v_tenant, v_xid) THEN
                RETURN NULL;
            END IF;
            RETURN v_tenant;
        END
        $fn$
        """
    )

    # --- row-level security on every runtime table ----------------------------------------------
    for table in (OUTBOX_TABLE, AUDIT_TABLE):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        # FORCE, so the owner is subject to the policy too. Without it, anything running as the
        # migration role would quietly see every tenant.
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY {table}_tenant_isolation ON {table}
                FOR ALL
                USING (tenant_id = mfk_current_tenant())
                WITH CHECK (tenant_id = mfk_current_tenant())
            """
        )

    # --- the append-only invariant ---------------------------------------------------------------
    # Revoking UPDATE and DELETE from the runtime role is necessary but not sufficient: the owner
    # keeps them. A statement-level trigger closes that gap, and fires even when the statement
    # would have matched no rows, so "no rows visible" can never be mistaken for "not permitted".
    op.execute(
        f"""
        CREATE FUNCTION mfk_audit_append_only() RETURNS trigger
        LANGUAGE plpgsql AS $fn$
        BEGIN
            RAISE EXCEPTION '{AUDIT_TABLE} is append-only: % is not permitted', TG_OP
                USING ERRCODE = 'restrict_violation';
        END
        $fn$
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER {AUDIT_TABLE}_append_only
            BEFORE UPDATE OR DELETE OR TRUNCATE ON {AUDIT_TABLE}
            FOR EACH STATEMENT EXECUTE FUNCTION mfk_audit_append_only()
        """
    )

    # --- runtime grants ---------------------------------------------------------------------------
    # The runtime role reads and writes rows and may claim outbox rows; it may never perform DDL,
    # never touch the context key, and never rewrite history.
    role = _runtime_role()
    op.execute(
        f"""
        DO $do$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = {_literal(role)}) THEN
                EXECUTE format(
                    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {OUTBOX_TABLE} TO %I', {_literal(role)}
                );
                EXECUTE format('GRANT SELECT, INSERT ON TABLE {AUDIT_TABLE} TO %I', {_literal(role)});
                EXECUTE format(
                    'GRANT EXECUTE ON FUNCTION mfk_begin_tenant_context(uuid) TO %I', {_literal(role)}
                );
            END IF;
        END
        $do$
        """
    )


def downgrade() -> None:
    role = _runtime_role()
    op.execute(
        f"""
        DO $do$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = {_literal(role)}) THEN
                EXECUTE format(
                    'REVOKE ALL ON FUNCTION mfk_begin_tenant_context(uuid) FROM %I', {_literal(role)}
                );
            END IF;
        END
        $do$
        """
    )
    op.execute(f"DROP TRIGGER IF EXISTS {AUDIT_TABLE}_append_only ON {AUDIT_TABLE}")
    op.execute("DROP FUNCTION IF EXISTS mfk_audit_append_only()")
    # Policies and indexes go with their tables.
    op.execute(f"DROP TABLE IF EXISTS {AUDIT_TABLE}")
    op.execute(f"DROP TABLE IF EXISTS {OUTBOX_TABLE}")
    op.execute("DROP FUNCTION IF EXISTS mfk_current_tenant()")
    op.execute("DROP FUNCTION IF EXISTS mfk_begin_tenant_context(uuid)")
    op.execute("DROP FUNCTION IF EXISTS mfk_attestation(uuid, text)")
    op.execute("DROP FUNCTION IF EXISTS mfk_object_owner()")
    op.execute(f"DROP TABLE IF EXISTS {CONTEXT_KEY_TABLE}")
    # pgcrypto is intentionally left alone: it is a shared database-level object this package does
    # not own, and dropping it could break unrelated users of the same database.


def _literal(value: str) -> str:
    """A single-quoted SQL literal. Role names come from configuration, never from a request."""
    escaped = value.replace("'", "''")
    return f"'{escaped}'"
