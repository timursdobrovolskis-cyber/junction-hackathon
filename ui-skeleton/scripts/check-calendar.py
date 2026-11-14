from playwright.sync_api import sync_playwright
from pathlib import Path
import os
base=os.environ.get('CALENDAR_TEST_URL','http://127.0.0.1:4174')
Path('/tmp/calendar-review').mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':844},ignore_https_errors=True)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 def options():
  if not page.locator('#calendar-options').evaluate('(el)=>el.open'):page.locator('#calendar-options summary').click()
 def close():page.locator('#calendar-detail-close').click()
 page.goto(base+'/spendvest.html#calendar');page.wait_for_selector('#calendar-grid button')
 assert page.locator('#calendar-source').input_value()=='risk'
 assert 'fictional' in page.locator('#calendar-data-label').inner_text()
 assert page.locator('[data-calendar-show]:checked').count()==5
 assert page.locator('#calendar-agenda .calendar-event').count()==3
 assert '11 payments' in page.locator('#calendar-all-payments').inner_text()
 assert '1,595.76' in page.locator('#calendar-month-summary').inner_text()
 print('Layout:',page.evaluate("({gridBottom:document.querySelector('#calendar-grid').getBoundingClientRect().bottom,alertTop:document.querySelector('#calendar-notifications').getBoundingClientRect().top,pageHeight:document.documentElement.scrollHeight})"))
 assert page.locator('#calendar-grid').bounding_box()['y']+page.locator('#calendar-grid').bounding_box()['height']<650
 assert page.locator('#calendar-notifications').bounding_box()['y']<800
 page.screenshot(path='/tmp/calendar-review/usability-month.png',full_page=True)
 page.locator('#calendar-all-payments').click()
 assert page.locator('#calendar-detail-body .calendar-event').count()==11
 for title in ['Netflix','Gym membership','Spotify Premium','iCloud+','Home insurance renewal']:
  assert title in page.locator('#calendar-detail-body').inner_text()
 page.locator('#calendar-detail-body .calendar-event').filter(has_text='Netflix').click()
 assert page.locator('#calendar-detail-title').inner_text()=='Netflix'
 assert '15.99' in page.locator('#calendar-detail-body').inner_text()
 assert page.locator('.calendar-evidence li').count()>0
 page.get_by_role('button',name='← Back to payments').click()
 assert page.locator('#calendar-detail-body .calendar-event').count()==11
 close()
 page.locator('[data-calendar-date="2026-11-28"]').click()
 assert page.locator('#calendar-detail-body .calendar-event').count()==2
 assert 'Gym membership' in page.locator('#calendar-detail-body').inner_text();close()
 page.locator('[data-notice-kind="demo_shortfall"]').click()
 assert '€300.00' in page.locator('#calendar-detail-title').inner_text()
 assert page.locator('.calendar-timeline li').count()==3
 assert '28 Nov 2026' in page.locator('.calendar-timeline').inner_text()
 assert 'FICTIONAL DATA' in page.locator('#calendar-detail-body').inner_text()
 page.screenshot(path='/tmp/calendar-review/usability-warning.png');close()
 options()
 for kind in ['income','bill','yearly']:page.locator('[data-calendar-show="'+kind+'"]').uncheck()
 assert '4 payments' in page.locator('#calendar-count').inner_text()
 page.locator('#calendar-options summary').click()
 page.locator('#calendar-all-payments').click()
 assert page.locator('#calendar-detail-body .calendar-event').count()==4
 assert 'Rent' not in page.locator('#calendar-detail-body').inner_text();close()
 page.locator('[data-calendar-view="week"]').click();assert page.locator('#calendar-grid button').count()==7
 options();page.locator('#calendar-date').fill('2026-11-21')
 assert not page.locator('#calendar-options').evaluate('(el)=>el.open')
 assert page.locator('#calendar-agenda .calendar-event').count()==2
 page.locator('[data-calendar-view="day"]').click()
 assert 'Netflix' in page.locator('#calendar-agenda').inner_text()
 options();page.locator('[data-calendar-show="subscription"]').uncheck();page.locator('[data-calendar-show="alerts"]').uncheck()
 assert 'No payment categories selected' in page.locator('#calendar-agenda').inner_text()
 assert page.locator('#calendar-notifications-section').is_hidden()
 page.reload();page.wait_for_selector('.calendar-day-summary')
 assert page.locator('[data-calendar-show]:checked').count()==0
 assert page.locator('#calendar-date').input_value()=='2026-11-21'
 options()
 for box in page.locator('[data-calendar-show]').all():box.check()
 page.locator('[data-calendar-view="month"]').click()
 options();page.select_option('#calendar-jump','2028-02')
 assert page.locator('[data-calendar-date="2028-02-29"]').count()==1
 options();page.select_option('#calendar-jump','2028-10');assert page.locator('#calendar-next').is_disabled()
 page.locator('#calendar-connect').click()
 assert 'source%3Drisk' in page.locator('#calendar-google-link').get_attribute('href')
 with page.expect_download() as download:page.locator('#calendar-download').click()
 ics=Path(download.value.path()).read_text();assert 'DEMO' in ics and 'Netflix' in ics
 close()
 page.locator('details:has(#calendar-source) summary').click();page.select_option('#calendar-source','regular')
 page.wait_for_function("document.querySelector('#calendar-data-label').textContent.includes('CUST00003')")
 assert page.locator('#calendar-agenda .calendar-event').count()==2
 assert page.locator('[data-notice-kind="demo_shortfall"]').count()==0
 assert 'Netflix' not in page.locator('#calendar-page').inner_text()
 page.route('**/api/calendar?source=engine',lambda route:route.fulfill(status=503,body='{}'))
 page.select_option('#calendar-source','engine');page.wait_for_selector('#calendar-error',state='visible')
 assert page.locator('#calendar-source').input_value()=='regular'
 page.unroute('**/api/calendar?source=engine')
 page.select_option('#calendar-source','risk');page.wait_for_function("document.querySelector('#calendar-data-label').textContent.includes('fictional')")
 options();page.locator('#calendar-reset-month').click()
 for mode in ['month','week','day']:
  page.locator('[data-calendar-view="'+mode+'"]').click()
  for width in [320,390,1024]:
   page.set_viewport_size({'width':width,'height':844});assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),(mode,width)
 page.goto(base+'/spendvest.html#budget');page.wait_for_function("document.querySelector('#budget-loading').hidden")
 assert page.locator('#budget-page').is_visible()
 page.goto(base+'/index.html#calendar');page.wait_for_selector('#calendar-grid button, .calendar-day-summary')
 assert not errors,errors
 browser.close();print('PASS: compact layout, full payments, named subscriptions, exact warning, filters, day/week/month, persistence, export, customer isolation, mobile sizes, Budget and alternate entry page')
