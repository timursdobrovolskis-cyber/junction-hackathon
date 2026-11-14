"""Run against the phone app, with isolated browser storage and no bank writes."""
import os
from playwright.sync_api import sync_playwright
base=os.environ.get('COACH_TEST_URL','http://127.0.0.1:4174')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844},ignore_https_errors=True)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/spendvest.html#coach')
    page.wait_for_function("document.querySelector('#chat-send').disabled===false")
    def ask(message,expected):
        page.locator('#chat-input').fill(message)
        with page.expect_response(lambda r:'/api/coach' in r.url and r.request.method=='POST') as captured:
            page.locator('#chat-send').click()
        response=captured.value;data=response.json()
        assert response.status==200,data
        assert data['source']=='history',data
        assert data['planChanged']==False and data['movesMoney']==False
        page.wait_for_function("document.querySelector('#chat-send').disabled===false")
        assert expected in page.locator('#chat-log .message-assistant').last.inner_text(),data
        return data
    ask('How much did I spend on groceries in September?','€0.00 recorded spending on groceries in September 2026')
    ask('What did I spend at Lidl last month?','August 2026: this ledger has anonymous merchant IDs')
    ask('Show my three biggest payments in September.','€2,151.08')
    ask('How much did I spend on groceries in October 2024?','€551.27')
    missing=ask('How much did I spend in October 2026?','No recorded history')
    assert '€0.00' not in missing['reply']
    ask('How much money did I spend in 2025?','€20,792.23 recorded spending in 2025')
    partial=ask('What was my total spending this year?','€16,167.94')
    assert '2026-01-01 to 2026-09-30' in partial['reply']
    assert page.locator('#chat-log .reply-section-links').count()==0
    for width in [320,390,1024]:
        page.set_viewport_size({'width':width,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    assert not errors,errors
    browser.close()
    print('PASS: historical category totals, anonymous merchant explanation, ranked payments, missing period, direct chat text and mobile layouts')
