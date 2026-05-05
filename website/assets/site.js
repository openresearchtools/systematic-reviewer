(function () {
  var manualLinks = [
    ["/manual/install/", "Install"],
    ["/manual/projects/", "Projects"],
    ["/manual/writer/", "Writer"],
    ["/manual/agent/", "Agent"],
    ["/manual/harvest/", "Harvest"],
    ["/manual/embeddings/", "Embeddings"],
    ["/manual/semantic-search/", "Semantic Search"],
    ["/manual/extraction/", "Extraction"],
    ["/manual/screening/", "Screening"],
    ["/manual/settings/", "Settings"],
    ["/manual/jobs/", "Jobs"],
    ["/manual/troubleshooting/", "Troubleshooting"],
  ];

  Array.prototype.slice.call(document.querySelectorAll("[data-manual-nav]")).forEach(function (nav) {
    var current = String(nav.getAttribute("data-current") || "").trim();
    var pathname = location.pathname.replace(/\/index\.html$/, "/");
    nav.replaceChildren();
    var title = document.createElement("span");
    title.className = "manual-nav__title";
    title.textContent = "Manual";
    nav.appendChild(title);
    manualLinks.forEach(function (entry) {
      var href = entry[0];
      var label = entry[1];
      var link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      if (href === current || pathname === href) {
        link.setAttribute("aria-current", "page");
      }
      nav.appendChild(link);
    });
  });

  function citationOverlayHTML(idSuffix) {
    return [
      '<div class="overlay-host" data-overlay-host>',
      '  <a class="banner-link overlay-trigger" href="#citation-overlay-' + idSuffix + '" aria-expanded="false" aria-controls="citation-overlay-' + idSuffix + '">Citation</a>',
      '  <div class="notice__overlay" id="citation-overlay-' + idSuffix + '" role="dialog" aria-label="Citation formats">',
      '    <p>If you use <strong>Systematic Reviewer</strong> for your work, recommended citation:</p>',
      '    <h3>APA 7th</h3>',
      '    <p>Rutkauskas, L. (2026). <em>Systematic Reviewer</em> (Version <span data-citation-version>Research Preview</span>) [Computer software]. Zenodo. <a href="https://doi.org/10.5281/zenodo.20044491" target="_blank" rel="noopener">https://doi.org/10.5281/zenodo.20044491</a></p>',
      '    <h3>Chicago</h3>',
      '    <p>Rutkauskas, L. <em>Systematic Reviewer</em>. Version <span data-citation-version>Research Preview</span>. Computer software. Zenodo, April 7, 2026. <a href="https://doi.org/10.5281/zenodo.20044491" target="_blank" rel="noopener">https://doi.org/10.5281/zenodo.20044491</a>.</p>',
      '    <h3>BibTeX</h3>',
      '    <button class="btn btn--copy" type="button" data-copy-target="citation-bibtex-' + idSuffix + '">Copy BibTeX</button>',
      '    <pre class="notice__code" id="citation-bibtex-' + idSuffix + '">@software{Rutkauskas_2026_SystematicReviewer,\n  author  = {Rutkauskas, L.},\n  title   = {Systematic Reviewer},\n  version = {Research Preview},\n  date    = {2026-04-07},\n  publisher = {Zenodo},\n  doi     = {10.5281/zenodo.20044491},\n  url     = {https://doi.org/10.5281/zenodo.20044491}\n}</pre>',
      "  </div>",
      "</div>",
    ].join("");
  }

  function githubIconHTML() {
    return [
      '<a class="icon-pill" href="https://github.com/openresearchtools/systematic-reviewer" target="_blank" rel="noopener" aria-label="Open Systematic Reviewer GitHub repository">',
      '  <svg viewBox="0 0 24 24" aria-hidden="true">',
      '    <path d="M12 .5A12 12 0 0 0 0 12.7c0 5.4 3.4 10 8 11.7.6.1.8-.3.8-.6v-2c-3.3.7-4-1.5-4-1.5-.6-1.4-1.5-1.8-1.5-1.8-1.2-.8.1-.8.1-.8 1.3.1 2 .9 2 .9 1.2 2 3.1 1.4 3.8 1.1.1-.9.5-1.4.8-1.7-2.7-.3-5.6-1.4-5.6-6.1 0-1.4.5-2.6 1.3-3.6-.1-.3-.6-1.6.1-3.3 0 0 1-.3 3.4 1.3a11.5 11.5 0 0 1 6.2 0C18.6 4 19.7 4.3 19.7 4.3c.7 1.7.2 3 .1 3.3.8 1 1.3 2.2 1.3 3.6 0 4.7-2.9 5.8-5.6 6.1.6.5.9 1.2.9 2.4v3.5c0 .3.2.7.8.6 4.7-1.7 8-6.3 8-11.7A12 12 0 0 0 12 .5z"></path>',
      "  </svg>",
      "</a>",
    ].join("");
  }

  function enhanceManualHeader() {
    if (!location.pathname.includes("/manual/")) {
      return;
    }
    var banner = document.querySelector(".banner__inner");
    var actions = document.querySelector(".banner__actions");
    if (!banner || !actions) {
      return;
    }
    if (!actions.querySelector('[href="/"]')) {
      actions.insertAdjacentHTML("afterbegin", '<a class="banner-link" href="/">Systematic Reviewer</a>');
    }
    if (!actions.querySelector('[aria-controls^="citation-overlay-"]')) {
      actions.insertAdjacentHTML("beforeend", citationOverlayHTML("manual"));
    }
    if (!banner.querySelector(".icon-pill")) {
      banner.insertAdjacentHTML("beforeend", githubIconHTML());
    }
  }

  enhanceManualHeader();

  function appendSharedFooter() {
    if (document.querySelector(".footer")) {
      return;
    }
    var footer = document.createElement("footer");
    footer.className = "footer";
    footer.setAttribute("aria-label", "Site footer");
    footer.innerHTML = [
      '<div class="shell footer__inner">',
      '  <small>&copy; 2026 <a href="https://openresearchtools.com" target="_blank" rel="noopener">OpenResearchTools</a></small>',
      '  <div class="footer__actions">',
      '    <div class="footer__policy overlay-host" data-overlay-host>',
      '      <a class="btn overlay-trigger" href="#privacy-policy-overlay" aria-expanded="false" aria-controls="privacy-policy-overlay">Cookie &amp; Privacy Policy</a>',
      '      <div class="notice__overlay notice__overlay--up" id="privacy-policy-overlay" role="dialog" aria-label="Cookie and privacy policy">',
      "        <p><em>Last updated: 7 April 2026</em></p>",
      "        <p>At <strong>systematicreviewer.com</strong>, your privacy is respected. This site is designed to be simple and does not collect personal data or use tracking technologies.</p>",
      "        <p><strong>What data we collect</strong></p>",
      "        <ul>",
      "          <li><strong>We do not set cookies.</strong></li>",
      "          <li><strong>We do not use analytics, tracking scripts, or advertising technologies.</strong></li>",
      "          <li><strong>We do not collect or process personal information</strong> about visitors.</li>",
      "        </ul>",
      "        <p><strong>Hosting and logs</strong></p>",
      '        <p>This website is hosted using <strong><a href="https://pages.github.com/" target="_blank" rel="noopener">GitHub Pages</a></strong>, a service provided by GitHub, Inc. When you visit this site, GitHub may collect limited technical information automatically, such as your IP address and basic request data, in order to operate the service securely and reliably.</p>',
      '        <p>For details, please see the <strong><a href="https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement" target="_blank" rel="noopener">GitHub Privacy Statement</a></strong>.</p>',
      "        <p><strong>Links to other websites</strong></p>",
      "        <p>This site may contain links to external websites. We are not responsible for the privacy practices or content of those external sites.</p>",
      "        <p><strong>Your rights</strong></p>",
      "        <p>Under UK GDPR, you have rights relating to your personal data. Since this site does not collect personal data, there is no information for us to provide or erase. If you have concerns about how GitHub processes technical data when serving this site, please review GitHub's privacy policy.</p>",
      "      </div>",
      "    </div>",
      "  </div>",
      "</div>",
    ].join("");
    document.body.appendChild(footer);
  }

  appendSharedFooter();

  var overlayHosts = Array.prototype.slice.call(document.querySelectorAll("[data-overlay-host]"));
  if (!overlayHosts.length) {
    return;
  }

  function setOpen(host, isOpen) {
    host.classList.toggle("is-open", isOpen);
    var trigger = host.querySelector(".overlay-trigger");
    if (trigger) {
      trigger.setAttribute("aria-expanded", String(isOpen));
    }
  }

  function closeAll(exceptHost) {
    overlayHosts.forEach(function (host) {
      if (host !== exceptHost) {
        setOpen(host, false);
      }
    });
  }

  overlayHosts.forEach(function (host) {
    var trigger = host.querySelector(".overlay-trigger");
    if (!trigger) {
      return;
    }

    trigger.addEventListener("click", function (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      var isOpen = host.classList.contains("is-open");
      closeAll(host);
      setOpen(host, !isOpen);
    });
  });

  Array.prototype.slice.call(document.querySelectorAll("[data-copy-target]")).forEach(function (button) {
    button.addEventListener("click", async function (event) {
      event.preventDefault();
      var targetID = button.getAttribute("data-copy-target") || "";
      var target = targetID ? document.getElementById(targetID) : null;
      if (!target) {
        return;
      }
      var text = target.textContent || "";
      try {
        await navigator.clipboard.writeText(text);
        var original = button.textContent;
        button.textContent = "Copied";
        window.setTimeout(function () {
          button.textContent = original;
        }, 1200);
      }
      catch (_error) {}
    });
  });

  function releaseLabel(release) {
    var version = String(release && release.version || "").trim();
    var tag = String(release && release.tag || "").trim();
    return version || tag || "Download";
  }

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[character];
    });
  }

  function releaseURL(release) {
    return String(release && (release.xpi_url || release.download_url || release.html_url) || "").trim();
  }

  function renderReleaseDownloads() {
    var panels = Array.prototype.slice.call(document.querySelectorAll("[data-release-downloads]"));
    if (!panels.length) {
      return;
    }

    panels.forEach(function (panel) {
      var source = panel.getAttribute("data-releases-src") || "/assets/releases.json";
      fetch(source, { cache: "no-store" })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("Release index unavailable");
          }
          return response.json();
        })
        .then(function (data) {
          var latestRelease = data.latest_release || null;
          var latestPrerelease = data.latest_prerelease || null;
          var releases = Array.isArray(data.releases) ? data.releases : [];
          var currentReleaseKeys = [latestRelease, latestPrerelease].filter(Boolean).map(function (release) {
            return [releaseURL(release), releaseLabel(release), String(release.tag || "")].join("|");
          });
          var rows = releases.filter(function (release) {
            var key = [releaseURL(release), releaseLabel(release), String(release.tag || "")].join("|");
            return releaseURL(release) && currentReleaseKeys.indexOf(key) === -1;
          });

          var latestHTML = latestRelease && releaseURL(latestRelease)
            ? '<a class="btn" href="' + escapeHTML(releaseURL(latestRelease)) + '">Download latest release ' + escapeHTML(releaseLabel(latestRelease)) + '</a>'
            : '<span class="release-card__empty">No stable release listed yet.</span>';
          var prereleaseHTML = latestPrerelease && releaseURL(latestPrerelease)
            ? '<a class="btn btn--secondary" href="' + escapeHTML(releaseURL(latestPrerelease)) + '">Download latest pre-release ' + escapeHTML(releaseLabel(latestPrerelease)) + '</a>'
            : '<span class="release-card__empty">No pre-release listed yet.</span>';
          var rowsHTML = rows.length
            ? rows.map(function (release) {
                var kind = release.prerelease ? "Pre-release" : "Release";
                return '<li><a href="' + escapeHTML(releaseURL(release)) + '">' + escapeHTML(releaseLabel(release)) + '</a><span>' + kind + '</span></li>';
              }).join("")
            : '<li><span>No archived versions listed yet.</span></li>';

          panel.innerHTML = [
            '<div class="release-card">',
            '  <h3>Latest release</h3>',
            '  <p>Recommended for most users.</p>',
            '  ' + latestHTML,
            '</div>',
            '<div class="release-card">',
            '  <h3>Latest pre-release</h3>',
            '  <p>Pre-releases are tested mainly on macOS and may contain bugs.</p>',
            '  ' + prereleaseHTML,
            '</div>',
            '<details class="release-card release-card--wide release-archive">',
            '  <summary><span>Older versions</span><span class="release-archive__hint">Show archived downloads</span></summary>',
            '  <div class="release-archive__body">',
            '    <ul class="release-list">' + rowsHTML + '</ul>',
            '    <p class="release-archive__link"><a href="https://github.com/openresearchtools/systematic-reviewer/releases">Open all GitHub releases</a></p>',
            '  </div>',
            '</details>',
          ].join("");
        })
        .catch(function () {
          panel.innerHTML = [
            '<div class="release-card release-card--wide">',
            '  <h3>Downloads</h3>',
            '  <p>The release index could not be loaded. Refresh this page or open the repository release list from the older versions drawer after downloads load.</p>',
            '</div>',
          ].join("");
        });
    });
  }

  renderReleaseDownloads();

  function releaseVersion(data) {
    var release = data && (data.latest_release || data.latest_prerelease);
    var version = String(release && release.version || "").trim();
    if (!version) {
      return "Research Preview";
    }
    return /research[-\s]?preview/i.test(version) ? version : version + "-research-preview";
  }

  function updateCitationVersion() {
    var targets = Array.prototype.slice.call(document.querySelectorAll("[data-citation-version]"));
    var bibtexBlocks = Array.prototype.slice.call(document.querySelectorAll(".notice__code"));
    if (!targets.length && !bibtexBlocks.length) {
      return;
    }
    var source = "/assets/releases.json";
    fetch(source, { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Release index unavailable");
        }
        return response.json();
      })
      .then(function (data) {
        var version = releaseVersion(data);
        targets.forEach(function (target) {
          target.textContent = version;
        });
        bibtexBlocks.forEach(function (block) {
          if (block.textContent && block.textContent.includes("@software{Rutkauskas_2026_SystematicReviewer")) {
            block.textContent = block.textContent.replace(/version = \\{[^}]+\\}/, "version = {" + version + "}");
          }
        });
      })
      .catch(function () {});
  }

  updateCitationVersion();

  document.addEventListener("click", function (event) {
    overlayHosts.forEach(function (host) {
      if (!host.contains(event.target)) {
        setOpen(host, false);
      }
    });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeAll(null);
    }
  });
})();
