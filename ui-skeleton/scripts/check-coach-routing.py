"""Eight read/draft requests: source selection and reload persistence in the phone UI."""
import os
from playwright.sync_api import sync_playwright
base=os.environ.get('COACH_TEST_URL','http://127.0.0.1:4174')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':844},ignore_https_errors=True)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base+'/spendvest.html#coach')
 def ready():page.wait_for_function("document.querySelector('#chat-send').disabled===false")
 def ask(message,source,expected):
  ready();page.locator('#chat-input').fill(message)
  with page.expect_response(lambda r:'/api/coach' in r.url and r.request.method=='POST') as captured:page.locator('#chat-send').click()
  response=captured.value;data=response.json();assert response.status==200,data
  assert data['source']==source and expected in data['reply'],data
  assert not data['planChanged'];ready();return data
 ask('Compare spending in August and September 2026','history','€270.82 higher')
 ask('How much did I spend on groceries and housing in September?','history','€823.32')
 page.reload();ready();assert '€823.32' in page.locator('#chat-log').inner_text()
 ask('What about August?','history','€799.15')
 ask('What was my total income in 2025?','history','€29,183.86')
 ask('How much could I save over the next 18 months?','projection','€1,800.00')
 page.reload();ready();ask('€200','projection','€3,600.00')
 before=ask('I want to save €400 monthly','planning','requested target');assert before['session']['draft']['goal'] is None
 page.reload();ready();assert page.get_by_role('button',name='Add goal',exact=True).is_visible()
 saved=ask('Add goal','planning','in the draft');assert saved['session']['draft']['goal']['amountCents']==40000
 page.locator('#clear-chat').click();page.reload();ready();assert page.locator('#chat-log .message').count()==0
 memory=page.evaluate("JSON.parse(localStorage.getItem('s-pankki:coach:v1:CUST00005'))")
 assert memory['draft']['goal']['amountCents']==40000 and memory['awaiting'] is None
 # A foreign-profile record under this key must not render or become a request.
 page.evaluate("() => {const k='s-pankki:coach:v1:CUST00005';const s=JSON.parse(localStorage.getItem(k));s.customerId='home-sample';s.messages=[{id:'m1',role:'assistant',text:'FOREIGN PRIVATE CHAT'}];localStorage.setItem(k,JSON.stringify(s));}")
 page.reload();ready();assert 'FOREIGN PRIVATE CHAT' not in page.locator('#chat-log').inner_text()
 for width in [320,390,1024]:
  page.set_viewport_size({'width':width,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not errors,errors
 browser.close();print('PASS: comparisons, combined categories, income, relative projection, chat/pending-state reloads, clear-chat, profile isolation, mobile UI')
