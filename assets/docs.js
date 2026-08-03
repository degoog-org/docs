(function () {
  "use strict";

  var MIN_QUERY_LENGTH = 2;
  var MAX_RESULTS = 40;
  var SEARCH_INDEX = Array.isArray(window.DEGOOG_SEARCH_INDEX) ? window.DEGOOG_SEARCH_INDEX : [];
  var searchDebounceTimer = null;

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  var currentPage = function () {
    var parts = window.location.pathname.split("/").filter(Boolean);
    var last = parts.length ? parts[parts.length - 1] : "";
    return last.indexOf(".html") === -1 ? "index.html" : last;
  };

  var countHits = function (lowerText, qLower) {
    var count = 0;
    var idx = lowerText.indexOf(qLower);
    while (idx !== -1) {
      count += 1;
      idx = lowerText.indexOf(qLower, idx + qLower.length);
    }
    return count;
  };

  function makeSnippet(text, qLower, contextLen) {
    if (!text || !qLower) return "";
    var idx = text.toLowerCase().indexOf(qLower);
    if (idx === -1) return "";
    contextLen = contextLen || 50;
    var start = Math.max(0, idx - contextLen);
    var end = Math.min(text.length, idx + qLower.length + contextLen);
    var before = (start > 0 ? "\u2026" : "") + text.slice(start, idx);
    var match = text.slice(idx, idx + qLower.length);
    var after = text.slice(idx + qLower.length, end) + (end < text.length ? "\u2026" : "");
    return escapeHtml(before) + "<mark>" + escapeHtml(match) + "</mark>" + escapeHtml(after);
  }

  function clearHighlights(container) {
    qsa("mark", container).forEach(function (mark) {
      mark.replaceWith(document.createTextNode(mark.textContent || ""));
    });
  }

  function highlightInNode(node, term) {
    var count = 0;
    var textNodes = [];
    Array.prototype.slice.call(node.childNodes).forEach(function (child) {
      if (child.nodeType === Node.TEXT_NODE) {
        textNodes.push(child);
      } else if (child.nodeType === Node.ELEMENT_NODE && child.childNodes.length) {
        count += highlightInNode(child, term);
      }
    });

    textNodes.forEach(function (tn) {
      var text = tn.textContent || "";
      var idx = text.toLowerCase().indexOf(term);
      if (idx === -1) return;
      count += 1;
      var mark = document.createElement("mark");
      mark.textContent = text.slice(idx, idx + term.length);
      tn.parentNode.insertBefore(document.createTextNode(text.slice(0, idx)), tn);
      tn.parentNode.insertBefore(mark, tn);
      tn.parentNode.insertBefore(document.createTextNode(text.slice(idx + term.length)), tn);
      tn.parentNode.removeChild(tn);
    });

    return count;
  }

  function runInPageSearch(q) {
    var main = qs("main");
    var input = qs("#doc-search-input");
    var countEl = qs(".doc-search-count");
    var clearBtn = qs(".doc-search-clear");
    if (!main || !input || !countEl || !clearBtn) return;

    clearHighlights(main);
    main.normalize();
    countEl.textContent = "";
    clearBtn.style.display = q ? "block" : "none";

    if (!q) return;
    var total = highlightInNode(main, q);
    countEl.textContent = total > 0 ? total + " match" + (total !== 1 ? "es" : "") : "No matches";
  }

  function showCrossDocResults(results, q) {
    var drop = qs(".doc-search-results");
    if (!drop) return;
    if (!results.length) {
      drop.innerHTML = '<span class="doc-search-results-loading">No other pages match</span>';
      drop.style.display = "block";
      return;
    }

    var html = '<ul class="doc-search-results-list">';
    results.forEach(function (r) {
      var url = r.url + (q ? "?q=" + encodeURIComponent(q) : "");
      var label = r.title + (r.hits > 1 ? " (" + r.hits + ")" : "");
      html += '<li><a href="' + escapeHtml(url) + '">';
      html += '<span class="doc-search-result-title">' + escapeHtml(label) + "</span>";
      if (r.snippet) html += '<span class="doc-search-snippet">' + r.snippet + "</span>";
      html += "</a></li>";
    });
    html += "</ul>";
    drop.innerHTML = html;
    drop.style.display = "block";
  }

  function runCrossDocSearch(q) {
    var drop = qs(".doc-search-results");
    if (!drop) return;
    if (!q || q.length < MIN_QUERY_LENGTH) {
      drop.style.display = "none";
      drop.innerHTML = "";
      return;
    }

    var qLower = q.toLowerCase();
    var here = currentPage();
    var results = [];

    SEARCH_INDEX.forEach(function (entry) {
      if (entry.file === here) return;
      var haystack = entry.title + " " + (entry.description || "") + " " + entry.text;
      var hits = countHits(haystack.toLowerCase(), qLower);
      if (!hits) return;
      results.push({
        url: entry.file,
        title: entry.title || entry.file,
        hits: hits,
        snippet: makeSnippet(entry.text, qLower, 45) || escapeHtml(entry.description || ""),
      });
    });

    results.sort(function (a, b) {
      return b.hits - a.hits;
    });

    showCrossDocResults(results.slice(0, MAX_RESULTS), q);
  }

  function debouncedCrossDocSearch() {
    var input = qs("#doc-search-input");
    var q = ((input && input.value) || "").trim();
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(function () {
      searchDebounceTimer = null;
      runCrossDocSearch(q);
    }, 120);
  }

  function initSearch() {
    var main = qs("main");
    var input = qs("#doc-search-input");
    if (!main || !input) return;

    var wrap = input.closest(".doc-search-wrap");
    if (!wrap) return;
    if (!qs(".doc-search-results", wrap)) {
      var results = document.createElement("div");
      results.className = "doc-search-results";
      results.style.display = "none";
      wrap.appendChild(results);
    }

    var clearBtn = qs(".doc-search-clear");
    input.addEventListener("input", function () {
      var q = (input.value || "").trim();
      runInPageSearch(q.toLowerCase());
      debouncedCrossDocSearch();
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        input.value = "";
        input.blur();
        runInPageSearch("");
        qsa(".doc-search-results").forEach(function (drop) {
          drop.style.display = "none";
          drop.innerHTML = "";
        });
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        input.value = "";
        input.focus();
        runInPageSearch("");
        qsa(".doc-search-results").forEach(function (drop) {
          drop.style.display = "none";
          drop.innerHTML = "";
        });
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || input === e.target) return;
      var target = e.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      e.preventDefault();
      input.focus();
    });

    document.addEventListener("click", function (e) {
      if (!e.target.closest(".doc-search-wrap")) {
        qsa(".doc-search-results").forEach(function (drop) {
          drop.style.display = "none";
        });
      }
    });

    var params = new URLSearchParams(window.location.search);
    var initialQ = params.get("q");
    if (initialQ) {
      input.value = initialQ;
      runInPageSearch(initialQ.toLowerCase());
      runCrossDocSearch(initialQ);
      var firstMark = qs("mark", main);
      if (firstMark) firstMark.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  document.addEventListener("DOMContentLoaded", initSearch);
})();
