const canvas = document.getElementById("heartbeat-canvas");
const ctx = canvas.getContext("2d");

let width = window.innerWidth;
let height = window.innerHeight;
let cx = width / 2;
let cy = height / 2;

function resizeCanvas() {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;
  cx = width / 2;
  cy = height / 2;
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

const config = {
  totalParticles: 1600,
  minSpeed: 9, // px/s (slow drift)
  maxSpeed: 18, // px/s
  particleBaseSize: 1.6,
  particleLifeMin: 11000, // ms
  particleLifeMax: 22000, // ms
  trailAlpha: 0.24,
  beatInterval: 2600, // ms between main beats (slower radiance)
  doubleBeatOffset: 320, // ms after main beat for second "dum"
  centerBaseOpacity: 0.48,
  centerPeakOpacity: 1.05,
  pulseDecay: 0.02,
  waveDurationMs: 1800, // faster wave so it completes before next radiance
  waveWidthFactor: 0.1, // very thin, crisp ring
  waveSizeBoost: 1.15, // very strong particle shrink at wavefront
  waveAlphaBoost: 1.6, // strong brightening at wavefront
  colorPalette: [
    { r: 235, g: 245, b: 255 }, // soft white
    { r: 200, g: 230, b: 255 }, // pale icy blue
    { r: 180, g: 220, b: 255 }, // light cyan
    { r: 220, g: 250, b: 255 } // almost white
  ]
};

let particles = [];
let lastFrameTime = performance.now();
let timeSinceLastMainBeat = 0;
let pendingSecondaryBeatAt = null;
let centerPulse = config.centerBaseOpacity;
let waveBursts = [];

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function pickColor() {
  return config.colorPalette[Math.floor(Math.random() * config.colorPalette.length)];
}

function createParticle(randomPosition = true) {
  const angle = Math.random() * Math.PI * 2;
  const speed = randRange(config.minSpeed, config.maxSpeed);

  let x, y;
  if (randomPosition) {
    x = Math.random() * width;
    y = Math.random() * height;
  } else {
    const radius = randRange(0, Math.min(width, height) * 0.15);
    x = cx + Math.cos(angle) * radius;
    y = cy + Math.sin(angle) * radius;
  }

  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size: randRange(config.particleBaseSize * 0.6, config.particleBaseSize * 1.4),
    life: 0,
    maxLife: randRange(config.particleLifeMin, config.particleLifeMax),
    color: pickColor(),
    flickerSeed: Math.random() * 10
  };
}

function initParticles() {
  particles = [];
  for (let i = 0; i < config.totalParticles; i++) {
    particles.push(createParticle(true));
  }
}

function resetParticle(p) {
  const fresh = createParticle(true);
  p.x = fresh.x;
  p.y = fresh.y;
  p.vx = fresh.vx;
  p.vy = fresh.vy;
  p.size = fresh.size;
  p.life = 0;
  p.maxLife = fresh.maxLife;
  p.color = fresh.color;
  p.flickerSeed = fresh.flickerSeed;
}

function updateParticles(dtMs) {
  const dt = dtMs / 1000; // seconds
  const margin = 40;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];

    p.life += dtMs;
    if (p.life > p.maxLife) {
      resetParticle(p);
    }

    // Gentle wandering: slight random turning + slow drift
    const turn = randRange(-0.2, 0.2) * dt;
    const cosT = Math.cos(turn);
    const sinT = Math.sin(turn);
    const vx = p.vx;
    const vy = p.vy;
    p.vx = vx * cosT - vy * sinT;
    p.vy = vx * sinT + vy * cosT;

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Wrap around the edges to keep density consistent
    if (p.x < -margin) p.x = width + margin;
    else if (p.x > width + margin) p.x = -margin;

    if (p.y < -margin) p.y = height + margin;
    else if (p.y > height + margin) p.y = -margin;
  }
}

function drawCenterRadiance() {
  const radius = Math.min(width, height) * 0.32;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);

  const pulse = centerPulse;
  gradient.addColorStop(0, `rgba(235, 245, 255, ${0.6 * pulse})`);
  gradient.addColorStop(0.45, `rgba(180, 220, 255, ${0.3 * pulse})`);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

function renderFrame(now) {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(2, 6, 20, ${config.trailAlpha})`;
  ctx.fillRect(0, 0, width, height);

  // Decay center pulse back toward base opacity
  centerPulse += (config.centerBaseOpacity - centerPulse) * config.pulseDecay;

  ctx.globalCompositeOperation = "lighter";

  drawCenterRadiance();

  const maxDist = Math.hypot(width, height) * 0.6;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];

    const dx = p.x - cx;
    const dy = p.y - cy;
    const dist = Math.hypot(dx, dy);
    const distFactor = 1 - Math.min(dist / maxDist, 1);

    const baseAlpha = 0.2 + 0.25 * distFactor;
    const flicker = 0.5 + 0.5 * Math.sin((p.life / 400) + p.flickerSeed);
    let waveAmp = 0;

    // Radial wave(s) travelling from center to edge
    for (let j = 0; j < waveBursts.length; j++) {
      const burst = waveBursts[j];
      const age = now - burst.time;
      if (age < 0 || age > config.waveDurationMs) continue;

      const radius = (age / config.waveDurationMs) * maxDist;
      const diff = dist - radius;
      const sigma = config.waveWidthFactor * maxDist;
      const local =
        Math.exp(-(diff * diff) / (2 * sigma * sigma)) * burst.strength;

      if (local > waveAmp) waveAmp = local;
    }

    // At wavefront: particles get much smaller and noticeably brighter
    let waveSizeScale = 1 - waveAmp * config.waveSizeBoost;
    waveSizeScale = Math.max(0.2, waveSizeScale);
    const waveAlphaScale = 1 + waveAmp * config.waveAlphaBoost;

    const alpha = baseAlpha * (0.65 + 0.35 * flicker) * waveAlphaScale;
    const size =
      p.size * (0.8 + 0.4 * distFactor + 0.2 * centerPulse * distFactor) * waveSizeScale;

    // Slightly push color towards pure white at wavefront
    const whiten = Math.min(1, waveAmp * 1.1);
    const cr = Math.round(p.color.r + (255 - p.color.r) * whiten);
    const cg = Math.round(p.color.g + (255 - p.color.g) * whiten);
    const cb = Math.round(p.color.b + (255 - p.color.b) * whiten);

    ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}

function loop(now) {
  const dtMs = now - lastFrameTime;
  lastFrameTime = now;

  const safeDt = dtMs > 200 ? 200 : dtMs;
  timeSinceLastMainBeat += safeDt;

  // Main beat
  if (timeSinceLastMainBeat >= config.beatInterval) {
    timeSinceLastMainBeat -= config.beatInterval;
    centerPulse = config.centerPeakOpacity;
    waveBursts.push({ time: now, strength: 1 });
    pendingSecondaryBeatAt = now + config.doubleBeatOffset;
  }

  // Second "ba-dum"
  if (pendingSecondaryBeatAt !== null && now >= pendingSecondaryBeatAt) {
    centerPulse = Math.max(centerPulse, config.centerPeakOpacity * 0.95);
    waveBursts.push({ time: now, strength: 0.7 });
    pendingSecondaryBeatAt = null;
  }

  // Remove finished waves
  waveBursts = waveBursts.filter(
    (burst) => now - burst.time < config.waveDurationMs
  );

  updateParticles(safeDt);
  renderFrame(now);

  requestAnimationFrame(loop);
}

initParticles();

requestAnimationFrame((t) => {
  lastFrameTime = t;
  requestAnimationFrame(loop);
});
