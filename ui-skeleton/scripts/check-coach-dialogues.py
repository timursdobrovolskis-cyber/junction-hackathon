"""Regression conversations against the phone UI; seven requests in fresh storage."""
import os
from playwright.sync_api import sync_playwright
base=os.environ.get('COACH_TEST_URL','http://127.0.0.1:4174')
turns=[
 ('How much was my grocery spending last year?','history','€4,825.19'),
 ('What about October 2024?','history','€551.27'),
 ('And November 2024?','history','€555.81'),
 ('How much could I save by the end of 2027?','projection','€1,500.00'),
 ('Make it €200','projection','€3,000.00'),
 ('And €300?','projection','€4,500.00'),
 ('How much could I save by 1 June 2027?','projection','€800.00')]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':844},ignore_https_errors=True)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base+'/spendvest.html#coach');page.wait_for_function("document.querySelector('#chat-send').disabled===false")
 for message,source,amount in turns:
  page.locator('#chat-input').fill(message)
  with page.expect_response(lambda r:'/api/coach' in r.url and r.request.method=='POST') as captured:page.locator('#chat-send').click()
  response=captured.value;data=response.json();assert response.status==200,data
  assert data['source']==source and amount in data['reply'],data
  assert data['session']['draft']['goal'] is None and not data['planChanged']
  page.wait_for_function("document.querySelector('#chat-send').disabled===false")
  assert amount in page.locator('#chat-log .message-assistant').last.inner_text()
 assert '1 June 2027' in data['reply']
 for width in [320,390,1024]:
  page.set_viewport_size({'width':width,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not errors,errors
 browser.close();print('PASS: grocery wording, repeated history follow-ups, natural amount corrections, exact deadline, read-only state, mobile UI')
