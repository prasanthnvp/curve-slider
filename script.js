/**
 * Ferris wheel / arc carousel — SwiperJS with manual clones and infinite jump.
 * WordPress data attributes on .curved-slider:
 *   data-arc-angle="0-30"     — arc angle in degrees (max 30°); 0 = flat
 *   data-loop="true|false"    — infinite loop (clone + jump)
 *   data-autoplay="true|false"    — enable auto-advance; when true, continuous vs step applies
 *   data-autoplay-delay="3000"    — ms per slide when autoplay + non-continuous
 *   data-continuous="true|false" — continuous scroll (smooth, no stop) — only when autoplay is on
 *   data-continuous-speed="80"   — pixels per second when continuous
 *   data-show-controls="true|false" — show on-screen control panel
 *   data-show-nav="true|false"     — show prev/next buttons
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  const CONFIG = {
    sliderSelector: ".curved-slider",
    cardSelector: ".card",
    cloneSets: 10,
    /** Max arc angle in degrees (0 = flat, 30 = max curve). */
    maxArcAngleDeg: 30,
    /** Reference distance (px) for radius from angle: R = ref / sin(angle). */
    arcAngleRefDistance: 400,
    continuousRotation: false,
    continuousRotationSpeed: 80,
  };

  function getRadiusFromAngle(deg) {
    if (deg <= 0) return 10000;
    const rad = (deg * Math.PI) / 180;
    return CONFIG.arcAngleRefDistance / Math.sin(rad);
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    radius: 1500,
    originalSlidesCount: 0,
    /** Arc angle in degrees 0–maxArcAngleDeg (0 = flat). */
    arcAngleDeg: 30,
    /** rAF id for transition interpolation loop. */
    rafId: null,
    /** True while Swiper is animating (so we use getTranslate() in the loop). */
    isTransitioning: false,
    allowNav: true,
    /** Cached card element per slide (filled in init) to avoid querySelector in hot path. */
    cachedCards: null,
    /** For continuous scroll: rAF id, last time, current translate, loop width (set in init). */
    continuousRafId: null,
    continuousLastTime: 0,
    continuousPosition: 0,
    continuousLoopWidth: 0,
    continuousCenter: 0,
  };

  // ---------------------------------------------------------------------------
  // DOM & data attributes (WordPress: set on .curved-slider)
  // ---------------------------------------------------------------------------
  const sliderEl = document.querySelector(CONFIG.sliderSelector);
  if (!sliderEl) return;

  const arcAngleAttr = sliderEl.getAttribute("data-arc-angle") ?? sliderEl.getAttribute("data-radius");
  const initialArcDeg =
    arcAngleAttr !== null && arcAngleAttr !== ""
      ? Math.min(CONFIG.maxArcAngleDeg, Math.max(0, parseInt(arcAngleAttr, 10) || 15))
      : 15;
  state.arcAngleDeg = initialArcDeg;
  state.radius = getRadiusFromAngle(state.arcAngleDeg);

  const loopAttr = sliderEl.getAttribute("data-loop");
  let loopEnabled =
    loopAttr === undefined || loopAttr === null || loopAttr === ""
      ? true
      : loopAttr === "true" || loopAttr === "1" || String(loopAttr).toLowerCase() === "true";

  const autoplayAttr = sliderEl.getAttribute("data-autoplay");
  let autoplayEnabled =
    autoplayAttr === "true" || autoplayAttr === "1" || String(autoplayAttr || "").toLowerCase() === "true";
  const autoplayDelayAttr = sliderEl.getAttribute("data-autoplay-delay");
  const autoplayDelay =
    autoplayDelayAttr !== null && autoplayDelayAttr !== ""
      ? Math.max(500, parseInt(autoplayDelayAttr, 10) || 3000)
      : 3000;

  const continuousAttr = sliderEl.getAttribute("data-continuous") || sliderEl.getAttribute("data-rotate");
  let continuousRotation =
    CONFIG.continuousRotation ||
    continuousAttr === "true" ||
    continuousAttr === "1" ||
    String(continuousAttr).toLowerCase() === "true";
  const continuousSpeedAttr = sliderEl.getAttribute("data-continuous-speed");
  const continuousRotationSpeed =
    continuousSpeedAttr !== null && continuousSpeedAttr !== ""
      ? Math.max(10, parseInt(continuousSpeedAttr, 10) || CONFIG.continuousRotationSpeed)
      : CONFIG.continuousRotationSpeed;

  const showControlsAttr = sliderEl.getAttribute("data-show-controls");
  let showControls =
    showControlsAttr === undefined || showControlsAttr === null || showControlsAttr === ""
      ? true
      : showControlsAttr === "true" || showControlsAttr === "1" || String(showControlsAttr).toLowerCase() === "true";

  const showNavAttr = sliderEl.getAttribute("data-show-nav");
  let showNav =
    showNavAttr === undefined || showNavAttr === null || showNavAttr === ""
      ? true
      : showNavAttr === "true" || showNavAttr === "1" || String(showNavAttr).toLowerCase() === "true";

  const wrapper = sliderEl.querySelector(".swiper-wrapper");
  if (!wrapper) return;

  const navPrev = document.getElementById("navPrev");
  const navNext = document.getElementById("navNext");
  const arcSlider = document.getElementById("arcAngleSlider");
  const arcDisplay = document.getElementById("arcAngleValue");
  const controlsPanel = document.getElementById("curvedSliderControls");
  const loopCheckbox = document.getElementById("loopCheckbox");
  const autoplayCheckbox = document.getElementById("autoplayCheckbox");
  const continuousCheckbox = document.getElementById("continuousCheckbox");
  const showControlsCheckbox = document.getElementById("showControlsCheckbox");
  const showNavCheckbox = document.getElementById("showNavCheckbox");
  const showControlsBtn = document.getElementById("showControlsBtn");

  // ---------------------------------------------------------------------------
  // Manual clone setup (infinite belt: K sets before + K sets after “real”)
  // ---------------------------------------------------------------------------
  const originalSlides = Array.from(wrapper.querySelectorAll(".swiper-slide"));
  state.originalSlidesCount = originalSlides.length;
  if (state.originalSlidesCount === 0) return;

  let initialSlideIndex = 0;
  if (loopEnabled) {
  const setSize = state.originalSlidesCount;
  wrapper.innerHTML = "";

  for (let set = 0; set < CONFIG.cloneSets; set++) {
    const isCloneZone = set === 0 || set === CONFIG.cloneSets - 1;
    originalSlides.forEach((slide, idx) => {
      const clone = slide.cloneNode(true);
      clone.setAttribute("data-real-index", String(idx));
      clone.setAttribute("data-is-clone", isCloneZone ? "true" : "false");
      clone.setAttribute("data-set", String(set));
      wrapper.appendChild(clone);
    });
  }

  /** Index of first “real” content (we start here or in next set). */
  initialSlideIndex = Math.floor(
    state.originalSlidesCount * (CONFIG.cloneSets / 2),
  );
  }

  // ---------------------------------------------------------------------------
  // Arc / ferris wheel transform (R, x → y; scale/opacity/zIndex)
  // Uses cached card refs and only updates slides in visible band for performance.
  // ---------------------------------------------------------------------------
  function applyFerrisTransforms(swiper, overrideTranslate = null) {
    const { radius, cachedCards } = state;
    const slides = swiper.slides;
    if (!cachedCards || cachedCards.length !== slides.length) return;

    const currentTranslate =
      overrideTranslate !== null ? overrideTranslate : swiper.translate;
    const wrapperCenter = -currentTranslate + swiper.width / 2;
    const visibleMargin = swiper.width / 2 + 600;

    const isFlat = state.arcAngleDeg === 0;

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const target = cachedCards[i];

      if (isFlat) {
        target.style.transform = "translate3d(0px, 0px, 0px) scale(1)";
        target.style.opacity = 1;
        slide.style.zIndex = 100;
        continue;
      }

      const slideWidth = slide.offsetWidth;
      const slideCenter = slide.swiperSlideOffset + slideWidth / 2;
      const dx = slideCenter - wrapperCenter;

      if (Math.abs(dx) > visibleMargin) {
        target.style.transform = `translate3d(0px, ${radius}px, 0px) scale(0.82)`;
        target.style.opacity = 0.35;
        slide.style.zIndex = 0;
        continue;
      }

      const dxClamped = Math.max(-radius, Math.min(radius, dx));
      const y = radius - Math.sqrt(radius * radius - dxClamped * dxClamped);
      const t = Math.abs(dxClamped) / radius;
      const scale = 1.0 - t * 0.2;
      const opacity = 1 - t * 0.5;
      const zIndex = Math.round(100 * (1 - t));

      target.style.transform = `translate3d(0px, ${y}px, 0px) scale(${scale})`;
      target.style.opacity = Math.max(0, opacity);
      slide.style.zIndex = zIndex;
    }
  }

  // ---------------------------------------------------------------------------
  // Transition loop (smooth arc during CSS transition)
  // ---------------------------------------------------------------------------
  function startTransitionLoop(swiper) {
    if (state.rafId) cancelAnimationFrame(state.rafId);
    state.isTransitioning = true;

    function loop() {
      if (!state.isTransitioning) return;
      applyFerrisTransforms(swiper, swiper.getTranslate());
      state.rafId = requestAnimationFrame(loop);
    }
    state.rafId = requestAnimationFrame(loop);
  }

  function stopTransitionLoop(swiper) {
    state.isTransitioning = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    applyFerrisTransforms(swiper, swiper.translate);
  }

  // ---------------------------------------------------------------------------
  // Continuous scroll (smooth, never stops — no per-slide pause)
  // ---------------------------------------------------------------------------
  function startContinuousScroll(swiper) {
    if (state.continuousRafId) return;
    state.continuousLastTime = performance.now();
    state.continuousPosition = swiper.translate;

    function loop(now) {
      state.continuousRafId = requestAnimationFrame(loop);
      const dt = (now - state.continuousLastTime) / 1000;
      state.continuousLastTime = now;
      state.continuousPosition -= continuousRotationSpeed * dt;

      const loopW = state.continuousLoopWidth;
      const center = state.continuousCenter;
      if (state.continuousPosition < center - 2 * loopW) {
        state.continuousPosition += 2 * loopW;
      } else if (state.continuousPosition > center + 2 * loopW) {
        state.continuousPosition -= 2 * loopW;
      }

      swiper.wrapperEl.style.transform = `translate3d(${state.continuousPosition}px, 0, 0)`;
      swiper.translate = state.continuousPosition;
      applyFerrisTransforms(swiper, state.continuousPosition);
    }
    state.continuousRafId = requestAnimationFrame(loop);
  }

  function stopContinuousScroll() {
    if (state.continuousRafId) {
      cancelAnimationFrame(state.continuousRafId);
      state.continuousRafId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Infinite jump (when in clone zones, jump to matching real index, 0ms)
  // ---------------------------------------------------------------------------
  function maybeJumpToRealZone(swiper) {
    if (!loopEnabled) return;
    const total = swiper.slides.length;
    const n = state.originalSlidesCount;
    let targetIndex = -1;

    if (swiper.activeIndex < n) {
      targetIndex = swiper.activeIndex + n * 2;
    } else if (swiper.activeIndex >= total - n) {
      targetIndex = swiper.activeIndex - n * 2;
    }

    if (targetIndex !== -1) {
      swiper.slideTo(targetIndex, 0, false);
      applyFerrisTransforms(swiper);
    }

    // Ensure autoplay restarts if enabled
    if (swiper.params.autoplay && swiper.params.autoplay.enabled) {
      swiper.autoplay.start();
    }
  }

  // ---------------------------------------------------------------------------
  // Swiper init (loop: false — we use manual clones + jump)
  // ---------------------------------------------------------------------------
  const effectiveContinuous = autoplayEnabled && continuousRotation;
  const effectiveAutoplayStep = autoplayEnabled && !continuousRotation;

  const swiper = new Swiper(CONFIG.sliderSelector, {
    slidesPerView: "auto",
    centeredSlides: true,
    spaceBetween: 20,
    loop: false,
    speed: 600,
    grabCursor: !effectiveContinuous,
    watchSlidesProgress: true,
    mousewheel: !effectiveContinuous,
    allowTouchMove: !effectiveContinuous,
    initialSlide: initialSlideIndex,
    autoplay: { delay: autoplayDelay, disableOnInteraction: false },

    on: {
      init(s) {
        if (arcSlider) arcSlider.value = state.arcAngleDeg;
        if (arcDisplay) arcDisplay.textContent = `${state.arcAngleDeg}°`;
        if (controlsPanel) controlsPanel.style.display = showControls ? "" : "none";
        if (showControlsBtn) showControlsBtn.style.display = showControls ? "none" : "";
        if (navPrev) navPrev.style.display = showNav ? "" : "none";
        if (navNext) navNext.style.display = showNav ? "" : "none";
        if (loopCheckbox) loopCheckbox.checked = loopEnabled;
        if (autoplayCheckbox) autoplayCheckbox.checked = autoplayEnabled;
        if (continuousCheckbox) continuousCheckbox.checked = continuousRotation;
        if (showControlsCheckbox) showControlsCheckbox.checked = showControls;
        if (showNavCheckbox) showNavCheckbox.checked = showNav;
        state.cachedCards = s.slides.map(
          (slide) => slide.querySelector(CONFIG.cardSelector) || slide,
        );
        state.cachedCards.forEach((card) => {
          card.style.transitionDuration = "0ms";
        });
        requestAnimationFrame(() => applyFerrisTransforms(s));

        if (effectiveContinuous) {
          s.wrapperEl.style.transitionDuration = "0ms";
          const n = state.originalSlidesCount;
          const slideWidth = s.slides[0] ? s.slides[0].offsetWidth : 280;
          const space = s.params.spaceBetween || 20;
          state.continuousLoopWidth = n * (slideWidth + space);
          state.continuousCenter = s.translate;
          state.continuousPosition = s.translate;
          startContinuousScroll(s);
          if (s.autoplay && s.autoplay.running) s.autoplay.stop();
        } else if (!effectiveAutoplayStep && s.autoplay && s.autoplay.running) {
          s.autoplay.stop();
        }
      },

      setTranslate(s) {
        if (autoplayEnabled && continuousRotation) return;
        if (!state.isTransitioning) applyFerrisTransforms(s);
      },

      transitionStart(s) {
        if (autoplayEnabled && continuousRotation) return;
        state.allowNav = false;
        startTransitionLoop(s);
      },

      transitionEnd(s) {
        if (autoplayEnabled && continuousRotation) return;
        stopTransitionLoop(s);
        maybeJumpToRealZone(s);
        state.allowNav = true;
      },
    },
  });

  function applyAutoplayMode() {
    const cont = autoplayEnabled && continuousRotation;
    const step = autoplayEnabled && !continuousRotation;
    swiper.wrapperEl.style.transitionDuration = cont ? "0ms" : "";
    swiper.allowTouchMove = !cont;
    swiper.params.mousewheel = !cont;
    swiper.params.grabCursor = !cont;
    if (cont) {
      if (swiper.autoplay && swiper.autoplay.running) swiper.autoplay.stop();
      const n = state.originalSlidesCount;
      const slideWidth = swiper.slides[0] ? swiper.slides[0].offsetWidth : 280;
      const space = swiper.params.spaceBetween || 20;
      state.continuousLoopWidth = n * (slideWidth + space);
      state.continuousCenter = swiper.translate;
      state.continuousPosition = swiper.translate;
      startContinuousScroll(swiper);
    } else {
      stopContinuousScroll();
      if (step && swiper.autoplay) swiper.autoplay.start();
    }
  }

  // ---------------------------------------------------------------------------
  // Events (nav; optional radius input — in WordPress often omitted)
  // ---------------------------------------------------------------------------
  if (navPrev)
    navPrev.addEventListener("click", () => {
      if (autoplayEnabled && continuousRotation) return;
      if (state.allowNav) swiper.slidePrev();
    });
  if (navNext)
    navNext.addEventListener("click", () => {
      if (autoplayEnabled && continuousRotation) return;
      if (state.allowNav) swiper.slideNext();
    });

  if (arcSlider && arcDisplay) {
    arcSlider.addEventListener("input", (e) => {
      const val = Math.min(
        CONFIG.maxArcAngleDeg,
        Math.max(0, parseInt(e.target.value, 10) || 0),
      );
      state.arcAngleDeg = val;
      state.radius = getRadiusFromAngle(val);
      arcDisplay.textContent = `${state.arcAngleDeg}°`;
      applyFerrisTransforms(swiper);
    });
  }

  if (loopCheckbox) {
    loopCheckbox.addEventListener("change", () => {
      loopEnabled = loopCheckbox.checked;
      sliderEl.setAttribute("data-loop", loopEnabled ? "true" : "false");
    });
  }
  if (autoplayCheckbox) {
    autoplayCheckbox.addEventListener("change", () => {
      autoplayEnabled = autoplayCheckbox.checked;
      sliderEl.setAttribute("data-autoplay", autoplayEnabled ? "true" : "false");
      if (!autoplayEnabled) {
        stopContinuousScroll();
        if (swiper.autoplay && swiper.autoplay.running) swiper.autoplay.stop();
      } else {
        applyAutoplayMode();
      }
    });
  }
  if (continuousCheckbox) {
    continuousCheckbox.addEventListener("change", () => {
      continuousRotation = continuousCheckbox.checked;
      sliderEl.setAttribute("data-continuous", continuousRotation ? "true" : "false");
      if (autoplayEnabled) applyAutoplayMode();
    });
  }
  if (showControlsCheckbox) {
    showControlsCheckbox.addEventListener("change", () => {
      showControls = showControlsCheckbox.checked;
      sliderEl.setAttribute("data-show-controls", showControls ? "true" : "false");
      if (controlsPanel) controlsPanel.style.display = showControls ? "" : "none";
      if (showControlsBtn) showControlsBtn.style.display = showControls ? "none" : "";
    });
  }
  if (showControlsBtn) {
    showControlsBtn.addEventListener("click", () => {
      showControls = true;
      sliderEl.setAttribute("data-show-controls", "true");
      if (controlsPanel) controlsPanel.style.display = "";
      if (showControlsBtn) showControlsBtn.style.display = "none";
      if (showControlsCheckbox) showControlsCheckbox.checked = true;
    });
  }
  if (showNavCheckbox) {
    showNavCheckbox.addEventListener("change", () => {
      showNav = showNavCheckbox.checked;
      sliderEl.setAttribute("data-show-nav", showNav ? "true" : "false");
      if (navPrev) navPrev.style.display = showNav ? "" : "none";
      if (navNext) navNext.style.display = showNav ? "" : "none";
    });
  }
})();
