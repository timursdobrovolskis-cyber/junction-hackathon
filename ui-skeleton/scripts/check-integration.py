from playwright.sync_api import sync_playwright
import os
base=os.environ.get('CALENDAR_TEST_URL','http://127.0.0.1:4174')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':844},ignore_https_errors=True);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(base+'/spendvest.html#goals');frame=page.frame_locator('#goals-planner');frame.get_by_role('tab',name='Long term').click()
 assert frame.get_by_text('Just save into S-Pankki',exact=True).is_visible()
 frame.get_by_role('tab',name='Short term').click();assert frame.locator('.g2-row-delete').count()>0
 page.locator('#nav-coach').click();page.wait_for_selector('.coach-hero')
 assert page.locator('#coach-title').inner_text()=='Ask me anything about your money.'
 page.wait_for_function("document.querySelector('#coach-account-balance').textContent.length>0")
 page.locator('#nav-home').click();page.locator('#home-page').wait_for(state='visible')
 page.goto(base+'/spendvest.html#budget');page.wait_for_function("document.querySelector('#budget-loading').hidden")
 assert page.locator('#budget-page').is_visible()
 page.locator('#nav-calendar').click();page.wait_for_selector('#calendar-add:not([disabled])');assert page.locator('#calendar-add').is_visible()
 page.reload();page.wait_for_selector('#calendar-add:not([disabled])')
 assert not errors,errors
 print('PASS: latest Goals savings-account plan and delete controls, Coach hero/account, Home, Budget, and calendar after navigation/reload')
 browser.close()
