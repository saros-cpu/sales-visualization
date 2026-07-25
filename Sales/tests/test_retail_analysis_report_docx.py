import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


PROJECT_ROOT = Path(__file__).resolve().parents[2]
OILSTATION_ROOT = PROJECT_ROOT / "OilStation"
if str(OILSTATION_ROOT) not in sys.path:
    sys.path.insert(0, str(OILSTATION_ROOT))

from endpoints.v1.retail.analysis_report.service import docx as analysis_docx
from constants import REPORT_HIDDEN_STATION_NOTE


class RetailAnalysisReportDocxTests(unittest.TestCase):
    def test_monthly_report_writer_creates_files_and_download_urls(self):
        data = {
            "kind": "monthly",
            "title": "analysis-report-regression",
            "periodLabel": "2026-07",
            "month": 7,
            "queryStart": "2026-07-01",
            "queryEndExclusive": "2026-08-01",
            "summary": {
                "totalSales": 129.022,
                "totalLiters": 100,
                "totalTons": 0.08,
                "cashSales": 0,
                "cardSales": 129.022,
                "endInventory": 0,
                "endInventoryTons": 0,
                "contractVolume": 0,
            },
            "resources": [
                {"name": "АИ 80", "volume": 40, "amount": 64.511, "color": "#1e8bc3"},
                {"name": "Д/Т", "volume": 60, "amount": 64.511, "color": "#27ae60"},
            ],
            "regions": [],
            "stations": [],
            "comparison": {
                "momSales": 0,
                "momVolume": 0,
                "momCash": 0,
                "momCard": 0,
                "yoySales": 0,
                "yoyVolume": 0,
                "yoyCash": 0,
                "yoyCard": 0,
                "prevLabel": "2026-06",
                "yoyLabel": "2025-07",
            },
            "exchangeRates": {},
        }

        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(analysis_docx, "EXPORT_DIR", Path(tmp)),
                patch.object(
                    analysis_docx,
                    "_exchange_rates_for_period",
                    return_value={"avgCny": 12.9022, "avgUsd": 87.45, "count": 31, "totalDays": 31, "rows": []},
                ),
                patch.object(analysis_docx, "_attach_report_extras", side_effect=lambda value: value),
            ):
                files = analysis_docx._write_reports(data)

            self.assertEqual(files["htmlFile"], "analysis-report-regression.html")
            self.assertIn("/api/export/analysis/download/", files["docxDownloadUrl"])

            with zipfile.ZipFile(Path(tmp) / files["docxFile"]) as package:
                self.assertIn("[Content_Types].xml", package.namelist())
                self.assertIn("_rels/.rels", package.namelist())
                self.assertIn("word/document.xml", package.namelist())
                document_xml = package.read("word/document.xml").decode("utf-8")

            html = (Path(tmp) / files["htmlFile"]).read_text(encoding="utf-8")

            self.assertIn("折算人民币", html)
            self.assertIn("10.00", html)
            self.assertIn("折算人民币", document_xml)
            self.assertIn("10.00", document_xml)

    def test_analysis_report_uses_operating_station_wording_and_hides_closed_stations(self):
        data = {
            "kind": "monthly",
            "title": "analysis-report-hidden-stations",
            "periodLabel": "2026-07",
            "month": 7,
            "queryStart": "2026-07-01",
            "queryEndExclusive": "2026-08-01",
            "summary": {
                "totalSales": 1010,
                "totalLiters": 100,
                "totalTons": 0.08,
                "cashSales": 10,
                "cardSales": 1000,
                "endInventory": 0,
                "endInventoryTons": 0,
                "contractVolume": 0,
            },
            "resources": [{"name": "АИ 92", "volume": 100, "amount": 1010, "color": "#1e8bc3"}],
            "regions": [],
            "stations": [
                {"shopKey": 1, "name": "在营站", "short": "Open", "region": "REG-01", "volume": 10, "amount": 10},
                {"shopKey": 11, "name": "STN-21", "short": "S-22", "region": "REG-02", "volume": 90, "amount": 1000},
            ],
            "comparison": {
                "momSales": 0,
                "momVolume": 0,
                "momCash": 0,
                "momCard": 0,
                "yoySales": 0,
                "yoyVolume": 0,
                "yoyCash": 0,
                "yoyCard": 0,
            },
            "exchangeRates": {},
        }

        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(analysis_docx, "EXPORT_DIR", Path(tmp)),
                patch.object(
                    analysis_docx,
                    "_exchange_rates_for_period",
                    return_value={"avgCny": None, "avgUsd": None, "count": 0, "totalDays": 31, "rows": []},
                ),
                patch.object(analysis_docx, "_attach_report_extras", side_effect=lambda value: value),
            ):
                files = analysis_docx._write_reports(data)

            html = (Path(tmp) / files["htmlFile"]).read_text(encoding="utf-8")
            with zipfile.ZipFile(Path(tmp) / files["docxFile"]) as package:
                document_xml = package.read("word/document.xml").decode("utf-8")

        self.assertIn("全部在营站点", html)
        self.assertIn("全部在营站点", document_xml)
        self.assertIn(REPORT_HIDDEN_STATION_NOTE, html)
        self.assertIn(REPORT_HIDDEN_STATION_NOTE, document_xml)
        self.assertNotIn("STN-21", html)
        self.assertNotIn("S-22", html)
        self.assertNotIn("STN-21", document_xml)


if __name__ == "__main__":
    unittest.main()
