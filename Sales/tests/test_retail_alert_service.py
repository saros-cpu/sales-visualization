import unittest
import sys
from pathlib import Path

SALES_ROOT = Path(__file__).resolve().parents[1]
if str(SALES_ROOT) not in sys.path:
    sys.path.insert(0, str(SALES_ROOT))

from services.retail_alert_service import _trend_anomalies


class RetailAlertServiceTests(unittest.TestCase):
    def test_station_size_alone_does_not_trigger_trend_anomaly(self):
        monthly = {
            "daily": [
                {"date": "2026-07-01", "volume": 1000},
                {"date": "2026-07-02", "volume": 1020},
                {"date": "2026-07-03", "volume": 980},
                {"date": "2026-07-04", "volume": 1010},
                {"date": "2026-07-05", "volume": 990},
            ],
            "stations": [
                {"name": "A", "volume": 10000},
                {"name": "B", "volume": 9500},
                {"name": "C", "volume": 9000},
                {"name": "Small", "volume": 1000},
                {"name": "Tiny", "volume": 500},
            ],
        }

        self.assertEqual(_trend_anomalies(monthly), [])

    def test_daily_volume_drop_triggers_trend_anomaly(self):
        monthly = {
            "daily": [
                {"date": "2026-07-01", "volume": 1000},
                {"date": "2026-07-02", "volume": 1020},
                {"date": "2026-07-03", "volume": 980},
                {"date": "2026-07-04", "volume": 500},
            ],
            "stations": [],
        }

        anomalies = _trend_anomalies(monthly)
        self.assertEqual(len(anomalies), 1)
        self.assertEqual(anomalies[0]["type"], "daily_volume")
        self.assertEqual(anomalies[0]["direction"], "down")


if __name__ == "__main__":
    unittest.main()
