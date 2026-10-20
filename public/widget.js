/* ROOFKIT — віджет калькулятора покрівлі для сайту компанії.
   Вставка: <script src="https://roofkit.com.ua/widget.js" data-roofkit="КЛЮЧ" async></script> */
(function () {
  var s = document.currentScript || (function () { var a = document.querySelectorAll('script[data-roofkit]'); return a[a.length - 1]; })();
  if (!s) return;
  var key = s.getAttribute('data-roofkit');
  if (!key) return;
  var base = s.src.replace(/\/widget\.js.*$/, '');
  var f = document.createElement('iframe');
  f.src = base + '/widget.html?k=' + encodeURIComponent(key) + '&u=' + encodeURIComponent(location.href);
  f.title = 'Калькулятор покрівлі';
  f.loading = 'lazy';
  f.setAttribute('allow', 'clipboard-write');
  f.style.cssText = 'width:100%;max-width:760px;height:720px;border:0;display:block;margin:0 auto;background:transparent;';
  var target = s.getAttribute('data-target') && document.querySelector(s.getAttribute('data-target'));
  if (target) target.appendChild(f); else s.parentNode.insertBefore(f, s.nextSibling);
  window.addEventListener('message', function (e) {
    if (e.source === f.contentWindow && e.data && e.data.roofkitHeight) f.style.height = Math.ceil(e.data.roofkitHeight) + 'px';
  });
})();
