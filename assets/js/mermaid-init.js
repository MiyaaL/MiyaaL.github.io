(function () {
  "use strict";

  if (typeof window.mermaid === "undefined") {
    return;
  }

  var diagrams = [];
  document.querySelectorAll(".post-content pre code.language-mermaid").forEach(function (code) {
    var container = document.createElement("pre");
    container.className = "mermaid";
    var source = code.textContent;
    code.closest("pre").replaceWith(container);
    diagrams.push({ element: container, source: source });
  });

  if (diagrams.length === 0) {
    return;
  }

  var renderVersion = 0;

  function render(theme) {
    renderVersion += 1;
    var currentVersion = renderVersion;

    diagrams.forEach(function (diagram) {
      diagram.element.removeAttribute("data-processed");
      diagram.element.textContent = diagram.source;
    });

    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "default"
    });

    window.mermaid.run({
      nodes: diagrams.map(function (diagram) {
        return diagram.element;
      })
    }).catch(function (error) {
      if (currentVersion === renderVersion) {
        console.error("Mermaid rendering failed:", error);
      }
    });
  }

  var media = window.matchMedia("(prefers-color-scheme: dark)");
  var initialTheme = document.documentElement.dataset.theme ||
    (media.matches ? "dark" : "light");
  render(initialTheme);

  window.addEventListener("site-theme-change", function (event) {
    render(event.detail.theme);
  });
}());
