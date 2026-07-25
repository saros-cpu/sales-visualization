import sys
import unittest
from pathlib import Path

from openpyxl import Workbook


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OILSTATION_ROOT = PROJECT_ROOT / "OilStation"
if str(OILSTATION_ROOT) not in sys.path:
    sys.path.insert(0, str(OILSTATION_ROOT))

from constants import REPORT_HIDDEN_STATION_NOTE
from endpoints.v1.retail.export.service import generator


class RetailReportHiddenStationsTests(unittest.TestCase):
    def test_summary_blocks_hide_closed_station_rows_and_keep_bottom_note(self):
        wb = Workbook()
        ws = wb.active

        total_row = generator._write_summary_blocks(
            ws,
            [10, 11, 12, 13, 21],
            {},
            {},
            {},
            {},
            {},
            {},
            {},
            "总合计",
        )

        self.assertFalse(bool(ws.row_dimensions[5].hidden))
        self.assertTrue(all(ws.row_dimensions[row].hidden for row in range(11, 17)))
        self.assertTrue(all(ws.row_dimensions[row].hidden for row in range(17, 23)))
        self.assertFalse(bool(ws.row_dimensions[23].hidden))
        self.assertTrue(all(ws.row_dimensions[row].hidden for row in range(29, 35)))
        self.assertEqual(ws.cell(row=total_row + 1, column=1).value, REPORT_HIDDEN_STATION_NOTE)


if __name__ == "__main__":
    unittest.main()
