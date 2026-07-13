import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SALES_ROOT = PROJECT_ROOT / "Sales"
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from api_v2.transfer_loss import _merge_transfer_loss_years  # noqa: E402


class TransferLossYearsTests(unittest.TestCase):
    def test_merge_transfer_loss_years_uses_only_actual_source_years(self):
        self.assertEqual(
            _merge_transfer_loss_years([2026, "2025", 2026], [2024, None, "bad", 1999]),
            [2026, 2025, 2024],
        )


if __name__ == "__main__":
    unittest.main()
