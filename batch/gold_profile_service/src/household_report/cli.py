import argparse
import json
import os

from sqlalchemy import create_engine

from gold_profile.config import get_settings
from power_silver.spark import build_session
from power_silver.storage import create_storage

from household_report.input_snapshot import load_report_input
from household_report.job import build_report
from household_report.serving import publish_report


def main(argv=None):
    parser = argparse.ArgumentParser(prog="household-report")
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build")
    build.add_argument("--input-manifest", required=True)
    build.add_argument("--partitions", type=int, default=8)
    publish = commands.add_parser("publish")
    publish.add_argument("--manifest", required=True)
    publish.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args(argv)

    settings = get_settings()
    storage = create_storage(settings)
    spark = build_session(settings)
    try:
        if args.command == "build":
            inputs = load_report_input(storage, args.input_manifest)
            manifest_path = build_report(
                inputs, spark=spark, storage=storage, partitions=args.partitions
            )
            print(
                json.dumps(
                    {
                        "status": "LAKE_COMMITTED",
                        "report_id": inputs.report_id,
                        "manifest_path": manifest_path,
                    },
                    ensure_ascii=False,
                )
            )
            return 0

        database_url = os.environ.get("REPORT_DATABASE_URL")
        if not database_url:
            raise RuntimeError("REPORT_DATABASE_URL is required for publish")
        engine = create_engine(database_url, pool_pre_ping=True)
        try:
            result = publish_report(
                engine,
                spark=spark,
                storage=storage,
                manifest_path=args.manifest,
                batch_size=args.batch_size,
            )
            print(json.dumps(result, ensure_ascii=False))
            return 0
        finally:
            engine.dispose()
    finally:
        spark.stop()


if __name__ == "__main__":
    raise SystemExit(main())
