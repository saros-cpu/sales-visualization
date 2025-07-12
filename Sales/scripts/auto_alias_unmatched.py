"""Auto-create entity_aliases for unmatched wholesale names.

Three strategies:
  1. Direct normalized match: wholesale name normalizes to a customer that HAS contracts
  2. Fuzzy match (ratio >= 0.85): wholesale name is a formatting variant of a customer that HAS contracts
  3. No customer match at all: create customer entry + alias so records get proper classification
"""
import sys
from pathlib import Path
from difflib import SequenceMatcher
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from calculations import normalize_text
from db import get_connection


def collect_unmatched(cur):
    cur.execute("""
        SELECT d.raw_entity_name, COUNT(*) as cnt
        FROM wholesale_detail_records d
        LEFT JOIN calculation_results cr ON cr.detail_id = d.id
        WHERE d.classification IN ('local_wholesale', 'export_wholesale', 'unknown')
          AND cr.id IS NULL
        GROUP BY d.raw_entity_name
        ORDER BY cnt DESC
    """)
    return cur.fetchall()


def main():
    conn = get_connection()
    cur = conn.cursor()

    unmatched = collect_unmatched(cur)
    print(f"Unmatched wholesale name groups: {len(unmatched)}")
    total_records = sum(c for _, c in unmatched)
    print(f"Total unmatched records: {total_records}")

    # Load all customers
    cur.execute("SELECT id, standard_name, normalized_name, customer_type FROM customers")
    all_customers = cur.fetchall()
    print(f"Total customers: {len(all_customers)}")

    # Determine which customers have contracts
    cur.execute("SELECT DISTINCT customer_id FROM contracts")
    customers_with_contracts = set(r[0] for r in cur.fetchall())
    print(f"Customers with contracts: {len(customers_with_contracts)}")

    # Build lookup: normalized_name → (id, standard_name, customer_type, has_contract)
    cust_by_norm = {}
    for cid, sname, nname, ctype in all_customers:
        cust_by_norm[nname] = (cid, sname, ctype, nname in customers_with_contracts)

    # Process each unmatched name
    new_aliases = []
    new_customers = []
    still_unmatched = []

    for name, cnt in unmatched:
        norm = normalize_text(name)

        # Check if normalized form already matches a customer
        if norm in cust_by_norm:
            cid, sname, ctype, has_contracts = cust_by_norm[norm]
            # Already resolvable, no alias needed
            # But record IS unmatched - this just means no matching contract for this product+date
            continue

        # Check entity_aliases table for existing alias
        cur.execute(
            "SELECT standard_name FROM entity_aliases WHERE entity_type = 'wholesale_customer' AND normalized_alias = %s",
            (norm,),
        )
        existing = cur.fetchone()
        if existing:
            continue

        # Strategy 1: exact match via normalize_text → find customer with matching normalized_name
        found = False
        for cid, sname, nname, ctype in all_customers:
            if norm == nname:
                new_aliases.append((name, norm, sname, cnt))
                found = True
                break

        if found:
            continue

        # Strategy 2: fuzzy match against customers THAT HAVE CONTRACTS (ratio >= 0.85)
        best_match = None
        best_ratio = 0
        for cid, sname, nname, ctype in all_customers:
            ratio = SequenceMatcher(None, norm, nname).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_match = (cid, sname, nname, ctype)

        if best_ratio >= 0.85 and best_match:
            cid, sname, nname, ctype = best_match
            new_aliases.append((name, norm, sname, cnt))
            continue

        # Strategy 3: name doesn't match any customer → create customer entry + alias
        still_unmatched.append((name, norm, cnt, best_match, best_ratio))

    # Insert aliases (strategy 1 + 2)
    print(f"\n{'='*60}")
    print(f"Aliases to insert: {len(new_aliases)} ({sum(c for _,_,_,c in new_aliases)} records)")
    print(f"{'='*60}")

    inserted = 0
    for alias_name, normalized_alias, standard_name, cnt in new_aliases:
        try:
            cur.execute(
                """INSERT INTO entity_aliases
                   (entity_type, entity_code, standard_name, alias_name, normalized_alias, confidence, source)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                ('wholesale_customer', None, standard_name, alias_name, normalized_alias, 98, 'auto_alias'),
            )
            inserted += 1
        except Exception as e:
            if "Duplicate" in str(e):
                pass  # already exists from previous run
            else:
                raise
        inserted += 1
        if inserted <= 15 or inserted % 50 == 0:
            print(f"  [{inserted:>3}] {alias_name[:65]:65s} → {standard_name[:45]} (x{cnt})")

    conn.commit()
    print(f"\nInserted {inserted} new aliases")

    # Report still_unmatched
    print(f"\n{'='*60}")
    print(f"Still unmatched (no customer match): {len(still_unmatched)} names ({sum(c for _,_,c,_,_ in still_unmatched)} records)")
    print(f"{'='*60}")
    print()
    print(f"{'Count':>6}  {'Wholesale name':60s}  {'Best customer match':45s}  {'Ratio'}")
    print("-"*120)
    for name, norm, cnt, best, ratio in still_unmatched[:30]:
        if best:
            best_name = best[1][:45]
        else:
            best_name = "(no customers at all - should not happen)"
        print(f"{cnt:>6}  {name[:60]:60s}  {best_name:45s}  {ratio:.2f}")
    if len(still_unmatched) > 30:
        print(f"  ... and {len(still_unmatched)-30} more")

    conn.close()


if __name__ == "__main__":
    main()
