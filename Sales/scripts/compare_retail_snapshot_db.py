import argparse
import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OILSTATION_ROOT = PROJECT_ROOT / "OilStation"
sys.path.insert(0, str(OILSTATION_ROOT))

from business_time import business_period_condition_with_pruning, business_period_params, shift_join  # noqa: E402
from constants import SHOP_KEY_MAP  # noqa: E402
from db import get_connection  # noqa: E402
from routes.analytics import (  # noqa: E402
    report_amount_expr,
    report_bonus_amount_expr,
    report_card_amount_expr,
    report_card_volume_expr,
    report_cash_amount_expr,
    report_cash_volume_expr,
    report_mass_expr,
    report_resource_key_expr,
    report_volume_expr,
)


def _load_snapshot(day):
    year, month, _ = day.split("-")
    path = OILSTATION_ROOT / "cache_snapshots" / "daily" / year / month / f"day_{int(day.split('-')[-1]):02d}.json"
    if not path.exists():
        raise SystemExit(f"missing snapshot: {path}")
    return json.loads(path.read_text(encoding="utf-8-sig"))


def _db_station_totals(start, end):
    condition = business_period_condition_with_pruning("s", "sh")
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT s.ShopKey,
                   COUNT(*) AS txn_count,
                   {report_volume_expr("s")} AS total_volume,
                   {report_amount_expr("s")} AS total_amount,
                   {report_mass_expr("s", start)} AS total_mass,
                   {report_cash_volume_expr("s")} AS cash_volume,
                   {report_cash_amount_expr("s")} AS cash_amount,
                   {report_card_volume_expr("s")} AS card_volume,
                   {report_card_amount_expr("s")} AS card_amount,
                   {report_bonus_amount_expr("s")} AS bonus_amount
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {condition}
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY s.ShopKey
            ORDER BY s.ShopKey
            """,
            business_period_params(start, end),
        )
        return {int(row[0]): row for row in cur.fetchall()}
    finally:
        conn.close()


def _db_station_resources(start, end, shop_key):
    condition = business_period_condition_with_pruning("s", "sh")
    resource_key = report_resource_key_expr("s")
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT {resource_key} AS resource_key,
                   COUNT(*) AS txn_count,
                   {report_volume_expr("s")} AS total_volume,
                   {report_amount_expr("s")} AS total_amount,
                   {report_mass_expr("s", start)} AS total_mass,
                   {report_cash_volume_expr("s")} AS cash_volume,
                   {report_cash_amount_expr("s")} AS cash_amount,
                   {report_card_volume_expr("s")} AS card_volume,
                   {report_card_amount_expr("s")} AS card_amount,
                   {report_bonus_amount_expr("s")} AS bonus_amount,
                   MIN(s.TransactionDatetime),
                   MAX(s.TransactionDatetime)
            FROM selling s
            {shift_join("s", "sh")}
            WHERE {condition}
              AND s.ShopKey = %s
              AND (s.DerivedPaymentTypeKey IS NULL OR s.DerivedPaymentTypeKey NOT IN (2, 4))
            GROUP BY resource_key
            ORDER BY resource_key
            """,
            (*business_period_params(start, end), int(shop_key)),
        )
        return cur.fetchall()
    finally:
        conn.close()


def _raw_station_activity(day, shop_key):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                DATE(s.TransactionDatetime) AS tx_date,
                s.ShopKey,
                COUNT(*) AS rows_count,
                SUM(COALESCE(s.Volume, 0)) AS raw_liters,
                SUM(COALESCE(s.ShopCost, 0)) AS raw_kgs,
                MIN(s.TransactionDatetime),
                MAX(s.TransactionDatetime),
                SUM(CASE WHEN sh.DatetimeShiftEnd IS NULL THEN 1 ELSE 0 END) AS open_shift_rows,
                MIN(sh.DatetimeShiftBegin),
                MAX(sh.DatetimeShiftEnd)
            FROM selling s
            LEFT JOIN shift sh
              ON sh.ShopKey = s.ShopKey
             AND sh.ShiftKey = s.ShiftKey
            WHERE s.ShopKey = %s
              AND s.TransactionDatetime >= DATE_SUB(%s, INTERVAL 1 DAY)
              AND s.TransactionDatetime < DATE_ADD(%s, INTERVAL 2 DAY)
            GROUP BY DATE(s.TransactionDatetime), s.ShopKey
            ORDER BY tx_date
            """,
            (int(shop_key), day, day),
        )
        return cur.fetchall()
    finally:
        conn.close()


def _business_day_activity(day, shop_key):
    conn = get_connection()
    try:
        cur = conn.cursor()
        business_day = (
            "CASE "
            "WHEN sh.DatetimeShiftBegin IS NOT NULL "
            "AND sh.DatetimeShiftEnd IS NOT NULL "
            "AND DATE(sh.DatetimeShiftBegin) <> DATE(sh.DatetimeShiftEnd) "
            "AND TIME(sh.DatetimeShiftBegin) >= '18:00:00' "
            "THEN DATE(sh.DatetimeShiftEnd) "
            "WHEN sh.DatetimeShiftBegin IS NOT NULL "
            "THEN DATE(sh.DatetimeShiftBegin) "
            "ELSE DATE(s.TransactionDatetime) "
            "END"
        )
        cur.execute(
            f"""
            SELECT
                {business_day} AS business_day,
                s.ShopKey,
                COUNT(*) AS rows_count,
                {report_volume_expr("s")} AS report_liters,
                   {report_amount_expr("s")} AS report_amount,
                   {report_mass_expr("s", day)} AS report_mass,
                   MIN(s.TransactionDatetime),
                   MAX(s.TransactionDatetime),
                MIN(sh.DatetimeShiftBegin),
                MAX(sh.DatetimeShiftEnd)
            FROM selling s
            LEFT JOIN shift sh
              ON sh.ShopKey = s.ShopKey
             AND sh.ShiftKey = s.ShiftKey
            WHERE s.ShopKey = %s
              AND s.TransactionDatetime >= DATE_SUB(%s, INTERVAL 1 DAY)
              AND s.TransactionDatetime < DATE_ADD(%s, INTERVAL 3 DAY)
            GROUP BY business_day, s.ShopKey
            ORDER BY business_day
            """,
            (int(shop_key), day, day),
        )
        return cur.fetchall()
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Compare retail day snapshot with database totals.")
    parser.add_argument("--day", required=True, help="Business date, e.g. 2026-06-01")
    parser.add_argument("--focus-shop", type=int, default=14)
    parser.add_argument("--json-output", help="Optional path for structured mismatch report.")
    args = parser.parse_args()

    day = args.day
    start = day
    end = f"{day[:8]}{int(day[-2:]) + 1:02d}"
    snapshot = _load_snapshot(day)
    snapshot_map = {int(item["shopKey"]): item for item in snapshot.get("stations") or []}
    db_rows = _db_station_totals(start, end)

    print(f"{day} database vs daily snapshot")
    print("ShopKey\tStation\tDB_L\tSnap_L\tDiff_L\tDB_KG\tSnap_KG\tDiff_KG\tDB_SOM\tSnap_SOM\tDiff_SOM\tDB_Card_SOM\tSnap_Card_SOM")
    mismatch_count = 0
    mismatch_rows = []
    for shop_key in sorted(SHOP_KEY_MAP):
        row = db_rows.get(shop_key)
        db_volume = float(row[2] or 0) if row else 0.0
        db_amount = float(row[3] or 0) if row else 0.0
        db_mass = float(row[4] or 0) if row else 0.0
        db_card = float(row[8] or 0) if row else 0.0
        snap_item = snapshot_map.get(shop_key) or {}
        snap_volume = float(snap_item.get("volume") or 0)
        snap_amount = float(snap_item.get("amount") or 0)
        snap_mass = float(snap_item.get("mass") or 0)
        if not snap_mass and snap_item.get("tons"):
            snap_mass = float(snap_item.get("tons") or 0) * 1000
        snap_card = float(snap_item.get("card") or 0)
        diff_volume = db_volume - snap_volume
        diff_amount = db_amount - snap_amount
        diff_mass = db_mass - snap_mass
        is_mismatch = abs(diff_volume) > 0.01 or abs(diff_amount) > 1 or abs(diff_mass) > 0.05
        if is_mismatch:
            mismatch_count += 1
            mismatch_rows.append({
                "shopKey": shop_key,
                "station": SHOP_KEY_MAP[shop_key]["name"],
                "diffVolume": round(diff_volume, 3),
                "diffMassKg": round(diff_mass, 3),
                "diffAmount": round(diff_amount, 2),
            })
        if is_mismatch or shop_key == args.focus_shop:
            print(
                f"{shop_key}\t{SHOP_KEY_MAP[shop_key]['name']}\t"
                f"{db_volume:.2f}\t{snap_volume:.2f}\t{diff_volume:.2f}\t"
                f"{db_mass:.3f}\t{snap_mass:.3f}\t{diff_mass:.3f}\t"
                f"{db_amount:.2f}\t{snap_amount:.2f}\t{diff_amount:.2f}\t"
                f"{db_card:.2f}\t{snap_card:.2f}"
            )

    print(f"\nMismatched stations: {mismatch_count}")
    print(f"\nShop {args.focus_shop} database resource detail")
    print("Resource\tTxn\tLiters\tAmount_SOM\tMass_KG\tCash_L\tCash_SOM\tCard_L\tCard_SOM\tBonus_SOM\tMinTime\tMaxTime")
    resource_rows = _db_station_resources(start, end, args.focus_shop)
    for row in resource_rows:
        print("\t".join("" if value is None else str(value) for value in row))

    print(f"\nShop {args.focus_shop} raw transaction-date activity")
    print("TxDate\tShopKey\tRows\tRaw_L\tRaw_KGS\tMinTx\tMaxTx\tOpenShiftRows\tMinShiftBegin\tMaxShiftEnd")
    for row in _raw_station_activity(day, args.focus_shop):
        print("\t".join("" if value is None else str(value) for value in row))

    print(f"\nShop {args.focus_shop} business-day activity without completed-shift filter")
    print("BusinessDay\tShopKey\tRows\tReport_L\tReport_SOM\tReport_KG\tMinTx\tMaxTx\tMinShiftBegin\tMaxShiftEnd")
    business_rows = _business_day_activity(day, args.focus_shop)
    for row in business_rows:
        print("\t".join("" if value is None else str(value) for value in row))

    if args.json_output:
        payload = {
            "day": day,
            "focusShop": args.focus_shop,
            "mismatchCount": mismatch_count,
            "mismatches": mismatch_rows,
            "focusResources": [list(row) for row in resource_rows],
            "businessDayActivity": [list(row) for row in business_rows],
        }
        output_path = Path(args.json_output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        print(f"\nJSON mismatch report: {output_path}")


if __name__ == "__main__":
    main()
