"""Real Chromium DOM integration with MemDB HTTP/SQLite via a Python fetch bridge.

Chromium navigation to localhost is denied by the execution environment. We still
exercise the shipped browser JS/DOM and the real application router by injecting
production HTML and proxying fetch through urllib. This is NOT a full network E2E
or a Cloudflare D1 test. The browser's page routing and CSP still need deployment tests.
"""
import json
import os
import subprocess
import unittest
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request as PyRequest, urlopen
from urllib.error import HTTPError
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent

class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = subprocess.Popen(
            ['node', '--experimental-sqlite', 'tests/browser-server.mjs'],
            cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, bufsize=1)
        ready = cls.server.stdout.readline().strip()
        if not ready.startswith('READY '): raise RuntimeError('Server did not start: ' + ready)
        cls.origin = ready.split(' ',1)[1]
        cls.p = sync_playwright().start()
        chrome = os.getenv('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None)
        cls.browser = cls.p.chromium.launch(
            headless=True, **({'executable_path':chrome} if chrome else {}),
            args=['--no-sandbox','--disable-dev-shm-usage'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.p.stop()
        cls.server.terminate()
        try: cls.server.communicate(timeout=4)
        except subprocess.TimeoutExpired: cls.server.kill()

    def setUp(self): self.page = self.browser.new_page(viewport={'width':1280,'height':820})
    def tearDown(self): self.page.close()

    def _request(self, path, method='GET', body=None, headers=None):
        if isinstance(body,dict): body=json.dumps(body).encode('utf-8')
        if isinstance(body,str): body=body.encode('utf-8')
        hdrs = headers or {}
        if body is not None and 'Content-Type' not in hdrs: hdrs = {**hdrs,'Content-Type':'application/json'}
        request=PyRequest(self.origin+path,data=body,method=method,headers=hdrs)
        try:
            with urlopen(request,timeout=5) as response:
                return response.status, response.read().decode('utf-8'), dict(response.headers)
        except HTTPError as response:
            return response.code, response.read().decode('utf-8'), dict(response.headers)

    def _open_ui(self, path):
        status,html,_=self._request('/')
        assert status==200,(status,html)
        self.page.set_content(html.replace('<script src="/assets/app.js" defer></script>',''))
        def backend(path,method='GET',body=None,headers=None):
            code,answer,hdr=self._request(path,method,body,headers)
            return {'status':code,'body':answer,'headers':{'Content-Type':hdr.get('Content-Type','application/json')}}
        self.page.expose_function('pythonHttp',backend)
        self.page.evaluate('''() => { window.fetch = async (url, init={}) => {
          const r = await window.pythonHttp(url, init.method||'GET', init.body||null, init.headers||{});
          return new Response(r.body, {status:r.status, headers:r.headers});
        }}''')
        code=self._request('/assets/app.js')[1]
        self.page.add_script_tag(content=code)
        if path:
            self.page.locator('#path').fill(path)
            self.page.locator('#open-button').click()
            expect(self.page.locator('#page-title')).to_have_text(path)

    def test_create_preview_reload_and_escaping(self):
        self._open_ui('qa/research')
        expect(self.page.locator('html')).to_have_attribute('lang','en')
        expect(self.page.locator('#status')).to_contain_text('does not exist yet')
        self.page.locator('#markdown').fill('# Hello\n\n**world** <script>alert(1)</script>')
        self.page.locator('#view').click()
        expect(self.page.locator('#status')).to_contain_text('Unsaved preview')
        assert self.page.locator('#preview script').count()==0
        expect(self.page.locator('#preview strong')).to_have_text('world')
        self.page.locator('#edit').click()
        self.page.locator('#save').click()
        expect(self.page.locator('#status')).to_have_text('Saved successfully.')
        expect(self.page.locator('#meta')).to_contain_text('Version ')
        version_before = self.page.locator('#meta').inner_text()
        self.page.close()
        self.page=self.browser.new_page()
        self._open_ui('qa/research')
        expect(self.page.locator('#preview strong')).to_have_text('world')
        assert self.page.locator('#meta').inner_text() == version_before

    def test_conflict_preserves_unsaved_draft(self):
        path='qa/conflict'
        self._open_ui(path)
        expect(self.page.locator('#status')).to_contain_text('does not exist yet')
        self.page.locator('#markdown').fill('# First')
        self.page.locator('#save').click()
        expect(self.page.locator('#status')).to_have_text('Saved successfully.')
        self.page.locator('#edit').click()
        self.page.locator('#markdown').fill('# My unsaved draft')
        code,_,_=self._request('/api/pages/'+path,'PUT',{'markdown':'# Other editor','expected_version':1})
        assert code==200
        self.page.locator('#save').click()
        expect(self.page.locator('#status')).to_contain_text('Copy your draft')
        expect(self.page.locator('#markdown')).to_have_value('# My unsaved draft')

    def test_unicode_path_and_raw_text(self):
        path='café/é'
        self._open_ui(path)
        expect(self.page.locator('#status')).to_contain_text('does not exist yet')
        self.page.locator('#markdown').fill('Café')
        self.page.locator('#save').click()
        expect(self.page.locator('#status')).to_have_text('Saved successfully.')
        code,content,_=self._request('/raw/'+quote(path,safe='/'))
        assert code==200 and content=='Café'

    def test_inline_key_switch_without_navigation(self):
        self._open_ui(None)
        original_url = self.page.url
        expect(self.page.locator('#workspace')).to_be_hidden()
        self.page.locator('#path').fill('qa/key-a')
        self.page.locator('#open-button').click()
        expect(self.page.locator('#status')).to_have_text('This page does not exist yet.')
        self.page.locator('#markdown').fill('# First')
        self.page.locator('#save').click()
        expect(self.page.locator('#status')).to_have_text('Saved successfully.')
        self.page.locator('#path').fill('qa/key-b')
        self.page.locator('#open-button').click()
        expect(self.page.locator('#status')).to_have_text('This page does not exist yet.')
        expect(self.page.locator('#markdown')).to_have_value('')
        assert self.page.url == original_url
        self.page.locator('#markdown').fill('Draft without save')
        self.page.locator('#path').fill('qa/key-a')
        self.page.once('dialog', lambda d: d.dismiss())
        self.page.locator('#open-button').click()
        expect(self.page.locator('#page-title')).to_have_text('qa/key-b')
        expect(self.page.locator('#markdown')).to_have_value('Draft without save')
        expect(self.page.locator('#path')).to_have_value('qa/key-b')

    def test_home_is_english_and_encodes_path(self):
        self._open_ui(None)
        expect(self.page.get_by_role('heading',name='Open a page')).to_be_visible()
        expect(self.page.locator('#path')).to_have_attribute('placeholder','research/experiment-01')
        assert self.page.evaluate("encode('café/é')")=='caf%C3%A9/%C3%A9'

if __name__ == '__main__': unittest.main(verbosity=2)
