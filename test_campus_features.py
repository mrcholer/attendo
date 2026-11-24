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

    def test_project_registrations_include_ungraded_and_paginate(self):
        rows=[{'id':i,'project':{'name':f'Project {i}'},'status':'finished','validated?':True,'final_mark':100} for i in range(100)]
        active={'id':100,'project':{'name':'Current project'},'status':'in_progress','validated?':None,'final_mark':None}
        with patch.object(campus,'api_get',side_effect=[rows,[active]]) as get:
            projects,complete=campus.fetch_projects('student','token')
        self.assertTrue(complete)
        self.assertEqual(len(projects),101)
        self.assertEqual(projects[-1]['status'],'in_progress')
        self.assertIsNone(projects[-1]['mark'])
        self.assertIsNone(projects[-1]['validated'])
        self.assertEqual(get.call_args.args[0],'users/student/projects_users')
        self.assertEqual(get.call_args.args[2]['page[number]'],2)

    def test_profile_uses_registered_projects_not_embedded_subset(self):
        raw={'login':'student','projects_users':[]}
        active={'name':'Current','status':'in_progress','validated':None,'mark':None}
        with patch.object(campus,'current_login',return_value='student'), patch.object(campus,'token',return_value='token'), patch.object(campus,'api_get',return_value=raw), patch.object(campus,'fetch_projects',return_value=([active],True)):
            result=campus.profile_data()
        self.assertEqual(result['profile']['projects'],[active])

    def test_catalog_session_status(self):
        now = datetime(2026, 11, 24, 12, tzinfo=timezone.utc)
        session = {'campus_id': 1, 'cursus_id': 21, 'is_subscriptable': True,
                   'begin_at': None, 'end_at': None}
        self.assertEqual(campus.project_availability({'project_sessions':[session]},21,[1],now),'open')
        self.assertEqual(campus.project_availability({'project_sessions':[session]},21,[2],now),'unknown')
        self.assertEqual(campus.project_availability({},21,[1],now),'unknown')
        self.assertEqual(campus.project_availability({'project_sessions':[dict(session,is_subscriptable=False)]},21,[1],now),'closed')
        self.assertEqual(campus.project_availability({'project_sessions':[dict(session,begin_at='2027-01-01T00:00:00Z')]},21,[1],now),'closed')
