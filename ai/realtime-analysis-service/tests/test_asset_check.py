from pathlib import Path
import pytest
from realtime_analysis.asset_check import verify


def test_minimal_asset_bundles_match_lock():
    root = Path(__file__).resolve().parents[2] / 'assets/nilm_r3'
    if not root.exists(): pytest.skip('Assets are outside service-only build context')
    assert verify(root)['asset_files'] == 7
    assert verify(root, panels=True)['asset_files'] == 6


def test_missing_assets_never_pass(tmp_path):
    with pytest.raises(FileNotFoundError): verify(tmp_path)
