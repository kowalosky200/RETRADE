from pathlib import Path
import re

app = Path('app.js')
css = Path('app.css')
idx = Path('index.html')

app_text = app.read_text(encoding='utf-8')
css_text = css.read_text(encoding='utf-8')
idx_text = idx.read_text(encoding='utf-8')

pattern = re.compile(r"function _replayDashboardMotionAfterLoading\(page\)\{.*?\n\}\n\nfunction finishRealLayoutLoading", re.S)
matches = list(pattern.finditer(app_text))
if len(matches) != 1:
    raise SystemExit(f'expected exactly one dashboard replay function, found {len(matches)}')

replacement = r'''function _replayDashboardMotionAfterLoading(page){
  if(!page||page.id!=='p-summary')return;
  try{if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;}catch(e){}

  const charts=Array.from(page.querySelectorAll('#summary-chart-svg,#summary-chart-svg-mobile'));
  const donut=page.querySelector('.cat-donut-svg');
  const legend=page.querySelector('.cat-donut-legend');
  let donutReady=false;

  // v1.4.26 — stop the hidden/partially-visible boot animations immediately.
  // The hydrated chart itself is still completing its skeleton crossfade here;
  // hold the data strokes at their true 0% state until that reveal is finished.
  charts.forEach(function(svg){
    let any=false;
    svg.querySelectorAll('.rt-chart-line').forEach(function(path){
      try{
        const len=path.getTotalLength();
        if(isFinite(len)&&len>0){path.style.setProperty('--rt-len',len.toFixed(1)+'px');any=true;}
      }catch(e){}
    });
    svg.classList.remove('rt-chart-draw');
    svg.classList.add('rt-motion-hold');
    svg.dataset.rtReplayReady=any?'1':'0';
  });

  if(donut&&donut.querySelector('circle[style*="--seg-len"]')){
    donut.classList.remove('cat-donut-draw');
    donut.classList.add('rt-motion-hold');
    donutReady=true;
  }
  if(legend){legend.classList.remove('cat-legend-draw');legend.classList.add('rt-motion-hold');}

  let started=false;
  const launch=function(){
    if(started)return;
    started=true;
    requestAnimationFrame(function(){requestAnimationFrame(function(){
      charts.forEach(function(svg){
        const ready=svg.dataset.rtReplayReady==='1';
        svg.classList.remove('rt-motion-hold','rt-chart-draw');
        delete svg.dataset.rtReplayReady;
        if(ready){void svg.getBoundingClientRect();svg.classList.add('rt-chart-draw');}
      });
      if(donut){
        donut.classList.remove('rt-motion-hold','cat-donut-draw');
        if(donutReady){void donut.getBoundingClientRect();donut.classList.add('cat-donut-draw');}
      }
      if(legend){
        legend.classList.remove('rt-motion-hold','cat-legend-draw');
        if(donutReady)legend.classList.add('cat-legend-draw');
      }
    });});
  };

  // The chart reveal lasts 360ms. Start the data animation from frame zero only
  // after that reveal actually ends; a timeout is only a guard for browsers that
  // suppress animationend while backgrounding/throttling the page.
  const revealTarget=charts.find(function(svg){return svg.classList.contains('rt-chart-reveal');})||page.querySelector('.rt-chart-reveal');
  if(revealTarget){
    const onEnd=function(ev){
      if(ev.target!==revealTarget)return;
      if(ev.animationName&&ev.animationName!=='rtHydratedChartReveal')return;
      revealTarget.removeEventListener('animationend',onEnd);
      launch();
    };
    revealTarget.addEventListener('animationend',onEnd);
    window.setTimeout(function(){
      revealTarget.removeEventListener('animationend',onEnd);
      launch();
    },430);
  }else{
    requestAnimationFrame(launch);
  }
}

function finishRealLayoutLoading'''
app_text = pattern.sub(replacement, app_text, count=1)

old_cleanup = "    document.body.classList.remove('rt-real-layout-revealing');\n  },340);\n}"
new_cleanup = "    document.body.classList.remove('rt-real-layout-revealing');\n  },390);\n}"
if app_text.count(old_cleanup) != 1:
    raise SystemExit(f'expected one reveal cleanup timeout anchor, found {app_text.count(old_cleanup)}')
app_text = app_text.replace(old_cleanup, new_cleanup, 1)

css_marker = '/* v1.4.26 — deterministic dashboard motion replay after skeleton reveal */'
if css_marker in css_text:
    raise SystemExit('v1.4.26 motion hold CSS already present')
css_text += r'''

/* v1.4.26 — deterministic dashboard motion replay after skeleton reveal */
/* During boot the real chart frame may crossfade in, but its data strokes stay
   parked at 0% until that reveal has completed. This prevents slower phones from
   first seeing the line halfway through its draw animation. */
#p-summary svg.rt-motion-hold .rt-chart-line{
  stroke-dasharray:var(--rt-len)!important;
  stroke-dashoffset:var(--rt-len)!important;
  animation:none!important;
}
#p-summary svg.rt-motion-hold .rt-chart-area,
#p-summary svg.rt-motion-hold .rt-chart-col circle{
  opacity:0!important;
  animation:none!important;
}
#p-summary .cat-donut-svg.rt-motion-hold circle[style*="--seg-len"]{
  stroke-dasharray:0 var(--seg-c)!important;
  animation:none!important;
}
#p-summary .cat-donut-legend.rt-motion-hold{
  opacity:0!important;
  animation:none!important;
}
@media(prefers-reduced-motion:reduce){
  #p-summary svg.rt-motion-hold .rt-chart-line,
  #p-summary .cat-donut-svg.rt-motion-hold circle[style*="--seg-len"]{
    animation:none!important;
  }
}
'''

for old, new in [
    ('./app.css?v=1.4.25', './app.css?v=1.4.26'),
    ('./app.js?v=1.4.25', './app.js?v=1.4.26'),
]:
    if idx_text.count(old) != 1:
        raise SystemExit(f'expected one cache-bust anchor {old}, found {idx_text.count(old)}')
    idx_text = idx_text.replace(old, new, 1)

app.write_text(app_text, encoding='utf-8')
css.write_text(css_text, encoding='utf-8')
idx.write_text(idx_text, encoding='utf-8')

# Deterministic contracts.
assert "svg.classList.add('rt-motion-hold')" in app_text
assert "revealTarget.addEventListener('animationend',onEnd)" in app_text
assert "},390);" in app_text
assert css_marker in css_text
assert '#p-summary svg.rt-motion-hold .rt-chart-line' in css_text
assert './app.css?v=1.4.26' in idx_text
assert './app.js?v=1.4.26' in idx_text
print('mobile chart replay patch applied')
