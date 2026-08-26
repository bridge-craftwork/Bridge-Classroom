(function () {
  var host = window.location.hostname;
  if (host === 'bridge-classroom.com' || host === 'localhost' || host === '127.0.0.1') return;

  // Update footer text that references bridge-classroom.com
  document.querySelectorAll('.footer-copy').forEach(function (el) {
    el.innerHTML = el.innerHTML.replace(/bridge-classroom\.com/g, host);
  });

  // Update og:url meta tag
  var ogUrl = document.querySelector('meta[property="og:url"]');
  if (ogUrl) {
    ogUrl.setAttribute('content', ogUrl.getAttribute('content').replace('bridge-classroom.com', host));
  }

  // Update hrefs that point to bridge-classroom.com subdomains or paths.
  // Same-origin apps are linked by path (/game-analysis/, /solo-practice-app)
  // and need no rewriting; this catches the absolute .com links that remain.
  // Skips external domains like github.com that merely mention bridge-classroom in the path.
  document.querySelectorAll('a[href]').forEach(function (el) {
    var href = el.getAttribute('href');
    if (/https?:\/\/[a-z0-9-]*\.?bridge-classroom\.com/.test(href)) {
      el.setAttribute('href', href.replace('bridge-classroom.com', host));
    }
  });
})();
