"""시연용 미사용 발행 구간이 평소 기록 그래프와 일치하는지 검증한다."""

import os
import sys
import unittest
from datetime import timedelta


SIMULATOR_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SIMULATOR_DIR not in sys.path:
    sys.path.insert(0, SIMULATOR_DIR)

import scenarios


class RoutineMissedDemoTimingTest(unittest.TestCase):
    def test_published_window_matches_replay_window(self):
        definition = scenarios.RoutineMissedDemoScenario
        start = scenarios.resolve_simulation_start_time(
            "routine_missed",
            simulation_date="2026-09-26",
            routine_default_time=definition.DEFAULT_START_TIME,
        )
        end = start + timedelta(seconds=definition.TOTAL_CYCLES - 1)

        self.assertEqual(scenarios.get_scenario_target_cycles("routine_missed_demo"), 330)
        self.assertEqual(start.strftime("%H:%M:%S"), "08:08:30")
        self.assertEqual(end.strftime("%H:%M:%S"), "08:13:59")
        self.assertEqual((start + timedelta(seconds=30)).strftime("%H:%M:%S"), "08:09:00")
        self.assertEqual((start + timedelta(seconds=90)).strftime("%H:%M:%S"), "08:10:00")


if __name__ == "__main__":
    unittest.main()
