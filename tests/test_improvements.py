import functools,http.server,json,threading,time
from pathlib import Path
from playwright.sync_api import sync_playwright
root=str(Path(__file__).resolve().parents[1])
server=http.server.ThreadingHTTPServer(('127.0.0.1',8765),functools.partial(http.server.SimpleHTTPRequestHandler,directory=root));threading.Thread(target=server.serve_forever,daemon=True).start()
fixture=[]
for i in range(24):
 fixture.append({'id':f'm{i}','date':f'2026-11-{17-i%14:02d}','startedAt':int(time.time()*1000)-i*86400000,'mode':'Competitive','map':'Ascent' if i%2==0 else 'Haven','agent':'Sova' if i%3==0 else 'Jett','result':'win' if i%2==0 else 'loss','roundsWon':13 if i%2==0 else 8,'roundsLost':8 if i%2==0 else 13,'kills':20,'deaths':10,'assists':5,'acs':250})
# A complete saved detail record supports player-name search without remote lookups.
fixture[0]['details']={'myTeam':'Blue','teams':{'Blue':{'won':13,'lost':8}},'players':[{'name':'Needle','tag':'ABC','key':'needle','team':'Blue','agent':'Sova','tier':'Gold 1','kills':20,'deaths':10,'assists':5,'acs':250,'adr':150,'hs':30,'fb':1,'fd':0}],'duels':[]}
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width in [1440,390]:
  context=browser.new_context(viewport={'width':width,'height':1000},service_workers='block');page=context.new_page();errors=[];network={'rank':True,'rr':True,'store':True,'matches':True}
  page.on('pageerror',lambda e:errors.append(str(e)))
  def api(route):
   url=route.request.url
   if '/matches/' in url:kind='matches';body={'data':[]}
   elif '/mmr-history/' in url:
    kind='rr';body={'data':{'history':[{'match_id':'m0','date':'2026-11-17T00:00:00Z','last_change':22,'rr':55,'tier':{'name':'Gold 1'}}]}}
   elif '/store-featured' in url:kind='store';body={'data':[]}
   else:kind='rank';body={'data':{'current':{'tier':{'name':'Gold 1'},'rr':55},'peak':{'tier':{'name':'Gold 1'}}}}
   route.fulfill(status=200 if network[kind] else 503,content_type='application/json',body=json.dumps(body if network[kind] else {'message':kind+' fixture unavailable'}),headers={'Access-Control-Allow-Origin':'*'})
  page.route('https://valtrack-api.tranphongle.workers.dev/**',api)
  seed={'matches':fixture,'at':int(time.time()*1000)-3600000}
  page.add_init_script('''const seed='''+json.dumps(seed)+''';
  if(!localStorage.getItem('vt:account')){
   localStorage.setItem('vt:notice-seen','2');localStorage.setItem('vt:account',JSON.stringify({name:'Test',tag:'123',region:null}));
   localStorage.setItem('vt:matches:test#123',JSON.stringify(seed.matches));
   localStorage.setItem('vt:fetched:test#123',JSON.stringify({matches:seed.at,rr:seed.at}));
   localStorage.setItem('vt:cache:mmr:test#123',JSON.stringify({t:seed.at,v:{current:{tier:{name:'Gold 1'},rr:40},peak:{}}}));
  }''')
  page.goto('http://127.0.0.1:8765',wait_until='networkidle');page.evaluate("showTab('matches')")
  assert page.locator('[data-freshness]').count()==4
  assert '1 h ago' in page.locator('[data-freshness="rank"]').inner_text()
  assert 'No fetch recorded' in page.locator('[data-freshness="store"]').inner_text()
  assert page.locator('#log tr').count()==10
  page.evaluate('turnLogPage(1)');assert 'showing 11' in page.locator('#log-count').inner_text()
  page.locator('#match-map').select_option('Ascent');assert 'showing 1–10' in page.locator('#log-count').inner_text()
  assert all('Ascent'==v for v in page.locator('#log td[data-label="Map"]').all_inner_texts())
  page.locator('#match-agent').select_option('Sova');assert page.locator('#log tr').count()==4
  page.locator('#match-result').select_option('loss');assert page.locator('#log tr').count()==0
  page.locator('#match-clear').click();page.locator('#match-query').fill('needle#abc');assert page.locator('#log tr').count()==1
  assert page.locator('#log tr').get_attribute('data-match')=='m0'
  page.locator('#match-clear').click();page.locator('#match-since').fill('2026-11-17');page.locator('#match-until').fill('2026-11-17');assert page.locator('#log tr').count()==2
  page.locator('#match-since').fill('2026-11-18');assert 'end date' in page.locator('#match-filter-note').inner_text();assert page.locator('#log tr').count()==0
  page.locator('#match-clear').click();page.locator('#match-map').select_option('Ascent');page.evaluate("openMatch('m0')")
  assert page.evaluate('detailList().every(m=>m.map==="Ascent")')
  page.locator('#md-close').click()
  old=page.evaluate('savedCopy("mmr:test#123").t')
  page.evaluate("account.region='eu';fetchRankStats(false,Infinity)")
  assert page.evaluate('lastFetched("rank")')==old,'Reusing cache must not mark rank fresh'
  network['rank']=False;page.evaluate('fetchRankStats(true)')
  assert 'Update failed' in page.locator('[data-freshness="rank"]').inner_text()
  assert 'rank fixture unavailable' in page.locator('[data-freshness="rank"]').inner_text()
  assert page.evaluate('lastFetched("rank")')==old
  network['rank']=True;page.evaluate('fetchRankStats(true)')
  assert 'Update failed' not in page.locator('[data-freshness="rank"]').inner_text()
  assert page.evaluate('lastFetched("rank")')>old
  rr_at=page.evaluate('lastFetched("rr")');network['rr']=False;page.evaluate('fetchRrHistory(true)')
  assert 'Update failed' in page.locator('[data-freshness="rr"]').inner_text();assert page.evaluate('lastFetched("rr")')==rr_at
  network['rr']=True;page.evaluate('fetchRrHistory(true)')
  assert '+22 RR' in page.locator('#log').inner_text(),'RR rerender preserves filters and updates cells'
  page.evaluate("showTab('store')");page.wait_for_function("document.querySelector('#store-status').textContent==='Featured store updated.'")
  assert 'Updated just now' in page.locator('[data-freshness="store"]').inner_text()
  network['store']=False;page.evaluate('shopSnapshot.fetchedAt=1;loadShop(true)')
  assert 'Update failed' in page.locator('[data-freshness="store"]').inner_text()
  matches_at=page.evaluate('lastFetched("matches")');network['matches']=False;page.evaluate('syncMatches(true)')
  assert 'Update failed' in page.locator('[data-freshness="matches"]').inner_text()
  assert page.evaluate('lastFetched("matches")')==matches_at
  page.evaluate("openAccount({name:'Other',tag:'456',region:null})")
  assert 'Update failed' not in page.locator('[data-freshness="rr"]').inner_text(),'Profile failures must not bleed across accounts'
  assert page.locator('#match-map').input_value()==''
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  assert not errors,errors
  print(f'PASS {width}px: filters, date boundaries, player search, pagination, detail navigation, freshness cache/loading/error/recovery and profile isolation')
  context.close()
 browser.close()
server.shutdown()
