(function () {
  "use strict";

  var postBody = document.querySelector("[data-post-body]");
  var toc = document.querySelector("[data-post-toc]");
  var content = document.querySelector(".post-content");
  if (!postBody || !toc || !content) {
    return;
  }

  var headings = Array.prototype.slice.call(content.querySelectorAll("h2, h3, h4"));
  var usesContentFallback = headings.length === 0;
  if (usesContentFallback) {
    content.id = content.id || "article-content";
    headings = [content];
  }

  var list = toc.querySelector(".post-toc-list");
  var toggle = toc.querySelector(".post-toc-toggle");
  var mobileQuery = window.matchMedia("(max-width: 1080px)");
  var usedIds = {};

  function slugify(value) {
    return value
      .trim()
      .toLocaleLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section";
  }

  headings.forEach(function (heading, index) {
    var baseId = heading.id || (usesContentFallback ? "article-content" : slugify(heading.textContent));
    var id = baseId;
    var suffix = 2;

    while (usedIds[id] || document.getElementById(id) && document.getElementById(id) !== heading) {
      id = baseId + "-" + suffix;
      suffix += 1;
    }

    heading.id = id;
    usedIds[id] = true;

    var item = document.createElement("li");
    var link = document.createElement("a");
    var level = usesContentFallback ? 2 : Number(heading.tagName.slice(1));

    item.className = "post-toc-level-" + level;
    link.href = "#" + encodeURIComponent(id);
    link.textContent = usesContentFallback ? "正文" : heading.textContent.trim();
    item.appendChild(link);
    list.appendChild(item);
  });

  var links = Array.prototype.slice.call(list.querySelectorAll("a"));
  var activeIndex = -1;
  var ticking = false;

  function setActive(index) {
    if (index === activeIndex) {
      return;
    }

    activeIndex = index;
    links.forEach(function (link, linkIndex) {
      var active = linkIndex === index;
      link.classList.toggle("is-active", active);
      if (active) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function updateActiveSection() {
    var index = 0;
    var threshold = 112;

    headings.forEach(function (heading, headingIndex) {
      if (heading.getBoundingClientRect().top <= threshold) {
        index = headingIndex;
      }
    });

    setActive(index);
    ticking = false;
  }

  function requestActiveSectionUpdate() {
    if (!ticking) {
      window.requestAnimationFrame(updateActiveSection);
      ticking = true;
    }
  }

  function setExpanded(expanded) {
    toc.classList.toggle("is-open", expanded);
    toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  function syncViewportMode() {
    setExpanded(!mobileQuery.matches);
  }

  toggle.addEventListener("click", function () {
    setExpanded(!toc.classList.contains("is-open"));
  });

  links.forEach(function (link) {
    link.addEventListener("click", function () {
      if (mobileQuery.matches) {
        setExpanded(false);
      }
    });
  });

  if (typeof mobileQuery.addEventListener === "function") {
    mobileQuery.addEventListener("change", syncViewportMode);
  } else {
    mobileQuery.addListener(syncViewportMode);
  }

  window.addEventListener("scroll", requestActiveSectionUpdate, { passive: true });
  window.addEventListener("resize", requestActiveSectionUpdate);

  toc.hidden = false;
  postBody.classList.add("has-post-toc");
  syncViewportMode();
  updateActiveSection();
}());
