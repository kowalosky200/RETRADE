/* RETRADE app entrypoint.
 * The production bundle is kept intact in app-core.js; chart-polish.js,
 * chart-motion.js, chart-finalize.js, chart-reveal.js and chart-line-motion.js
 * are deliberately isolated presentation layers so chart UX can be iterated
 * without touching accounting, sync or lifecycle logic.
 */
(function(){
  'use strict';
  var v='20260906-v1446';
  function writeScript(src){document.write('<script src="'+src+'"><\/script>');}
  if(document.readyState==='loading'){
    writeScript('./app-core.js?v='+v);
    writeScript('./chart-polish.js?v='+v);
    writeScript('./chart-motion.js?v='+v);
    writeScript('./chart-finalize.js?v='+v);
    writeScript('./chart-reveal.js?v='+v);
    writeScript('./chart-line-motion.js?v='+v);
    return;
  }
  var core=document.createElement('script');
  core.src='./app-core.js?v='+v;
  core.onload=function(){
    var polish=document.createElement('script');
    polish.src='./chart-polish.js?v='+v;
    polish.onload=function(){
      var motion=document.createElement('script');
      motion.src='./chart-motion.js?v='+v;
      motion.onload=function(){
        var finalize=document.createElement('script');
        finalize.src='./chart-finalize.js?v='+v;
        finalize.onload=function(){
          var reveal=document.createElement('script');
          reveal.src='./chart-reveal.js?v='+v;
          reveal.onload=function(){
            var lineMotion=document.createElement('script');
            lineMotion.src='./chart-line-motion.js?v='+v;
            document.head.appendChild(lineMotion);
          };
          document.head.appendChild(reveal);
        };
        document.head.appendChild(finalize);
      };
      document.head.appendChild(motion);
    };
    document.head.appendChild(core);
  };
  document.head.appendChild(core);
})();
