/* RETRADE app entrypoint.
 * The production bundle is kept intact in app-core.js; chart-polish.js and
 * chart-motion.js are deliberately isolated presentation layers so chart UX
 * can be iterated without touching accounting, sync or lifecycle logic.
 */
(function(){
  'use strict';
  var v='20260906-v1441';
  function writeScript(src){document.write('<script src="'+src+'"><\/script>');}
  if(document.readyState==='loading'){
    writeScript('./app-core.js?v='+v);
    writeScript('./chart-polish.js?v='+v);
    writeScript('./chart-motion.js?v='+v);
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
      document.head.appendChild(motion);
    };
    document.head.appendChild(polish);
  };
  document.head.appendChild(core);
})();
