from playwright.sync_api import sync_playwright
from pathlib import Path
import os
base=os.environ.get('CALENDAR_TEST_URL','http://127.0.0.1:4174')
Path('/tmp/calendar-controls').mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':390,'height':844},ignore_https_errors=True)
 page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.goto(base+'/spendvest.html#calendar');page.wait_for_selector('#calendar-grid button')
 assert page.locator('#calendar-add').bounding_box()['y']<300
 assert page.locator('#calendar-connect').bounding_box()['y']>page.locator('#calendar-agenda').bounding_box()['y']
 def close():page.locator('#calendar-detail-close').click()
 def add(title,date,cadence='once',kind='bill',amount='70.50'):
  page.locator('#calendar-add').click();page.locator('#calendar-event-title').fill(title);page.locator('#calendar-event-date').fill(date);page.locator('#calendar-event-amount').fill(amount);page.select_option('#calendar-event-kind',kind);page.select_option('#calendar-event-cadence',cadence);page.locator('#calendar-event-form button[type=submit]').click()
 def day(date):page.locator('[data-calendar-date="'+date+'"]').click()
 def event(name):page.locator('#calendar-detail-body .calendar-event').filter(has_text=name).click()
 page.locator('#calendar-options summary').click()
 palette=page.locator('.calendar-check input').evaluate_all('(els)=>els.map(el=>getComputedStyle(el).accentColor)')
 assert len(set(palette))==5,palette
 assert page.locator('.calendar-check .calendar-category-marker').count()==5
 page.screenshot(path='/tmp/calendar-controls/filters.png');page.locator('#calendar-options summary').click()
 add('Dentist','2026-11-22')
 assert page.locator('#calendar-detail').is_hidden()
 assert 'saved on this device' in page.locator('#calendar-personal-note').inner_text().lower()
 assert '12 payments' in page.locator('#calendar-count').inner_text()
 page.reload();page.wait_for_selector('#calendar-grid button');day('2026-11-22');event('Dentist')
 assert '€70.50' in page.locator('#calendar-detail-body').inner_text()
 assert 'Added by you' in page.locator('#calendar-detail-body').inner_text()
 page.locator('#calendar-delete-event').click();assert '11 payments' in page.locator('#calendar-count').inner_text()
 page.locator('#calendar-undo').click();assert '12 payments' in page.locator('#calendar-count').inner_text()
 add('My gym','2026-11-30','monthly','subscription','29,99')
 page.locator('#calendar-next').click();day('2026-12-30');event('My gym');page.locator('#calendar-delete-event').click()
 page.reload();page.wait_for_selector('#calendar-grid button');day('2026-12-30');assert 'My gym' not in page.locator('#calendar-detail-body').inner_text();close()
 page.locator('#calendar-next').click();day('2027-01-30');event('My gym');page.locator('#calendar-delete-series').click()
 page.locator('#calendar-deleted').click();page.get_by_role('button',name='Restore My gym',exact=True).click();close();day('2027-01-30');event('My gym');close()
 # Restoring a series preserves an individually deleted date.
 page.locator('#calendar-prev').click();day('2026-12-30');assert 'My gym' not in page.locator('#calendar-detail-body').inner_text();close()
 page.locator('#calendar-prev').click();day('2026-11-21');event('Netflix');page.locator('#calendar-delete-event').click()
 page.reload();page.wait_for_selector('#calendar-grid button');day('2026-11-21');assert 'Netflix' not in page.locator('#calendar-detail-body').inner_text();close()
 assert '300.00' in page.locator('[data-notice-kind="demo_shortfall"]').inner_text()
 assert '1,595.76' in page.locator('#calendar-month-summary').inner_text()
 page.locator('#calendar-deleted').click();page.get_by_role('button',name='Restore Netflix',exact=True).click();close();day('2026-11-21');event('Netflix');close()
 # Customer switching and reopen persistence.
 page.locator('details:has(#calendar-source) summary').click();page.select_option('#calendar-source','regular');page.wait_for_function("document.querySelector('#calendar-data-label').textContent.includes('CUST00003')")
 assert 'Dentist' not in page.locator('#calendar-page').inner_text();assert page.locator('#calendar-deleted').inner_text()=='Deleted events (0)'
 page.select_option('#calendar-source','risk');page.wait_for_function("document.querySelector('#calendar-data-label').textContent.includes('fictional')")
 day('2026-11-22');event('Dentist');close()
 # Storage denial keeps the form and explains failure, without a phantom event.
 page.evaluate("() => {window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Quota exceeded','QuotaExceededError')}}")
 add('Should not save','2026-11-24')
 assert page.locator('#calendar-form-error').is_visible();assert 'Nothing was changed' in page.locator('#calendar-form-error').inner_text();close()
 page.evaluate('() => {Storage.prototype.setItem=window.originalSetItem}')
 day('2026-11-24');assert 'Should not save' not in page.locator('#calendar-detail-body').inner_text();close()
 page.locator('#calendar-connect').click();assert 'not synced to Google' in page.locator('#calendar-detail-body').inner_text();close()
 # A change from another tab refreshes the list without discarding an open draft.
 other=context.new_page();other.goto(base+'/spendvest.html#calendar');other.wait_for_selector('#calendar-grid button')
 other.locator('#calendar-add').click();other.locator('#calendar-event-title').fill('Unsaved draft')
 add('Cross tab reminder','2026-11-24')
 other.wait_for_function("document.querySelector('#calendar-edit-message').textContent.includes('another tab')")
 assert other.locator('#calendar-event-title').input_value()=='Unsaved draft'
 other.locator('#calendar-detail-close').click();other.locator('[data-calendar-date="2026-11-24"]').click()
 assert 'Cross tab reminder' in other.locator('#calendar-detail-body').inner_text();other.close()
 # Validate a fresh form and responsive controls at each target width.
 for width in [320,390,1024]:
  page.set_viewport_size({'width':width,'height':844});page.locator('#calendar-add').click()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert page.locator('#calendar-event-form').evaluate('(el)=>el.scrollWidth<=el.clientWidth')
  if width==390:
   page.wait_for_timeout(250);page.screenshot(path='/tmp/calendar-controls/add-event.png')
  close()
 assert not errors,errors
 browser.close();print('PASS: distinct colours/shapes, add/delete/undo/restore, monthly recurrence, customer persistence/isolation, storage failure, Google placement/scope, mobile forms')
