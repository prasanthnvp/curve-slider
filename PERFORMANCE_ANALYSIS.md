# Performance Analysis — Curved Slider (Current State)

Analysis of **script.js** and **style.css** after applied optimizations.  
Current setup: **5 original slides** in HTML × **10 clone sets** → **50 slides** total.

---

## 1. script.js — What’s in good shape

| Area | Status | Notes |
|------|--------|--------|
| **Card refs** | ✅ Optimized | `cachedCards` built once in `init`; no `querySelector` in the hot path. |
| **transitionDuration** | ✅ Optimized | Set to `0ms` once per card in `init`; not touched every frame. |
| **Visible band** | ✅ Optimized | Only slides with `|dx| ≤ visibleMargin` get full arc math + DOM writes; others get one off-screen style. Cuts DOM work per frame. |
| **Nav guard** | ✅ Correct | `allowNav` is set false in `transitionStart`, true only after `maybeJumpToRealZone` in `transitionEnd`; no stacked transitions. |
| **Single rAF loop** | ✅ Good | One `requestAnimationFrame` loop during transition; cancelled in `stopTransitionLoop`. |
| **Early exit** | ✅ Good | `applyFerrisTransforms` returns if `!cachedCards` or length mismatch. |

---

## 2. script.js — Hot path cost (per frame)

During **drag** or **transition**:

- **Loop**: Over all 50 slides.
- **Per slide**:  
  - **In band** (~5–15 typically): `offsetWidth`, `swiperSlideOffset`, math, 3 style writes (transform, opacity, zIndex).  
  - **Out of band**: same layout read (offsetWidth, swiperSlideOffset) + 3 style writes (off-screen default).
- **No**: querySelector, transitionDuration writes, or redundant work.

So the remaining cost is: **~50 layout reads** (offsetWidth, swiperSlideOffset) + **~50 × 3 style writes** per frame. That’s acceptable for 50 slides; the visible-band logic keeps the “heavy” math to a small subset.

---

## 3. script.js — Optional / future improvements

- **Cache `slideWidth`**: Slide width is fixed (280px from CSS). You could use a constant or read once per slide and store it (e.g. on first run) to avoid `slide.offsetWidth` every frame. Small gain.
- **Reduce `cloneSets`**: With 5 originals, 10 sets = 50 slides. If 6–8 sets are enough for your UX, fewer slides = less work per frame.
- **Throttle `setTranslate`**: During drag, `setTranslate` fires very often. You could throttle to e.g. once per rAF so you don’t run `applyFerrisTransforms` twice in one frame (once from `setTranslate`, once from the rAF loop). Currently the rAF loop only runs during CSS transition, not during drag, so during drag `setTranslate` is the only driver—throttling there could reduce work on very fast drags.

---

## 4. style.css — What’s in good shape

| Area | Status | Notes |
|------|--------|--------|
| **will-change** | ✅ On correct target | `.card` has `will-change: transform, opacity` (element JS animates). |
| **Slide** | ✅ Lean | `.swiper-slide` has no transition/will-change; no extra compositor cost. |
| **Containment** | ✅ Used | `.curved-slider` has `contain: layout`; no `contain: paint` so arc can overflow. |
| **Transitions** | ✅ Scoped | Card: box-shadow only; img: transform (hover). No conflict with JS-driven transform. |

---

## 5. style.css — Remaining cost

- **backdrop-filter** on `.nav-btn` (blur 12px) and `.radius-control` (blur 16px): Expensive on low-end GPUs. Acceptable for small UI; if you need to squeeze more FPS on weak devices, you could replace with a solid/semi-opaque background or reduce blur.
- **.card** always has `will-change: transform, opacity`: Promotes the layer every time. Ideal would be to add a class (e.g. `.curved-slider.is-transitioning .card`) and set `will-change` only during transitions; that’s a small, optional refinement.

---

## 6. Summary

- **JS**: Hot path is optimized (cached refs, visible band, no redundant DOM queries or transition writes). With 50 slides, per-frame cost is reasonable; main remaining levers are fewer slides (clone sets) or throttling/caching if you scale up.
- **CSS**: Compositor hints and containment are aligned with how the script works; only optional tweaks (will-change only when transitioning, or lighter backdrop-filter) are left.

**Verdict**: Performance is in good shape for a ferris-wheel carousel of this size; no blocking issues identified. Further gains are incremental (cache slide width, fewer clones, optional CSS tweaks).
