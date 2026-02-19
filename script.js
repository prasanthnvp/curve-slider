/**
 * Ferris wheel / arc carousel — SwiperJS with manual clones and infinite jump.
 * Arc curvature is read from the slider element: data-radius="0-100" (percentage).
 * WordPress: set data-radius on .curved-slider in your shortcode/template.
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  const CONFIG = {
    /** Selector for the slider root (must have data-radius attribute). */
    sliderSelector: ".curved-slider",
    /** Selector for the element inside each slide to apply arc transform (the card). */
    cardSelector: ".card",
    /** Number of full clone sets (cloneSets × originalCount slides total; we start in middle). */
    cloneSets: 4,
    /** Radius mapping: 0% = effectively flat (large R), 100% = tight curve (small R). */
    radiusAtPercent: (percent) => {
      if (percent === 0) return 10000;
      return 5000 - (percent / 100) * 4600;
    },
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    /** Current arc radius in px (derived from data-radius % or slider input). */
    radius: 1500,
    /** Number of original slides (before cloning). */
    originalSlidesCount: 0,
    /** Arc percentage 0–100 (for optional UI). */
    arcPercent: 30,
    /** rAF id for transition interpolation loop. */
    rafId: null,
    /** True while Swiper is animating (so we use getTranslate() in the loop). */
    isTransitioning: false,
    allowNav: true,
  };

  // ---------------------------------------------------------------------------
  // DOM & data-radius (WordPress: set data-radius on .curved-slider)
  // ---------------------------------------------------------------------------
  const sliderEl = document.querySelector(CONFIG.sliderSelector);
  if (!sliderEl) return;

  const radiusFromAttr = sliderEl.getAttribute("data-radius");
  const initialPercent = radiusFromAttr !== null && radiusFromAttr !== ""
    ? Math.min(100, Math.max(0, parseInt(radiusFromAttr, 10) || 30))
    : 30;
  state.arcPercent = initialPercent;
  state.radius = CONFIG.radiusAtPercent(state.arcPercent);

  const wrapper = sliderEl.querySelector(".swiper-wrapper");
  if (!wrapper) return;

  const navPrev = document.getElementById("navPrev");
  const navNext = document.getElementById("navNext");
  const arcSlider = document.getElementById("radiusSlider");
  const arcDisplay = document.getElementById("radiusValue");

  // ---------------------------------------------------------------------------
  // Manual clone setup (infinite belt: K sets before + K sets after “real”)
  // ---------------------------------------------------------------------------
  const originalSlides = Array.from(wrapper.querySelectorAll(".swiper-slide"));
  state.originalSlidesCount = originalSlides.length;
  if (state.originalSlidesCount === 0) return;

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
  const initialSlideIndex = Math.floor(state.originalSlidesCount * (CONFIG.cloneSets / 2));

  // ---------------------------------------------------------------------------
  // Arc / ferris wheel transform (R, x → y; scale/opacity/zIndex)
  // ---------------------------------------------------------------------------
  function applyFerrisTransforms(swiper, overrideTranslate = null) {
    const { radius } = state;
    const slides = swiper.slides;
    const currentTranslate = overrideTranslate !== null ? overrideTranslate : swiper.translate;
    const wrapperCenter = -currentTranslate + swiper.width / 2;

    const isFlat = state.arcPercent === 0;

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const target = slide.querySelector(CONFIG.cardSelector) || slide;
      target.style.transitionDuration = "0ms";

      if (isFlat) {
        // Radius 0: all slides in one plane (straight horizontal line)
        target.style.transform = "translate3d(0px, 0px, 0px) scale(1)";
        target.style.opacity = 1;
        slide.style.zIndex = 100;
        continue;
      }

      const slideWidth = slide.offsetWidth;
      const slideCenter = slide.swiperSlideOffset + slideWidth / 2;
      const dx = slideCenter - wrapperCenter;
      const dxClamped = Math.max(-radius, Math.min(radius, dx));

      // Arc: y = R - sqrt(R² - x²); center stays at y=0
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
  // Infinite jump (when in clone zones, jump to matching real index, 0ms)
  // ---------------------------------------------------------------------------
  function maybeJumpToRealZone(swiper) {
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
  }

  // ---------------------------------------------------------------------------
  // Swiper init (loop: false — we use manual clones + jump)
  // ---------------------------------------------------------------------------
  const swiper = new Swiper(CONFIG.sliderSelector, {
    slidesPerView: "auto",
    centeredSlides: true,
    spaceBetween: 20,
    loop: false,
    speed: 600,
    grabCursor: true,
    watchSlidesProgress: true,
    mousewheel: true,
    initialSlide: initialSlideIndex,

    on: {
      init(s) {
        if (arcSlider) arcSlider.value = state.arcPercent;
        if (arcDisplay) arcDisplay.textContent = `${state.arcPercent}%`;
        requestAnimationFrame(() => applyFerrisTransforms(s));
      },

      setTranslate(s) {
        if (!state.isTransitioning) applyFerrisTransforms(s);
      },

      transitionStart(s) {
        state.allowNav = false;
        startTransitionLoop(s);
      },

      transitionEnd(s) {
        state.allowNav = true;
        stopTransitionLoop(s);
        maybeJumpToRealZone(s);
      },
    },
  });

  // ---------------------------------------------------------------------------
  // Events (nav; optional radius input — in WordPress often omitted)
  // ---------------------------------------------------------------------------
  if (navPrev) navPrev.addEventListener("click", () => {
    if (state.allowNav) swiper.slidePrev();
  });
  if (navNext) navNext.addEventListener("click", () => {
    if (state.allowNav) swiper.slideNext();
  });

  if (arcSlider && arcDisplay) {
    arcSlider.addEventListener("input", (e) => {
      const val = Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0));
      state.arcPercent = val;
      state.radius = CONFIG.radiusAtPercent(val);
      arcDisplay.textContent = `${state.arcPercent}%`;
      applyFerrisTransforms(swiper);
    });
  }
})();
