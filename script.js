(() => {
  /* ── State ──────────────────────────────────────── */
  let arcAngleDeg = 0; // 0 = flat, 90 = max curve

  /* ── DOM refs ───────────────────────────────────── */
  const arcSlider  = document.getElementById("radiusSlider");
  const arcDisplay = document.getElementById("radiusValue");
  const navPrev    = document.getElementById("navPrev");
  const navNext    = document.getElementById("navNext");

  /* ── Clone slides for manual infinite loop ──────── */
  // Swiper v11 loop mode is broken with slidesPerView:"auto",
  // so we duplicate slides in the DOM ourselves and use
  // Swiper's non-loop mode with manual repositioning.
  const wrapper = document.querySelector(".curved-slider .swiper-wrapper");
  const originalSlides = Array.from(wrapper.querySelectorAll(".swiper-slide"));
  const totalOriginal = originalSlides.length;

  // DOM layout: [pre-clones 0..N-1] [originals N..2N-1] [post-clones 2N..3N-1]
  // Prepend clones BEFORE originals (for left-scroll buffer)
  const firstOriginal = originalSlides[0];
  for (let i = totalOriginal - 1; i >= 0; i--) {
    const clone = originalSlides[i].cloneNode(true);
    wrapper.insertBefore(clone, firstOriginal);
  }
  // Append clones AFTER originals (for right-scroll buffer)
  originalSlides.forEach(slide => {
    const clone = slide.cloneNode(true);
    wrapper.appendChild(clone);
  });

  /* ── Curved transform logic ─────────────────────── */
  /**
   * ARC ANGLE APPROACH
   *
   * Slider controls arc angle (0°–90°):
   *   0°  = perfectly flat, no curve
   *   90° = maximum curve (quarter-circle arc)
   *
   * The arc spans from -arcAngle to +arcAngle.
   * Each card's angle = progress * (arcAngle / visibleRange).
   * Y-offset = depth * (1 - cos(cardAngle))
   *
   * Cards stay UPRIGHT — no rotation.
   */
  function applyCurveTransform(swiper) {
    const slides = swiper.slides;
    if (!slides.length) return;

    const maxAngleRad = (arcAngleDeg * Math.PI) / 180;

    // How many slide positions span from center to the edge of the arc
    const visibleRange = 3;
    const anglePerProgress = visibleRange > 0 ? maxAngleRad / visibleRange : 0;

    // Visual depth: how many px the outermost card drops at max angle
    const depth = 400;

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const progress = slide.progress; // 0 = center, ±1 = adjacent

      // Card's angle on the arc
      const cardAngle = progress * anglePerProgress;

      // Y-offset from circle: depth * (1 - cos(angle))
      const yOffset = depth * (1 - Math.cos(cardAngle));

      // Scale: center = 1, edges shrink subtly
      const absProgress = Math.abs(progress);
      const scale = 1 - absProgress * 0.04;

      // Opacity: center = 1, far edges fade
      const opacity = 1 - absProgress * 0.12;

      // No rotation — cards always stay straight
      slide.style.transform = `translateY(${yOffset}px) scale(${scale})`;
      slide.style.opacity = Math.max(0.35, opacity);
      slide.style.zIndex  = Math.round(100 - absProgress * 10);
      slide.style.transformOrigin = "center center";
    }
  }

  /* ── Swiper init (NO loop mode) ────────────────── */
  const swiper = new Swiper(".curved-slider", {
    slidesPerView: "auto",
    centeredSlides: true,
    spaceBetween: 24,
    loop: true,                        // no buggy loop mode
    initialSlide: totalOriginal,        // start at the first "real" slide in the middle set
    speed: 600,
    grabCursor: true,
    watchSlidesProgress: true,
    allowTouchMove: true,

    on: {
      progress() {
        applyCurveTransform(this);
      },
      setTranslate() {
        applyCurveTransform(this);
      },
      resize() {
        applyCurveTransform(this);
      },
    }
  });

  /* ── Manual loop: snap back to middle set ──────── */
  // After each transition ends, if we've moved into the clone zone,
  // silently jump back to the equivalent slide in the middle set
  function handleLoopSnap() {
    const current = swiper.activeIndex;
    const lowerBound = totalOriginal;             // first slide of middle set
    const upperBound = totalOriginal * 2 - 1;     // last slide of middle set

    if (current < lowerBound) {
      // We're in the "before" clones — jump forward by totalOriginal
      swiper.slideTo(current + totalOriginal, 0, false);
    } else if (current > upperBound) {
      // We're in the "after" clones — jump backward by totalOriginal
      swiper.slideTo(current - totalOriginal, 0, false);
    }
  }

  swiper.on("slideChangeTransitionEnd", handleLoopSnap);
  swiper.on("transitionEnd", handleLoopSnap);

  /* ── Navigation ─────────────────────────────────── */
  navPrev.addEventListener("click", () => swiper.slidePrev());
  navNext.addEventListener("click", () => swiper.slideNext());

  /* ── Arc angle control ──────────────────────────── */
  arcSlider.addEventListener("input", (e) => {
    arcAngleDeg = parseInt(e.target.value, 10);
    arcDisplay.textContent = arcAngleDeg + "°";
    applyCurveTransform(swiper);
  });

  // Initial render
  requestAnimationFrame(() => applyCurveTransform(swiper));
})();
