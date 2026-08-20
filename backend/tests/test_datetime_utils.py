import unittest
from datetime import datetime, timezone

from app.utils.datetime_utils import KOREA_TIMEZONE, as_korea


class DateTimeUtilsTest(unittest.TestCase):
    def test_naive_database_datetime_is_interpreted_as_utc(self):
        result = as_korea(datetime(2026, 8, 19, 16, 30))

        self.assertEqual(datetime(2026, 8, 20, 1, 30, tzinfo=KOREA_TIMEZONE), result)

    def test_aware_datetime_is_converted_to_korea_time(self):
        result = as_korea(datetime(2026, 8, 20, 0, 0, tzinfo=timezone.utc))

        self.assertEqual(datetime(2026, 8, 20, 9, 0, tzinfo=KOREA_TIMEZONE), result)


if __name__ == "__main__":
    unittest.main()
