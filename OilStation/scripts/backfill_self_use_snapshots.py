#!/usr/bin/env python
"""回填自用油快照历史数据（2023-2026）"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.refresh_current_snapshots import _build_self_use_monthly_snapshot
from cache_store import set_cached

def backfill(start_year=2023, end_year=2026):
    """回填指定年份范围的自用油快照"""
    total_written = 0
    total_records = 0

    for year in range(start_year, end_year + 1):
        for month in range(1, 13):
            ym = f"{year}-{month:02d}"
            print(f"Building self_use snapshot for {ym}...")

            try:
                snapshot = _build_self_use_monthly_snapshot(ym)
                if snapshot:
                    set_cached(f"self_use:{ym}", snapshot)
                    total_records_for_month = int(snapshot.get("summary", {}).get("totalRecords") or 0)
                    print(f"  Written: {len(snapshot['records'])} records, {total_records_for_month} transactions")
                    total_written += 1
                    total_records += len(snapshot['records'])
                else:
                    print(f"  No data for {ym}")
            except Exception as e:
                print(f"  Error for {ym}: {e}")

    print(f"\nCompleted! Total snapshots written: {total_written}, Total records: {total_records}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Backfill self-use snapshots")
    parser.add_argument("--start-year", type=int, default=2023, help="Start year")
    parser.add_argument("--end-year", type=int, default=2026, help="End year")
    args = parser.parse_args()
    backfill(args.start_year, args.end_year)
