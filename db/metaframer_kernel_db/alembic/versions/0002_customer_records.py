"""GJ-01 customer records: the first tenant-owned domain table.

Adds ``customer_records``, the table GJ-01's ``customer.create`` writes to. It reuses the same
tenant-isolation mechanism 0001 established — FORCE row-level security keyed off
``mfk_current_tenant()`` — rather than inventing a second one. It is a second revision, not a
rewrite of 0001, because the runtime substrate and this domain table are independently meaningful:
either can be rolled back without disturbing the other.

The downgrade drops only what this revision created.

Revision ID: 0002_customer_records
Revises: 0001_runtime_substrate
"""

from __future__ import annotations

from alembic import context, op

revision = "0002_customer_records"
down_revision = "0001_runtime_substrate"
branch_labels = None
depends_on = None

CUSTOMER_TABLE = "customer_records"


def _runtime_role() -> str:
    from metaframer_kernel_db.migrations import resolve_runtime_role

    return resolve_runtime_role(context.config.attributes.get("runtime_role"))


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE {CUSTOMER_TABLE} (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL,
            name text NOT NULL,
            payload jsonb NOT NULL DEFAULT '{{}}'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now(),
            recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            CONSTRAINT {CUSTOMER_TABLE}_name_present CHECK (btrim(name) <> ''),
            CONSTRAINT {CUSTOMER_TABLE}_payload_is_object CHECK (jsonb_typeof(payload) = 'object')
        )
        """
    )
    op.execute(
        f"CREATE INDEX {CUSTOMER_TABLE}_tenant_recorded ON {CUSTOMER_TABLE} (tenant_id, recorded_at DESC)"
    )

    op.execute(f"ALTER TABLE {CUSTOMER_TABLE} ENABLE ROW LEVEL SECURITY")
    # FORCE, so the owning migration role is subject to the policy too, exactly as 0001 does for
    # the runtime tables.
    op.execute(f"ALTER TABLE {CUSTOMER_TABLE} FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY {CUSTOMER_TABLE}_tenant_isolation ON {CUSTOMER_TABLE}
            FOR ALL
            USING (tenant_id = mfk_current_tenant())
            WITH CHECK (tenant_id = mfk_current_tenant())
        """
    )

    # The runtime role reads and writes rows; it never gets DDL or control-plane access, matching
    # the grant shape 0001 established for the runtime tables.
    role = _runtime_role()
    op.execute(
        f"""
        DO $do$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = {_literal(role)}) THEN
                EXECUTE format(
                    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {CUSTOMER_TABLE} TO %I',
                    {_literal(role)}
                );
            END IF;
        END
        $do$
        """
    )


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {CUSTOMER_TABLE}")


def _literal(value: str) -> str:
    """A single-quoted SQL literal. Role names come from configuration, never from a request."""
    escaped = value.replace("'", "''")
    return f"'{escaped}'"
