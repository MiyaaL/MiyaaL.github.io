(function () {
  "use strict";

  var root = document.documentElement;
  var themeToggle = document.querySelector(".theme-toggle");
  var colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
  var modes = ["system", "light", "dark"];
  var modeLabels = {
    system: "跟随系统",
    light: "浅色",
    dark: "深色"
  };

  function readThemeMode() {
    try {
      var stored = localStorage.getItem("theme-mode");
      return modes.indexOf(stored) >= 0 ? stored : "system";
    } catch (_) {
      return "system";
    }
  }

  function resolvedTheme(mode) {
    return mode === "system" ? (colorScheme.matches ? "dark" : "light") : mode;
  }

  function applyThemeMode(mode, persist) {
    root.dataset.themeMode = mode;
    if (mode === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.dataset.theme = mode;
    }

    if (persist) {
      try {
        localStorage.setItem("theme-mode", mode);
      } catch (_) {
        // The theme still works when storage is unavailable.
      }
    }

    if (themeToggle) {
      themeToggle.title = "主题：" + modeLabels[mode] + "（点击切换）";
      themeToggle.setAttribute("aria-label", "当前主题：" + modeLabels[mode] + "；点击切换");
    }

    window.dispatchEvent(new CustomEvent("site-theme-change", {
      detail: { theme: resolvedTheme(mode) }
    }));
  }

  var initialMode = readThemeMode();
  applyThemeMode(initialMode, false);

  if (themeToggle) {
    themeToggle.addEventListener("click", function () {
      var currentMode = readThemeMode();
      var nextMode = modes[(modes.indexOf(currentMode) + 1) % modes.length];
      applyThemeMode(nextMode, true);
    });
  }

  function handleSystemThemeChange() {
    if (readThemeMode() === "system") {
      applyThemeMode("system", false);
    }
  }

  if (typeof colorScheme.addEventListener === "function") {
    colorScheme.addEventListener("change", handleSystemThemeChange);
  } else if (typeof colorScheme.addListener === "function") {
    colorScheme.addListener(handleSystemThemeChange);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise(function (resolve, reject) {
      var textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();

      try {
        document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
      } catch (error) {
        reject(error);
      } finally {
        textarea.remove();
      }
    });
  }

  document.querySelectorAll(".post-content pre").forEach(function (pre) {
    if (pre.classList.contains("mermaid") || pre.querySelector(".language-mermaid")) {
      return;
    }

    var frame = pre.closest(".highlighter-rouge");
    if (!frame) {
      frame = document.createElement("div");
      frame.className = "code-frame";
      pre.parentNode.insertBefore(frame, pre);
      frame.appendChild(pre);
    }

    var button = document.createElement("button");
    button.className = "copy-code";
    button.type = "button";
    button.textContent = "复制";
    button.setAttribute("aria-label", "复制代码");
    frame.appendChild(button);

    button.addEventListener("click", function () {
      copyText(pre.textContent).then(function () {
        button.textContent = "已复制";
        window.setTimeout(function () {
          button.textContent = "复制";
        }, 1600);
      }).catch(function () {
        button.textContent = "复制失败";
      });
    });
  });

  var searchInput = document.getElementById("post-search");
  if (!searchInput) {
    return;
  }

  var cards = Array.prototype.slice.call(document.querySelectorAll(".filterable-post"));
  var tagButtons = Array.prototype.slice.call(document.querySelectorAll(".tag-filter"));
  var resultCount = document.getElementById("result-count");
  var noResults = document.getElementById("no-results");
  var clearSearch = document.getElementById("search-clear");
  var resetFilters = document.getElementById("reset-filters");
  var selectedTag = "";

  function normalize(value) {
    return (value || "").trim().toLocaleLowerCase();
  }

  function updateUrl(query) {
    if (!window.history || !window.history.replaceState) {
      return;
    }

    var params = new URLSearchParams();
    if (selectedTag) {
      params.set("tag", selectedTag);
    }
    if (query) {
      params.set("q", query);
    }
    var nextUrl = window.location.pathname + (params.toString() ? "?" + params.toString() : "");
    window.history.replaceState(null, "", nextUrl);
  }

  function applyFilters() {
    var query = normalize(searchInput.value);
    var visibleCount = 0;

    cards.forEach(function (card) {
      var tags = normalize(card.dataset.tags).split("|").filter(Boolean);
      var haystack = [
        card.dataset.title,
        card.dataset.description,
        card.dataset.tags
      ].join(" ");
      var queryMatch = !query || normalize(haystack).indexOf(query) >= 0;
      var tagMatch = !selectedTag || tags.indexOf(selectedTag) >= 0;
      var visible = queryMatch && tagMatch;
      card.hidden = !visible;
      if (visible) {
        visibleCount += 1;
      }
    });

    resultCount.textContent = String(visibleCount);
    noResults.hidden = visibleCount !== 0;
    clearSearch.hidden = query.length === 0;
    updateUrl(query);
  }

  function selectTag(tag) {
    selectedTag = normalize(tag);
    tagButtons.forEach(function (button) {
      var active = normalize(button.dataset.tag) === selectedTag;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    applyFilters();
  }

  tagButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      selectTag(button.dataset.tag);
    });
  });

  searchInput.addEventListener("input", applyFilters);
  searchInput.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      searchInput.value = "";
      applyFilters();
      searchInput.blur();
    }
  });

  clearSearch.addEventListener("click", function () {
    searchInput.value = "";
    applyFilters();
    searchInput.focus();
  });

  if (resetFilters) {
    resetFilters.addEventListener("click", function () {
      searchInput.value = "";
      selectTag("");
      searchInput.focus();
    });
  }

  var initialParams = new URLSearchParams(window.location.search);
  var initialQuery = initialParams.get("q") || "";
  var initialTag = normalize(initialParams.get("tag"));
  searchInput.value = initialQuery;

  if (initialTag && tagButtons.some(function (button) {
    return normalize(button.dataset.tag) === initialTag;
  })) {
    selectTag(initialTag);
  } else {
    applyFilters();
  }
}());
