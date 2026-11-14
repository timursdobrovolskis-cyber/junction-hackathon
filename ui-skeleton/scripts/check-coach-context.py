from playwright.sync_api import sync_playwright
import os
base=os.environ.get('COACH_TEST_URL','http://127.0.0.1:4174')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':844},ignore_https_errors=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base+'/spendvest.html#home');page.wait_for_selector('#home-budget-total');page.wait_for_function("document.querySelector('#chat-send').disabled===false")
 def ask(message):
  page.locator('#nav-coach').click();page.locator('#chat-input').wait_for(state='visible');page.locator('#chat-input').fill(message)
  with page.expect_response(lambda r:'/api/coach' in r.url and r.request.method=='POST') as captured:page.locator('#chat-send').click()
  response=captured.value;body=response.json();assert response.status==200,body
  page.wait_for_function("document.querySelector('#chat-send').disabled===false")
  assert body['planChanged']==False
  return body
 home=ask('What does the first page show?');assert home['source']=='app';assert 'Home’s demo' in home['reply'];assert home['presentation']['sections']==['home']
 page.locator('#nav-goals').click();frame=page.frame_locator('#goals-planner');frame.get_by_role('button',name='Add a short-term goal').click()
 frame.get_by_label('What are you saving for?').fill('Camera context');frame.get_by_label('Amount €',exact=True).fill('675');frame.get_by_role('button',name='Add goal',exact=True).click()
 goals=ask('What are my goals?');assert any(e['label']=='Camera context' and '675.00' in e['value'] for e in goals['presentation']['evidence'])
 page.locator('#nav-goals').click();frame.get_by_label('Add money saved toward Camera context',exact=True).fill('50');frame.locator('form.g2-deposit').filter(has=frame.get_by_label('Add money saved toward Camera context',exact=True)).get_by_role('button',name='Add',exact=True).click()
 saved=ask('How much have I saved for my Camera context?');assert '€50.00 recorded of €675.00' in saved['reply']
 page.locator('#nav-goals').click();frame.get_by_role('button',name='Delete Camera context',exact=True).click(force=True);frame.get_by_text('Deleted “Camera context”',exact=True).wait_for()
 deleted=ask('What are my goals?');assert 'Camera context' not in deleted['reply'];assert not any(e['label']=='Camera context' for e in deleted['presentation']['evidence'])
 page.locator('#nav-calendar').click();page.wait_for_selector('#calendar-add:not([disabled])');page.locator('#calendar-add').click()
 page.locator('#calendar-event-title').fill('Dentist context');page.locator('#calendar-event-date').fill('2026-11-22');page.locator('#calendar-event-amount').fill('75');page.locator('#calendar-event-form button[type=submit]').click()
 reminder=ask('When is my Dentist context reminder?');assert '2026-11-22' in reminder['reply'] and '€75.00' in reminder['reply'];assert 'separate from your Home account' in reminder['reply']
 page.locator('#nav-calendar').click();page.locator('[data-calendar-date="2026-11-22"]').click();page.locator('#calendar-detail-body .calendar-event').filter(has_text='Dentist context').click();page.locator('#calendar-delete-event').click()
 removed=ask('What happened to the Dentist context reminder?');assert 'deleted from the selected calendar' in removed['reply']
 page.locator('#nav-calendar').click();page.locator('details:has(#calendar-source) summary').click();page.select_option('#calendar-source','engine');page.wait_for_function("document.querySelector('#calendar-data-label').textContent.includes('CUST00005')")
 account=ask('What is on my calendar?');assert 'fictional demo' not in account['reply'];assert 'Dentist context' not in account['reply']
 page.reload();page.wait_for_function("document.querySelector('#chat-send').disabled===false")
 after=ask('What are my goals?');assert any(e['label']=='Trip' for e in after['presentation']['evidence']);assert all(e['label']!='Camera context' for e in after['presentation']['evidence'])
 assert page.locator('#chat-log .message-assistant').last.get_by_role('link',name='Open Goals').is_visible()
 for width in [320,390,1024]:
  page.set_viewport_size({'width':width,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not errors,errors
 browser.close();print('PASS: live Home figures; goal create, deposit and delete; calendar add/delete and customer switch; source links; reload; mobile layouts; no plan mutations')
