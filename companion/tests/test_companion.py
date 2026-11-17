import importlib.util
import json
from pathlib import Path
import secrets
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('companion', Path(__file__).parents[1] / 'valtrack_companion.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
SUBJECT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
PANEL = {'SingleItemStoreOffers': [{'OfferID': ID, 'Cost': {bridge.VP: 1775}, 'Rewards': [{'ItemID': ID}]}], 'SingleItemOffersRemainingDurationInSeconds': 7200}


class CompanionTests(unittest.TestCase):
    def test_current_and_older_store_responses(self):
        offers, seconds = bridge.daily_offers({'SkinsPanelLayout': PANEL})
        self.assertEqual(offers, [{'id': ID, 'price': 1775}])
        self.assertEqual(seconds, 7200)
        old = {'SingleItemOffers': [ID], 'SingleItemOffersRemainingDurationInSeconds': 600}
        prices = {'Offers': [{'OfferID': ID, 'Cost': {bridge.VP: 875}}]}
        self.assertEqual(bridge.daily_offers({'SkinsPanelLayout': old}, prices)[0][0]['price'], 875)
        self.assertIsNone(bridge.daily_offers({'SkinsPanelLayout': old})[0][0]['price'])

    def test_reject_schema_and_region(self):
        for payload in [{}, {'SkinsPanelLayout': {}}, {'SkinsPanelLayout': {**PANEL, 'SingleItemOffersRemainingDurationInSeconds': -1}}]:
            with self.assertRaises(bridge.CompanionError):
                bridge.daily_offers(payload)
        with self.assertRaises(bridge.CompanionError):
            bridge.RiotStore().read('attacker.example')

    def test_local_tls_exception_cannot_target_remote_host(self):
        with self.assertRaises(bridge.CompanionError):
            bridge.request_json('https://attacker.example/entitlements/v1/token', local=True)
        redirect = bridge.NoRedirect()
        self.assertIsNone(redirect.redirect_request(None, None, 302, '', {}, 'https://attacker.example'))

    def test_no_riot_credentials_in_returned_data_or_catalog_headers(self):
        calls = []
        def fake(url, headers=None, local=False):
            calls.append((url, headers))
            if '/v1/version' in url:
                return {'data': {'riotClientVersion': 'test-version'}}
            if '/store/v2/storefront/' in url:
                return {'SkinsPanelLayout': PANEL}
            if '/weapons/skinlevels/' in url:
                return {'data': {'displayName': 'Test skin', 'displayIcon': None}}
            raise AssertionError('Unexpected destination: ' + url)
        with patch.object(bridge, 'local_session', return_value=(SUBJECT, 'fake-access-token', 'fake-entitlement', 'Test#123')), patch.object(bridge, 'request_json', side_effect=fake):
            reader = bridge.RiotStore()
            data = reader.read('eu')
            reader.read('eu')
        encoded = json.dumps(data)
        for secret in ['fake-access-token', 'fake-entitlement', SUBJECT]:
            self.assertNotIn(secret, encoded)
        self.assertEqual(data['account'], 'Test#123')
        for url, headers in calls:
            if url.startswith('https://valorant-api.com/'):
                self.assertIsNone(headers)
            else:
                self.assertTrue(url.startswith('https://pd.eu.a.pvp.net/store/v2/storefront/'))
                self.assertEqual(headers['Authorization'], 'Bearer fake-access-token')
        self.assertEqual(len([url for url, _ in calls if '/store/v2/' in url]), 1)

    def test_http_pairing_origin_host_and_response(self):
        server = bridge.ThreadingHTTPServer(('127.0.0.1', 0), bridge.Handler)
        server.pairing = secrets.token_hex(32)
        class FakeStore:
            calls = 0
            def read(self, shard):
                self.calls += 1
                return {'account': 'Test#123', 'offers': []}
        server.riot_store = FakeStore()
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(server.server_port)
        def send(origin=bridge.ORIGIN, code=None, host=None, method='POST', body=b'{"shard":"eu"}'):
            headers = {'Origin': origin, 'Content-Type': 'application/json', 'X-Valtrack-Pairing': code or server.pairing}
            if host:
                headers['Host'] = host
            req = urllib.request.Request(base + '/store', body if method == 'POST' else None, headers, method=method)
            try:
                return urllib.request.urlopen(req)
            except urllib.error.HTTPError as e:
                return e
        try:
            for kwargs in [{'origin':'https://evil.example'}, {'code':'0'*64}, {'host':'evil.example'}]:
                response = send(**kwargs)
                self.assertEqual(response.code, 403)
            self.assertEqual(server.riot_store.calls, 0)
            self.assertEqual(send(body=b'{"shard":"evil"}').code, 400)
            preflight = send(method='OPTIONS')
            self.assertEqual(preflight.code, 204)
            self.assertEqual(preflight.headers['Access-Control-Allow-Private-Network'], 'true')
            response = send()
            self.assertEqual(response.code, 200)
            self.assertEqual(response.headers['Access-Control-Allow-Origin'], bridge.ORIGIN)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertNotIn(server.pairing, response.read().decode())
            self.assertEqual(server.riot_store.calls, 1)
            self.assertEqual(send(method='GET').code, 405)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
