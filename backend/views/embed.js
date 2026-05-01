/* productivity.do · embed widget loader */
(function () {
  'use strict';

  var script = document.currentScript;
  var origin = script ? new URL(script.src).origin : 'https://productivity.do';

  function openModal(slug) {
    if (!slug) return;
    var existing = document.getElementById('__productivity_book_modal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = '__productivity_book_modal';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.45);' +
      'display:flex;align-items:center;justify-content:center;padding:24px;';

    var frameWrap = document.createElement('div');
    frameWrap.style.cssText =
      'background:#fff;border-radius:14px;width:min(960px,100%);height:min(680px,100%);' +
      'box-shadow:0 20px 60px rgba(0,0,0,0.25);position:relative;overflow:hidden;';

    var close = document.createElement('button');
    close.textContent = '×'; // multiplication sign as close icon
    close.setAttribute('aria-label', 'Close booking widget');
    close.style.cssText =
      'position:absolute;top:8px;right:12px;width:32px;height:32px;border:none;' +
      'background:rgba(0,0,0,0.05);color:#111;font-size:24px;line-height:1;cursor:pointer;' +
      'border-radius:50%;z-index:1;';
    close.onclick = function () { overlay.remove(); };

    var iframe = document.createElement('iframe');
    iframe.src = origin + '/book/' + encodeURIComponent(slug);
    iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
    iframe.setAttribute('title', 'Booking widget');

    frameWrap.appendChild(close);
    frameWrap.appendChild(iframe);
    overlay.appendChild(frameWrap);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', esc);
      }
    });
  }

  function wire() {
    var els = document.querySelectorAll('[data-productivity-book]');
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        if (el.__productivityWired) return;
        el.__productivityWired = true;
        el.addEventListener('click', function (e) {
          e.preventDefault();
          openModal(el.getAttribute('data-productivity-book'));
        });
      })(els[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  window.Productivity = window.Productivity || {};
  window.Productivity.book = openModal;
})();
