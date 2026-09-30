import math
import unittest

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts" / "style-audit" / "neural"))

from metrics import bpc_from_nll, empirical_compatibility, scoring_windows


class NeuralMetricsTest(unittest.TestCase):
    def test_sliding_windows_score_each_predictable_token_once(self):
        windows = list(scoring_windows(list(range(20)), context_tokens=8, stride_tokens=4))
        self.assertEqual(sum(window["scored_tokens"] for window in windows), 19)
        self.assertEqual(windows[0]["score_from"], 1)

    def test_bpc_and_empirical_compatibility(self):
        self.assertAlmostEqual(bpc_from_nll(math.log(2) * 10, 10), 1.0)
        self.assertGreater(empirical_compatibility(0.5, [0.1, 0.5, 1.0]), empirical_compatibility(2.0, [0.1, 0.5, 1.0]))


if __name__ == "__main__":
    unittest.main()
