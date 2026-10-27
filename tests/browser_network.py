"""Direct HTTPS Chromium E2E. No injected HTML, mocked fetch, or route interception."""
import os
import unittest
import uuid
from pathlib import Path
from urllib.parse import quote, urlparse
from playwright.sync_api import sync_playwright, expect


class NetworkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.origin = os.environ['MEMDB_BASE_URL'].rstrip('/')
        url = urlparse(cls.origin)
        if url.scheme != 'https' or not url.hostname or url.path:
            raise RuntimeError('MEMDB_BASE_URL must be an exact HTTPS origin')
        insecure = os.getenv('MEMDB_INSECURE_LOOPBACK') == '1'
        if insecure and url.hostname not in ('127.0.0.1', 'localhost', '::1'):
            raise RuntimeError('TLS verification can only be bypassed for loopback CI')
        cls.insecure = insecure
        cls.p = sync_playwright().start()
        chrome = os.getenv('CHROMIUM_PATH')
        cls.browser = cls.p.chromium.launch(headless=True, **({'executable_path':chrome} if chrome else {}))
        Path('artifacts').mkdir(exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.p.stop()

    def setUp(self):
        self.context = self.browser.new_context(ignore_https_errors=self.insecure, viewport={'width':1200, 'height':800})
        self.page = self.context.new_page()
        self.path = 'network/' + uuid.uuid4().hex

    def tearDown(self):
        self.context.close()

    def open_page(self, path=None):
        path = path or self.path
        response = self.page.goto(self.origin + '/p/' + quote(path, safe='/'))
        self.assertEqual(response.status, 200)
        expect(self.page.locator('#status')).to_have_text('This page does not exist yet.')
        return response

    def save(self, text):
        self.page.locator('#markdown').fill(text)
        self.page.locator('#save').click()
        expect(self.page.locator('#status')).to_have_text('Saved successfully.')

    def test_create_preview_save_reload_and_xss(self):
        response = self.open_page()
        self.assertIn("script-src 'self'", response.headers['content-security-policy'])
        expect(self.page.locator('html')).to_have_attribute('lang', 'en')
        self.page.locator('#markdown').fill('# Network test\n\n**saved** <script>window.pwned=1</script>')
        self.page.locator('#view').click()
        expect(self.page.locator('#status')).to_have_text('Unsaved preview.')
        expect(self.page.locator('#preview strong')).to_have_text('saved')
        self.assertEqual(self.page.locator('#preview script').count(), 0)
        self.page.locator('#edit').click()
        self.page.locator('#save').click()
        expect(self.page.locator('#status')).to_have_text('Saved successfully.')
        self.page.reload()
        expect(self.page.locator('#status')).to_have_text('Page loaded.')
        expect(self.page.locator('#preview strong')).to_have_text('saved')
        self.assertIsNone(self.page.evaluate('window.pwned'))
        self.page.screenshot(path='artifacts/browser-network.png', full_page=True)

    def test_real_browser_csp_rejects_inline_script(self):
        self.open_page()
        self.page.evaluate("""() => {
          const script = document.createElement('script');
          script.textContent = 'window.inlineExecuted = true';
          document.body.appendChild(script);
        }""")
        self.assertIsNone(self.page.evaluate('window.inlineExecuted'))

    def test_conflict_keeps_unsaved_draft(self):
        self.open_page()
        self.save('# First')
        status = self.context.request.get(self.origin + '/api/status/' + self.path).json()
        self.page.locator('#edit').click()
        self.page.locator('#markdown').fill('# My unsaved draft')
        changed = self.context.request.put(self.origin + '/api/pages/' + self.path,
            data={'markdown':'# Other editor', 'expected_version':status['version']})
        self.assertEqual(changed.status, 200)
        self.page.locator('#save').click()
        expect(self.page.locator('#status')).to_contain_text('Copy your draft')
        expect(self.page.locator('#markdown')).to_have_value('# My unsaved draft')

    def test_home_navigation_unicode_and_raw(self):
        self.page.goto(self.origin)
        expect(self.page.get_by_role('heading', name='Open a page')).to_be_visible()
        path = self.path + '/caf\u00e9'
        self.page.locator('#path').fill(path)
        self.page.get_by_role('button', name='Open', exact=True).click()
        expect(self.page.locator('#status')).to_contain_text('does not exist yet')
        self.save('Unicode path works')
        response = self.context.request.get(self.origin + '/raw/' + quote(path, safe='/'))
        self.assertEqual(response.status, 200)
        self.assertEqual(response.text(), 'Unicode path works')
        self.assertIn('text/markdown', response.headers['content-type'])

    def test_foreign_origin_and_same_site_fetch_rejected(self):
        self.open_page()
        self.save('Preserve counters')
        endpoint = self.origin + '/api/pages/' + self.path
        for headers in ({'Origin':'https://attacker.invalid'}, {'Sec-Fetch-Site':'same-site'}):
            response = self.context.request.get(endpoint, headers=headers)
            self.assertEqual(response.status, 403)
        status = self.context.request.get(self.origin + '/api/status/' + self.path).json()
        self.assertEqual(status['reads_24h'], 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
