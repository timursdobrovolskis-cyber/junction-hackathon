"""Read-only future savings conversation in the deployed phone UI."""
import os
from playwright.sync_api import sync_playwright
base=os.environ.get('COACH_TEST_URL','http://127.0.0.1:4174')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844},ignore_https_errors=True)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/spendvest.html#coach')
    page.wait_for_function("document.querySelector('#chat-send').disabled===false")
    for message,total in [('how much could i save till the end of 2027?',150000),('€200',300000),('What about 2028?',540000)]:
        page.locator('#chat-input').fill(message)
        with page.expect_response(lambda r:'/api/coach' in r.url and r.request.method=='POST') as captured:
            page.locator('#chat-send').click()
        response=captured.value;data=response.json()
        assert response.status==200,data
        assert data['source']=='projection' and data['presentation']['projection']['contributedCents']==total,data
        assert not data['planChanged'] and data['session']['draft']['goal'] is None
        page.wait_for_function("document.querySelector('#chat-send').disabled===false")
        text=page.locator('#chat-log .message-assistant').last.inner_text()
        assert 'not verified affordability' in text and 'starting October 2026' in text
        assert 'historical lookups' not in text
    for width in [320,390,1024]:
        page.set_viewport_size({'width':width,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    browser.close()
    print('PASS: exact future question, repeated contribution/date changes, visible assumptions, no plan changes, mobile layouts')
