from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')
marker = 'id="rt-theme-first-paint"'
if marker in text:
    print('theme first-paint bootstrap already present')
    raise SystemExit(0)

anchor = '<meta name="theme-color" content="#eef1f7" media="(prefers-color-scheme: light)">\n'
if text.count(anchor) != 1:
    raise SystemExit(f'expected one theme-color anchor, found {text.count(anchor)}')

bootstrap = r'''\n<!-- Apply the saved appearance before CSS/first paint. app.js still owns the\n     runtime preference logic; this tiny bootstrap only prevents a hard-refresh\n     flash of the opposite theme while the main bundle is loading. -->\n<script id="rt-theme-first-paint">\n(function(){\n  var root=document.documentElement;\n  var resolved='light';\n  try{\n    var pref=localStorage.getItem('rt-theme');\n    if(pref!=='system'&&pref!=='dark'&&pref!=='light'){\n      var legacy=localStorage.getItem('retrade_theme');\n      pref=(legacy==='dark'||legacy==='light')?legacy:'system';\n    }\n    var systemDark=!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);\n    resolved=(pref==='dark'||(pref==='system'&&systemDark))?'dark':'light';\n  }catch(e){\n    try{resolved=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}catch(_e){}\n  }\n  root.setAttribute('data-theme',resolved);\n  var colour=resolved==='dark'?'#0f1724':'#eef1f7';\n  root.style.backgroundColor=colour;\n  document.querySelectorAll('meta[name="theme-color"]').forEach(function(meta){meta.setAttribute('content',colour);});\n  document.addEventListener('DOMContentLoaded',function(){root.style.removeProperty('background-color');},{once:true});\n})();\n</script>\n'''

path.write_text(text.replace(anchor, anchor + bootstrap, 1), encoding='utf-8')
print('inserted theme first-paint bootstrap')
