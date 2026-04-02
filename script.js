// Navbar scroll effect
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  if (window.scrollY > 40) {
    navbar.style.borderBottomColor = 'rgba(255,255,255,0.1)';
  } else {
    navbar.style.borderBottomColor = 'rgba(255,255,255,0.07)';
  }
});

// Intersection Observer — animate skill bars when resume section enters view
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.querySelectorAll('.skill-fill').forEach(bar => {
        bar.style.animationPlayState = 'running';
      });
    }
  });
}, { threshold: 0.2 });

const resumeSection = document.getElementById('resume');
if (resumeSection) {
  // Pause skill bars until visible
  resumeSection.querySelectorAll('.skill-fill').forEach(bar => {
    bar.style.animationPlayState = 'paused';
  });
  observer.observe(resumeSection);
}

// Active nav link on scroll
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-links a');

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navLinks.forEach(link => {
        link.style.color = link.getAttribute('href') === `#${entry.target.id}`
          ? 'var(--text)'
          : '';
      });
    }
  });
}, { threshold: 0.4 });

sections.forEach(s => sectionObserver.observe(s));

// ─── ECG Canvas Monitor ────────────────────────────────────────────────────
(function () {
  const canvas = document.getElementById('ecg-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  const BG    = '#010a03';   // very dark green-black monitor background
  const TRACE = '#00f564';   // bright phosphor green
  const GLOW  = '#00f564';
  const GRID  = 'rgba(0,200,70,0.10)';

  // ── resize canvas to its CSS size ──────────────────────────────────────
  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width  = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
    fillBg();
    drawGrid();
  }

  function fillBg() {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawGrid() {
    const W = canvas.width, H = canvas.height;
    ctx.strokeStyle = GRID;
    ctx.lineWidth   = 0.5;
    const cols = 10, rows = 4;
    for (let c = 1; c < cols; c++) {
      const x = (c / cols) * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let r = 1; r < rows; r++) {
      const y = (r / rows) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }

  // Redraw background + grid in a vertical strip (used for the erase-ahead effect)
  function eraseStrip(x, w) {
    const W = canvas.width, H = canvas.height;
    const x0 = Math.min(x, W);
    const x1 = Math.min(x + w, W);
    if (x1 <= x0) return;
    ctx.fillStyle = BG;
    ctx.fillRect(x0, 0, x1 - x0, H);
    ctx.strokeStyle = GRID;
    ctx.lineWidth   = 0.5;
    const cols = 10, rows = 4;
    for (let c = 0; c <= cols; c++) {
      const gx = (c / cols) * W;
      if (gx >= x0 && gx <= x1) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
      }
    }
    for (let r = 1; r < rows; r++) {
      const gy = (r / rows) * H;
      ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); ctx.stroke();
    }
  }

  // ── Gaussian peak helper ────────────────────────────────────────────────
  function gauss(len, center, sigma, amp) {
    const a = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      a[i] = amp * Math.exp(-0.5 * ((i - center) / sigma) ** 2);
    }
    return a;
  }

  // ── Build waveform data ─────────────────────────────────────────────────
  function buildNormalBeat(n) {
    const b = new Float32Array(n);
    const waves = [
      gauss(n, n * 0.15, 5,    0.15),   // P
      gauss(n, n * 0.39, 1.8, -0.10),   // Q
      gauss(n, n * 0.42, 3.2,  1.00),   // R
      gauss(n, n * 0.46, 2.2, -0.22),   // S
      gauss(n, n * 0.64, 9,    0.30),   // T
    ];
    for (let i = 0; i < n; i++) waves.forEach(w => { b[i] += w[i]; });
    return b;
  }

  function buildPVC(n) {
    // Wide bizarre QRS, no P, discordant T, then compensatory pause (trailing zeros)
    const b = new Float32Array(n);
    const waves = [
      gauss(n, n * 0.20, 9,    0.82),   // wide R
      gauss(n, n * 0.31, 7,   -0.40),   // deep S
      gauss(n, n * 0.48, 11,  -0.24),   // discordant T
    ];
    for (let i = 0; i < n; i++) waves.forEach(w => { b[i] += w[i]; });
    return b;
  }

  // Sequence: 3 normal → PVC → 3 normal  (loops seamlessly)
  const N = 230;   // samples per normal beat
  const P = 290;   // samples for PVC (longer — compensatory pause)
  const segments = [
    buildNormalBeat(N), buildNormalBeat(N), buildNormalBeat(N),
    buildPVC(P),
    buildNormalBeat(N), buildNormalBeat(N), buildNormalBeat(N),
  ];
  const SEQ = new Float32Array(segments.reduce((acc, s) => acc + s.length, 0));
  let offset = 0;
  segments.forEach(s => { SEQ.set(s, offset); offset += s.length; });
  const SEQ_LEN = SEQ.length;

  // ── Animation state ─────────────────────────────────────────────────────
  let sweepX  = 0;
  let dataIdx = 0;
  let prevY   = null;
  let frac    = 0;
  const SPEED = 1.4;   // px per frame  (~75 BPM looks natural at this speed)
  const AHEAD = 22;    // erase-ahead width in px

  function getY(idx) {
    const H = canvas.height;
    return H * 0.56 - SEQ[idx % SEQ_LEN] * H * 0.42;
  }

  function frame() {
    const W = canvas.width;
    frac += SPEED;
    const steps = Math.floor(frac);
    frac -= steps;

    for (let s = 0; s < steps; s++) {
      // Erase-ahead block (gives the classic monitor sweep look)
      eraseStrip((sweepX + 2) % W, AHEAD);

      const curY = getY(dataIdx);

      if (prevY !== null) {
        ctx.save();
        ctx.shadowColor = GLOW;
        ctx.shadowBlur  = 8;
        ctx.strokeStyle = TRACE;
        ctx.lineWidth   = 2;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(sweepX - 1, prevY);
        ctx.lineTo(sweepX, curY);
        ctx.stroke();
        ctx.restore();
      }

      prevY   = curY;
      sweepX  = (sweepX + 1) % W;
      if (sweepX === 0) prevY = null;   // don't connect right-edge to left-edge
      dataIdx = (dataIdx + 1) % SEQ_LEN;
    }

    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', () => {
    resize();
    sweepX = 0; dataIdx = 0; prevY = null; frac = 0;
  });
  requestAnimationFrame(frame);
})();
