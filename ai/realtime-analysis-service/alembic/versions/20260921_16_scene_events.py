"""Isolated scene usage, projection checkpoint and transactional outbox."""
from alembic import op
import sqlalchemy as sa

revision = '20260921_16'
down_revision = '20260921_15'
branch_labels = depends_on = None


def scope():
    return [sa.Column('household_id', sa.String(50), nullable=False),
            sa.Column('run_id', sa.String(100), nullable=False),
            sa.Column('profile_id', sa.String(100), nullable=False)]


def upgrade():
    op.create_table('selected_scene_projection', *scope(), sa.Column('state', sa.JSON(), nullable=False),
                    sa.PrimaryKeyConstraint('household_id', 'run_id', 'profile_id'))
    op.create_table('selected_scene_usage', sa.Column('session_id', sa.String(36), primary_key=True),
                    *scope(), sa.Column('payload', sa.JSON(), nullable=False))
    op.create_table('selected_scene_outbox', sa.Column('sequence', sa.Integer(), primary_key=True, autoincrement=True),
                    sa.Column('event_id', sa.String(36), nullable=False, unique=True), *scope(),
                    sa.Column('topic', sa.String(100), nullable=False), sa.Column('payload', sa.JSON(), nullable=False),
                    sa.Column('published', sa.Boolean(), nullable=False))
    op.create_index('ix_scene_outbox_pending', 'selected_scene_outbox', ['household_id', 'run_id', 'profile_id', 'published', 'sequence'])


def downgrade():
    op.drop_table('selected_scene_outbox')
    op.drop_table('selected_scene_usage')
    op.drop_table('selected_scene_projection')
