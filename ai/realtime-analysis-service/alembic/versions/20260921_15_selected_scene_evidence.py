"""Durable selected-scene output and window checkpoints."""
from alembic import op
import sqlalchemy as sa

revision = "20260921_15"
down_revision = "20260920_14"
branch_labels = depends_on = None


def upgrade():
    op.create_table("selected_scene_evidence",
        sa.Column("household_id", sa.String(50), primary_key=True),
        sa.Column("run_id", sa.String(100), primary_key=True),
        sa.Column("profile_id", sa.String(100), primary_key=True),
        sa.Column("source_index", sa.BigInteger(), primary_key=True),
        sa.Column("input_sha256", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("checkpoint", sa.JSON(), nullable=False))


def downgrade():
    op.drop_table("selected_scene_evidence")
