"""Verify the minimal runtime or publisher image assets against the frozen lock."""
import argparse
import json
from pathlib import Path
from realtime_analysis.real_predictor import MODEL_DIRECTORY, load_profile, verified_asset
from realtime_analysis.predictor import APPLIANCE_ORDER


def verify(root, panels=False):
    files = set()
    for name in APPLIANCE_ORDER:
        p = load_profile(name)
        fields = [('panel_relative', 'panel_sha256')] if panels else [
            ('local_checkpoint_relative', 'checkpoint_sha256'), ('normalization_relative', 'normalization_sha256')]
        for path, digest in fields:
            verified_asset(Path(root), p[path], p[digest]); files.add(p[path])
        verified_asset(MODEL_DIRECTORY, 'models.py', p['model_code_sha256'])
    return {'status': 'MATCH', 'profiles': 6, 'asset_files': len(files), 'panels': panels}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--asset-root', type=Path, required=True)
    parser.add_argument('--panels', action='store_true')
    args=parser.parse_args()
    print(json.dumps(verify(args.asset_root, args.panels)))


if __name__ == '__main__': main()
