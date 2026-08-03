(function () {
  "use strict";

  var canvas = document.querySelector("[data-starfield]");
  if (!canvas || !canvas.getContext) {
    return;
  }

  var context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  var root = document.documentElement;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  var frameInterval = 1000 / 30;
  var width = 0;
  var height = 0;
  var stars = [];
  var palette = [];
  var animationFrame = 0;
  var lastFrame = 0;
  var resizeTimer = 0;

  var palettes = {
    dark: [
      [202, 220, 244],
      [134, 170, 216],
      [220, 214, 202]
    ],
    light: [
      [52, 75, 105],
      [72, 102, 139],
      [90, 84, 105]
    ]
  };

  function currentTheme() {
    if (root.dataset.theme === "light" || root.dataset.theme === "dark") {
      return root.dataset.theme;
    }
    return systemDark.matches ? "dark" : "light";
  }

  function createStar() {
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      radius: 0.3 + Math.pow(Math.random(), 3) * 0.85,
      alpha: 0.14 + Math.random() * 0.34,
      phase: Math.random() * Math.PI * 2,
      pulse: 0.00025 + Math.random() * 0.0004,
      drift: 0.0005 + Math.random() * 0.001,
      color: Math.floor(Math.random() * palette.length)
    };
  }

  function populateStars() {
    var count = Math.max(48, Math.min(140, Math.round((width * height) / 14500)));
    stars = [];
    for (var index = 0; index < count; index += 1) {
      stars.push(createStar());
    }
  }

  function draw(time, elapsed) {
    context.clearRect(0, 0, width, height);

    stars.forEach(function (star) {
      star.y += elapsed * star.drift;
      if (star.y > height + 2) {
        star.y = -2;
        star.x = Math.random() * width;
      }

      var pulse = reducedMotion.matches ? 0.82 : 0.78 + Math.sin(time * star.pulse + star.phase) * 0.22;
      var color = palette[star.color];
      context.beginPath();
      context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
      context.fillStyle = "rgba(" + color.join(",") + "," + (star.alpha * pulse) + ")";
      context.fill();
    });
  }

  function render(time) {
    animationFrame = 0;
    var elapsed = Math.min(time - lastFrame, 80);

    if (elapsed >= frameInterval) {
      draw(time, elapsed);
      lastFrame = time;
    }

    startAnimation();
  }

  function startAnimation() {
    if (!animationFrame && !reducedMotion.matches && !document.hidden) {
      animationFrame = window.requestAnimationFrame(render);
    }
  }

  function stopAnimation() {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  }

  function resize() {
    var pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    populateStars();
    draw(window.performance.now(), 0);
  }

  function setTheme(theme) {
    palette = palettes[theme] || palettes.dark;
    stars.forEach(function (star) {
      star.color = Math.floor(Math.random() * palette.length);
    });
    draw(window.performance.now(), 0);
  }

  function handleMotionChange() {
    if (reducedMotion.matches) {
      stopAnimation();
      draw(window.performance.now(), 0);
    } else {
      lastFrame = window.performance.now();
      startAnimation();
    }
  }

  palette = palettes[currentTheme()];
  resize();
  lastFrame = window.performance.now();
  startAnimation();

  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 120);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      stopAnimation();
    } else {
      lastFrame = window.performance.now();
      startAnimation();
    }
  });

  window.addEventListener("site-theme-change", function (event) {
    setTheme(event.detail.theme);
  });

  if (typeof reducedMotion.addEventListener === "function") {
    reducedMotion.addEventListener("change", handleMotionChange);
  } else if (typeof reducedMotion.addListener === "function") {
    reducedMotion.addListener(handleMotionChange);
  }
}());
