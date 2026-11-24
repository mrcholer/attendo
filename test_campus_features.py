from datetime import date, datetime, timezone
import unittest
from unittest.mock import patch
import campus_features as campus

class CampusFeatureTests(unittest.TestCase):
    def test_profile_allowlist(self):
        result = campus.sanitize_profile({'login':'student','email':'private@example.test',
            'wallet':10,'projects_users':[{'project':{'name':'Libft'},'validated?':True}]}, 'student')
        self.assertNotIn('email', result)
        self.assertTrue(result['projects'][0]['validated'])
        self.assertEqual(result['wallet'], 10)

    def test_wrong_login(self):
        with self.assertRaises(campus.APIError):
            campus.sanitize_profile({'login':'other'}, 'student')

    def test_missing_token(self):
        with patch.object(campus,'current_login',return_value='student'), patch.object(campus,'token',return_value=None):
            result=campus.profile_data()
        self.assertEqual(result['login'],'student')
        self.assertIsNone(result['profile'])

    def test_clip(self):
        day=date(2026,11,24)
        start,_=campus.day_bounds(day)
        rows=[{'begin_at':'2026-11-23T20:00:00Z','end_at':'2026-11-24T03:00:00Z'},
              {'begin_at':'bad','end_at':None},{'begin_at':'2026-11-24T08:00:00Z','end_at':None}]
        now=datetime(2026,11,24,9,tzinfo=timezone.utc)
        result=campus.clip_sessions(rows,day,now)
        self.assertEqual(len(result),2)
        self.assertEqual(result[0]['start'],start.isoformat())
        self.assertTrue(result[1]['ongoing'])
