// Climb Mind - Skill Climber (High Difficulty Edition)
// 高難度・スキル依存・やり直しが楽しい版

// ====================== ユーティリティ ======================

class RNG {
  constructor(seed) {
    this.seed = seed >>> 0;
  }
  next() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 0xffffffff;
  }
  range(min, max) {
    return min + (max - min) * this.next();
  }
  choice(arr) {
    return arr[(this.next() * arr.length) | 0];
  }
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ====================== 入力 ======================

class Input {
  constructor() {
    this.left = false;
    this.right = false;
    this.jumpHeld = false;
    this.jumpPressed = false;
    this.jumpReleased = false;

    this._jumpBufferTime = 120;
    this._jumpBufferTimer = 0;

    window.addEventListener("keydown", e => this.onKey(e, true));
    window.addEventListener("keyup", e => this.onKey(e, false));
  }

  onKey(e, down) {
    const code = e.code;
    if (code === "ArrowLeft" || code === "KeyA") this.left = down;
    if (code === "ArrowRight" || code === "KeyD") this.right = down;
    if (code === "Space" || code === "KeyW" || code === "ArrowUp") {
      if (down && !this.jumpHeld) {
        this.jumpPressed = true;
        this._jumpBufferTimer = this._jumpBufferTime;
      }
      this.jumpHeld = down;
      if (!down) this.jumpReleased = true;
    }
  }

  update(dt) {
    if (this._jumpBufferTimer > 0) {
      this._jumpBufferTimer -= dt;
      if (this._jumpBufferTimer <= 0) {
        this.jumpPressed = false;
      }
    }
  }
}

// ====================== プレイヤー物理 ======================

class Player {
  constructor(level, input, physicsConfig) {
    this.level = level;
    this.input = input;
    this.config = physicsConfig;

    this.width = 28;
    this.height = 40;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;

    this.onGround = false;
    this.coyoteTime = 90;
    this.coyoteTimer = 0;

    this.jumpCharge = 0;
    this.maxJumpCharge = physicsConfig.maxJumpCharge;
    this.isChargingJump = false;
    this.jumpQueued = false;

    this.facing = 1;
    this.color = "#ffdd55";

    this.missCount = 0;
    this.successCount = 0;
    this.largeFallCount = 0;
    this.lastGroundY = 0;
    this.peakHeight = 0;
    this.totalJumps = 0;

    this.consecutiveFails = 0;
    this.jumpHistory = [];
  }

  resetAt(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.coyoteTimer = 0;
    this.jumpCharge = 0;
    this.isChargingJump = false;
    this.jumpQueued = false;
    this.lastGroundY = y;
    this.totalJumps = 0;
    this.missCount = 0;
    this.successCount = 0;
    this.largeFallCount = 0;
    this.peakHeight = y;
    this.consecutiveFails = 0;
    this.jumpHistory.length = 0;
  }

  update(dt) {
    const cfg = this.config;
    const inp = this.input;
    const dtSec = dt / 1000;

    // 横移動（空中はかなり制限）
    const moveDir = (inp.left ? -1 : 0) + (inp.right ? 1 : 0);
    if (moveDir !== 0) this.facing = moveDir;
    const accel = this.onGround ? cfg.runAccel : cfg.runAccel * cfg.airControl;
    this.vx += moveDir * accel * dtSec;
    if (this.onGround) {
      this.vx -= this.vx * cfg.groundFriction * dtSec;
    } else {
      this.vx -= this.vx * cfg.airFriction * dtSec;
    }
    this.vx = clamp(this.vx, -cfg.maxRunSpeed, cfg.maxRunSpeed);

    // ジャンプチャージ（地上＆コヨーテ中のみ）
    if (this.onGround || this.coyoteTimer > 0) {
      if (inp.jumpHeld) {
        this.isChargingJump = true;
        this.jumpCharge = clamp(
          this.jumpCharge + dt,
          0,
          this.maxJumpCharge
        );
      }
      if (inp.jumpReleased && this.isChargingJump) {
        this.jumpQueued = true;
      }
    } else {
      this.isChargingJump = false;
      this.jumpCharge = 0;
      this.jumpQueued = false;
    }

    // コヨーテ
    if (this.onGround) {
      this.coyoteTimer = this.coyoteTime;
    } else if (this.coyoteTimer > 0) {
      this.coyoteTimer -= dt;
    }

    // ジャンプ実行
    if (this.jumpQueued && (this.onGround || this.coyoteTimer > 0)) {
      const chargeNorm = this.jumpCharge / this.maxJumpCharge;
      const jumpStrength =
        cfg.minJumpImpulse + (cfg.maxJumpImpulse - cfg.minJumpImpulse) * chargeNorm;
      this.vy = -jumpStrength;
      this.onGround = false;
      this.coyoteTimer = 0;
      this.isChargingJump = false;
      this.jumpQueued = false;
      this.totalJumps++;
      this.jumpHistory.push({
        charge: chargeNorm,
        direction: this.facing,
        time: performance.now()
      });
      flashNarration(chargeNorm > 0.8 ? "完璧な溜めだ。" : "悪くないジャンプだ。", 400);
    }

    // 重力
    this.vy += cfg.gravity * dtSec;
    if (this.vy > cfg.maxFallSpeed) this.vy = cfg.maxFallSpeed;

    // 移動＆当たり判定
    const oldX = this.x;
    const oldY = this.y;
    let newX = this.x + this.vx * dtSec;
    let newY = this.y + this.vy * dtSec;

    const collisions = this.level.checkCollision(this, newX, newY);

    this.onGround = false;
    if (collisions.horizontal) {
      this.vx = 0;
      newX = collisions.correctedX;
    }
    if (collisions.vertical) {
      if (this.vy > 0) {
        this.onGround = true;
        spawnLandingEffect(this.x, this.y + this.height / 2, this.vy);
      }
      this.vy = 0;
      newY = collisions.correctedY;
    }

    // 大落下
    if (this.onGround) {
      if (this.lastGroundY - newY < -180) {
        this.largeFallCount++;
        this.consecutiveFails++;
      } else if (this.lastGroundY - newY > -40) {
        // 軽いズレ程度なら「成功」とみなす
        this.consecutiveFails = 0;
      }
      this.lastGroundY = newY;
    }

    if (newY < this.peakHeight) {
      this.peakHeight = newY;
    }

    this.x = newX;
    this.y = newY;
    this.input.jumpReleased = false;
  }

  draw(ctx, camera, debugCollision) {
    const cx = this.x - camera.x;
    const cy = this.y - camera.y;

    ctx.fillStyle = this.color;
    ctx.fillRect(
      Math.round(cx - this.width / 2),
      Math.round(cy - this.height / 2),
      this.width,
      this.height
    );

    // チャージゲージ
    if (this.isChargingJump) {
      const chargeNorm = this.jumpCharge / this.maxJumpCharge;
      const barW = 46;
      const barH = 6;
      ctx.fillStyle = "#000";
      ctx.fillRect(
        Math.round(cx - barW / 2),
        Math.round(cy - this.height / 2 - 12),
        barW,
        barH
      );
      ctx.fillStyle = chargeNorm > 0.75 ? "#ff6666" : "#66ff88";
      ctx.fillRect(
        Math.round(cx - barW / 2),
        Math.round(cy - this.height / 2 - 12),
        barW * chargeNorm,
        barH
      );
    }

    if (debugCollision) {
      ctx.strokeStyle = "rgba(0,255,0,0.7)";
      ctx.strokeRect(
        Math.round(cx - this.width / 2),
        Math.round(cy - this.height / 2),
        this.width,
        this.height
      );
    }
  }
}

// ====================== カメラ ======================

class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.targetX = 0;
    this.targetY = 0;
    this.targetZoom = 1;
    this.timeScale = 1;
    this.targetTimeScale = 1;
  }

  update(dt, player, heightStats) {
    const dtSec = dt / 1000;
    this.targetX = player.x;
    this.targetY = player.y - 90;

    const fallingFast = player.vy > 500;
    const fallingFar = heightStats.currentFallDistance > 220;
    this.targetZoom = fallingFast || fallingFar ? 0.83 : 1.02;

    // ニアミス時スローモーション
    const nearMiss = heightStats.nearMissActive;
    this.targetTimeScale = nearMiss ? 0.55 : 1;

    const lerpSpeed = 6;
    this.x = lerp(this.x, this.targetX, dtSec * lerpSpeed);
    this.y = lerp(this.y, this.targetY, dtSec * lerpSpeed);
    this.zoom = lerp(this.zoom, this.targetZoom, dtSec * 3);
    this.timeScale = lerp(this.timeScale, this.targetTimeScale, dtSec * 5);
  }

  applyTransform(ctx, canvas) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    ctx.translate(cx, cy);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-Math.round(this.x), -Math.round(this.y));
  }
}

// ====================== レベル生成（高難度調整） ======================

class Platform {
  constructor(x, y, w, type = "normal") {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = 16;
    this.type = type;
  }

  draw(ctx, camera, debugCollision) {
    const cx = this.x - camera.x;
    const cy = this.y - camera.y;
    let color = "#666";
    if (this.type === "slide") color = "#4477aa";
    else if (this.type === "lowgrav") color = "#7ddde0";
    else if (this.type === "bounce") color = "#ff9b3d";
    else if (this.type === "sticky") color = "#a5dd6f";
    else if (this.type === "crumble") color = "#aa5555";

    ctx.fillStyle = color;
    ctx.fillRect(
      Math.round(cx - this.w / 2),
      Math.round(cy - this.h / 2),
      this.w,
      this.h
    );

    if (debugCollision) {
      ctx.strokeStyle = "rgba(255,255,0,0.5)";
      ctx.strokeRect(
        Math.round(cx - this.w / 2),
        Math.round(cy - this.h / 2),
        this.w,
        this.h
      );
    }
  }
}

class Level {
  constructor(seed, difficultyProfile) {
    this.seed = seed;
    this.rng = new RNG(seed);
    this.platforms = [];
    this.startX = 0;
    this.startY = 0;
    this.goalHeight = -1800;
    this.difficultyProfile = difficultyProfile;
    this.segmentTypes = [];
  }

  generate(playerHistory) {
    this.platforms.length = 0;
    this.segmentTypes.length = 0;

    const successRate = playerHistory.successRate ?? 0.4;
    const avgMissHeight = playerHistory.avgMissHeight ?? 170;
    const rightWeak = playerHistory.rightWeak ?? false;

    let baseGapY = 140;
    if (successRate > 0.6) baseGapY = 170;
    if (successRate < 0.35) baseGapY = 125;

    const segments = [];
    const add = (type, height) => {
      segments.push({ type, height });
      this.segmentTypes.push(type);
    };

    // ドラマ構造：安心 → 事故 → 休憩 → 極悪
    add("recovery", 220);
    add("precision", 320);
    add("rhythm", 320);
    add("feint", 180);
    add("brutal", 420);

    if (successRate > 0.65) add("brutal", 250);
    if (playerHistory.recentFalls > 4) add("recovery", 200);

    this.platforms.push(new Platform(0, 40, 380, "normal"));
    this.startX = 0;
    this.startY = 0;
    let curX = 0;
    let curY = 0;

    for (const seg of segments) {
      switch (seg.type) {
        case "recovery":
          this.generateRecovery(curX, curY, seg.height, baseGapY);
          break;
        case "precision":
          this.generatePrecision(curX, curY, seg.height, avgMissHeight);
          break;
        case "rhythm":
          this.generateRhythm(curX, curY, seg.height, baseGapY);
          break;
        case "feint":
          this.generateFeint(curX, curY, seg.height);
          break;
        case "brutal":
          this.generateBrutal(curX, curY, seg.height, rightWeak);
          break;
      }
      curY -= seg.height;
      curX += this.rng.range(-50, 50);
    }
    this.goalHeight = curY - 80;

    // 公平性チェック＆補正
    for (let i = 0; i < 4; i++) {
      if (this.testPlayable()) break;
      baseGapY -= 10;
      this.platforms.length = 0;
      this.platforms.push(new Platform(0, 40, 380, "normal"));
      curX = 0;
      curY = 0;
      for (const seg of segments) {
        this.generateRecovery(curX, curY, seg.height, baseGapY);
        curY -= seg.height;
        curX += this.rng.range(-30, 30);
      }
      this.goalHeight = curY - 80;
    }
  }

  generateRecovery(x, y, height, baseGapY) {
    const count = Math.floor(height / baseGapY);
    for (let i = 1; i <= count; i++) {
      const py = y - i * baseGapY;
      const px = x + this.rng.range(-40, 40);
      const w = this.rng.range(90, 130);
      const type = this.rng.next() < 0.2 ? "lowgrav" : "normal";
      this.platforms.push(new Platform(px, py, w, type));
    }
  }

  generatePrecision(x, y, height, avgMissHeight) {
    const gap = clamp(avgMissHeight * 0.95, 110, 190);
    const count = Math.floor(height / gap);
    for (let i = 1; i <= count; i++) {
      const py = y - i * gap;
      const px = x + this.rng.range(-80, 80);
      const w = this.rng.range(40, 65);
      const type = this.rng.next() < 0.35 ? "sticky" : "normal";
      this.platforms.push(new Platform(px, py, w, type));
    }
  }

  generateRhythm(x, y, height, baseGapY) {
    const gap = baseGapY * 0.95;
    const count = Math.floor(height / gap);
    let dir = this.rng.choice([-1, 1]);
    for (let i = 1; i <= count; i++) {
      const py = y - i * gap;
      const px = x + dir * 75;
      const w = 70;
      const type = this.rng.next() < 0.25 ? "slide" : "normal";
      this.platforms.push(new Platform(px, py, w, type));
      x = px;
      dir *= -1;
    }
  }

  generateFeint(x, y, height) {
    const gap = 135;
    const count = Math.floor(height / gap);
    for (let i = 1; i <= count; i++) {
      const py = y - i * gap;
      const realX = x + this.rng.range(-40, 40);
      const w = 65;
      const fakeOffset = this.rng.range(80, 120);
      const fakeX = this.rng.choice([realX - fakeOffset, realX + fakeOffset]);
      this.platforms.push(new Platform(realX, py, w, "normal"));
      this.platforms.push(
        new Platform(fakeX, py + this.rng.range(-18, 18), 80, "slide")
      );
    }
  }

  generateBrutal(x, y, height, rightWeak) {
    const gap = 170;
    const count = Math.floor(height / gap);
    let dir = rightWeak ? -1 : this.rng.choice([-1, 1]);
    for (let i = 1; i <= count; i++) {
      const py = y - i * gap;
      const px = x + dir * this.rng.range(90, 130);
      const w = this.rng.range(38, 60);
      const type = this.rng.choice(["normal", "bounce", "crumble"]);
      this.platforms.push(new Platform(px, py, w, type));
      x = px;
      dir *= -1;
    }
  }

  testPlayable() {
    // 簡易AIによる「理論上クリア可能」チェック
    const phys = {
      gravity: 1350,
      runAccel: 1900,
      maxRunSpeed: 230,
      groundFriction: 13,
      airFriction: 1.8,
      airControl: 0.32,
      minJumpImpulse: 430,
      maxJumpImpulse: 780,
      maxJumpCharge: 380
    };
    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;
    let onGround = true;
    let coyote = 0;
    const dt = 1000 / 60;

    for (let steps = 0; steps < 900; steps++) {
      const dtSec = dt / 1000;
      const target = this.platforms.find(
        p => p.y < y - 40 && Math.abs(p.x - x) < 190
      );
      let moveDir = 0;
      if (target) moveDir = target.x > x ? 1 : -1;

      vx += moveDir * phys.runAccel * dtSec;
      if (onGround) {
        vx -= vx * phys.groundFriction * dtSec;
      } else {
        vx -= vx * phys.airFriction * dtSec;
      }
      vx = clamp(vx, -phys.maxRunSpeed, phys.maxRunSpeed);

      if (onGround && target && Math.abs(target.x - x) < 150) {
        vy = -phys.minJumpImpulse;
        onGround = false;
      }

      vy += phys.gravity * dtSec;
      if (vy > 1000) vy = 1000;

      let newX = x + vx * dtSec;
      let newY = y + vy * dtSec;

      const collisions = this.checkCollisionSimple(x, y, 28, 40, newX, newY);
      onGround = false;
      if (collisions.horizontal) {
        vx = 0;
        newX = collisions.correctedX;
      }
      if (collisions.vertical) {
        if (vy > 0) onGround = true;
        vy = 0;
        newY = collisions.correctedY;
      }

      x = newX;
      y = newY;

      if (y < this.goalHeight) return true;
      if (y > 160) return false;
    }
    return false;
  }

  checkCollisionSimple(oldX, oldY, w, h, newX, newY) {
    const result = {
      horizontal: false,
      vertical: false,
      correctedX: newX,
      correctedY: newY
    };
    const halfW = w / 2;
    const halfH = h / 2;

    for (const p of this.platforms) {
      const left = p.x - p.w / 2;
      const right = p.x + p.w / 2;
      const top = p.y - p.h / 2;
      const bottom = p.y + p.h / 2;

      if (
        oldX + halfW > left &&
        oldX - halfW < right &&
        oldY + halfH <= top &&
        newY + halfH >= top
      ) {
        result.vertical = true;
        result.correctedY = top - halfH;
      }

      if (
        oldY + halfH > top &&
        oldY - halfH < bottom &&
        oldX <= left &&
        newX + halfW >= left
      ) {
        result.horizontal = true;
        result.correctedX = left - halfW;
      }
      if (
        oldY + halfH > top &&
        oldY - halfH < bottom &&
        oldX >= right &&
        newX - halfW <= right
      ) {
        result.horizontal = true;
        result.correctedX = right + halfW;
      }
    }
    return result;
  }

  checkCollision(player, newX, newY) {
    const result = {
      horizontal: false,
      vertical: false,
      correctedX: newX,
      correctedY: newY
    };

    const oldX = player.x;
    const oldY = player.y;
    const w = player.width;
    const h = player.height;
    const halfW = w / 2;
    const halfH = h / 2;

    let gravityFactor = 1;
    let slideFactor = 1;
    let stickyFactor = 1;
    let bounceImpulse = 0;
    const crumbleTargets = [];

    for (const p of this.platforms) {
      const left = p.x - p.w / 2;
      const right = p.x + p.w / 2;
      const top = p.y - p.h / 2;
      const bottom = p.y + p.h / 2;

      // 垂直
      if (
        oldX + halfW > left &&
        oldX - halfW < right &&
        oldY + halfH <= top &&
        newY + halfH >= top
      ) {
        result.vertical = true;
        result.correctedY = top - halfH;

        if (p.type === "lowgrav") gravityFactor = 0.6;
        else if (p.type === "slide") slideFactor = 1.7;
        else if (p.type === "sticky") stickyFactor = 0.35;
        else if (p.type === "bounce") bounceImpulse = Math.max(bounceImpulse, 760);
        else if (p.type === "crumble") crumbleTargets.push(p);
      }

      // 水平
      if (
        oldY + halfH > top &&
        oldY - halfH < bottom &&
        oldX <= left &&
        newX + halfW >= left
      ) {
        result.horizontal = true;
        result.correctedX = left - halfW;
      }
      if (
        oldY + halfH > top &&
        oldY - halfH < bottom &&
        oldX >= right &&
        newX - halfW <= right
      ) {
        result.horizontal = true;
        result.correctedX = right + halfW;
      }
    }

    if (!player.config.gravityBase) player.config.gravityBase = player.config.gravity;
    if (gravityFactor !== 1) {
      player.config.gravity = player.config.gravityBase * gravityFactor;
    } else {
      player.config.gravity = player.config.gravityBase;
    }
    if (slideFactor !== 1) player.vx *= slideFactor;
    if (stickyFactor !== 1) player.vx *= stickyFactor;
    if (bounceImpulse > 0) player.vy = -bounceImpulse;

    if (crumbleTargets.length > 0) {
      setTimeout(() => {
        this.platforms = this.platforms.filter(p => !crumbleTargets.includes(p));
      }, 220);
    }

    return result;
  }

  draw(ctx, camera, debugCollision) {
    for (const p of this.platforms) {
      p.draw(ctx, camera, debugCollision);
    }

    // ゴールライン
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(this.startX - 200 - camera.x, this.goalHeight - camera.y);
    ctx.lineTo(this.startX + 200 - camera.x, this.goalHeight - camera.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ====================== 演出・UI ======================

const narrationBox = document.getElementById("narrationBox");
let narrationTimeout = null;
function setNarration(text, duration = 1200) {
  narrationBox.textContent = text;
  narrationBox.style.opacity = "1";
  if (narrationTimeout) clearTimeout(narrationTimeout);
  narrationTimeout = setTimeout(() => {
    narrationBox.style.opacity = "0";
  }, duration);
}
function flashNarration(text, duration) {
  setNarration(text, duration);
}

const nearMissBox = document.getElementById("nearMissBox");
let nearMissTimeout = null;
function showNearMiss(pxDiff) {
  nearMissBox.textContent = `あと ${pxDiff.toFixed(1)} px で届いていた。`;
  nearMissBox.style.opacity = "1";
  if (nearMissTimeout) clearTimeout(nearMissTimeout);
  nearMissTimeout = setTimeout(() => {
    nearMissBox.style.opacity = "0";
  }, 900);
}

const particles = [];
function spawnLandingEffect(x, y, vy) {
  const n = clamp(Math.abs(vy) / 80, 5, 22) | 0;
  for (let i = 0; i < n; i++) {
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 140,
      vy: -Math.random() * 140,
      life: 340,
      size: 2 + Math.random() * 2
    });
  }
}
function updateParticles(dt) {
  const dtSec = dt / 1000;
  for (const p of particles) {
    p.life -= dt;
    p.vy += 1000 * dtSec;
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].life <= 0) particles.splice(i, 1);
  }
}
function drawParticles(ctx, camera) {
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  for (const p of particles) {
    const cx = p.x - camera.x;
    const cy = p.y - camera.y;
    ctx.globalAlpha = clamp(p.life / 340, 0, 1);
    ctx.fillRect(cx - p.size / 2, cy - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

// ナレーションAI（高難度向けチューニング）
function updateNarrationAI(player, heightStats, dt, state) {
  state.timeSinceLastNarration += dt;

  const height = -heightStats.bestHeight;
  const nearGoal = heightStats.bestHeight < state.level.goalHeight + 120;
  const fails = player.consecutiveFails;

  if (height <= 10 && state.timeSinceLastNarration > 3500) {
    setNarration("ここはまだ準備運動だ。自分の癖を観察しろ。");
    state.timeSinceLastNarration = 0;
  } else if (nearGoal && state.timeSinceLastNarration > 2200) {
    setNarration("ここからの一手一手が全てだ。焦るな。");
    state.timeSinceLastNarration = 0;
  }

  if (fails >= 4 && state.timeSinceLastNarration > 2500) {
    setNarration("落ち方がパターン化している。入力のタイミングを変えてみよう。");
    state.timeSinceLastNarration = 0;
  } else if (fails === 2 && state.timeSinceLastNarration > 2500) {
    setNarration("いいぞ、その悔しさは次の一段を作る。");
    state.timeSinceLastNarration = 0;
  }

  if (heightStats.lastFallDistance > 280 && !state.lastFallNarrationDone) {
    setNarration("見事な転落だ。でも山は逃げない。", 1800);
    state.lastFallNarrationDone = true;
  }
}

// ====================== メインセットアップ ======================

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

const input = new Input();

const physicsConfig = {
  gravity: 1500,
  groundFriction: 16,
  airFriction: 2.2,
  runAccel: 1950,
  maxRunSpeed: 240,
  airControl: 0.3, // 空中制御弱め
  maxFallSpeed: 1050,
  minJumpImpulse: 430,
  maxJumpImpulse: 840,
  maxJumpCharge: 420
};

let seed = (Date.now() * 2654435761) | 0;
let playerHistory = {
  successRate: 0.4,
  avgMissHeight: 170,
  recentFalls: 0,
  rightWeak: false
};

let level = new Level(seed, {});
level.generate(playerHistory);
const player = new Player(level, input, physicsConfig);
player.resetAt(level.startX, level.startY - 18);
const camera = new Camera();

const heightDisplay = document.getElementById("heightDisplay");
const bestHeightDisplay = document.getElementById("bestHeightDisplay");
const timeDisplay = document.getElementById("timeDisplay");
const seedDisplay = document.getElementById("seedDisplay");
const accuracyDisplay = document.getElementById("accuracyDisplay");
const stabilityDisplay = document.getElementById("stabilityDisplay");
const riskDisplay = document.getElementById("riskDisplay");
const regenButton = document.getElementById("regenButton");
const segmentDisplay = document.getElementById("segmentDisplay");
const moodDisplay = document.getElementById("moodDisplay");
const progressBarFill = document.getElementById("progressBarFill");

// Debug UI
const gravityInput = document.getElementById("gravityInput");
const frictionInput = document.getElementById("frictionInput");
const airControlInput = document.getElementById("airControlInput");
const jumpChargeInput = document.getElementById("jumpChargeInput");
const debugCollisionInput = document.getElementById("debugCollisionInput");

gravityInput.value = physicsConfig.gravity;
frictionInput.value = physicsConfig.groundFriction;
airControlInput.value = physicsConfig.airControl;
jumpChargeInput.value = physicsConfig.maxJumpCharge;

gravityInput.addEventListener("change", () => {
  physicsConfig.gravity = parseFloat(gravityInput.value) || physicsConfig.gravity;
});
frictionInput.addEventListener("change", () => {
  physicsConfig.groundFriction = parseFloat(frictionInput.value) || physicsConfig.groundFriction;
});
airControlInput.addEventListener("change", () => {
  physicsConfig.airControl = parseFloat(airControlInput.value) || physicsConfig.airControl;
});
jumpChargeInput.addEventListener("change", () => {
  physicsConfig.maxJumpCharge = parseFloat(jumpChargeInput.value) || physicsConfig.maxJumpCharge;
});

regenButton.addEventListener("click", () => {
  restartWithSameSeed();
});

seedDisplay.textContent = seed >>> 0;

const runStats = {
  startTime: performance.now(),
  bestHeight: 0,
  lastHeight: 0,
  lastFallDistance: 0,
  currentFallDistance: 0,
  nearMissActive: false
};

const narrationState = {
  timeSinceLastNarration: 0,
  lastFallNarrationDone: false,
  level
};

let lastTime = performance.now();

function restartWithSameSeed() {
  level = new Level(seed, {});
  level.generate(playerHistory);
  narrationState.level = level;

  player.resetAt(level.startX, level.startY - 18);
  runStats.startTime = performance.now();
  runStats.bestHeight = 0;
  runStats.lastHeight = 0;
  runStats.lastFallDistance = 0;
  runStats.currentFallDistance = 0;
  runStats.nearMissActive = false;
}

function restartWithNewSeed() {
  seed = ((seed + 1) * 2654435761) | 0;
  seedDisplay.textContent = seed >>> 0;
  level = new Level(seed, {});
  level.generate(playerHistory);
  narrationState.level = level;
  player.resetAt(level.startX, level.startY - 18);
  runStats.startTime = performance.now();
  runStats.bestHeight = 0;
  runStats.lastHeight = 0;
  runStats.lastFallDistance = 0;
  runStats.currentFallDistance = 0;
  runStats.nearMissActive = false;
}

function loop(now) {
  let dt = now - lastTime;
  lastTime = now;

  // カメラのタイムスケールを適用（スローモーション用）
  dt *= camera.timeScale;

  input.update(dt);
  update(dt);
  render(dt);

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function update(dt) {
  player.update(dt);

  const height = -(player.y - level.startY);
  if (height > runStats.bestHeight) runStats.bestHeight = height;

  if (height < runStats.lastHeight) {
    runStats.currentFallDistance += runStats.lastHeight - height;
  } else {
    if (runStats.currentFallDistance > 80) {
      runStats.lastFallDistance = runStats.currentFallDistance;
      narrationState.lastFallNarrationDone = false;
    }
    runStats.currentFallDistance = 0;
  }
  runStats.lastHeight = height;

  // ゴール
  if (player.y < level.goalHeight) {
    setNarration("登頂成功。今日は自分を褒めていい。", 2600);
    evaluateSkill();
    restartWithNewSeed();
  }

  // ニアミス系スローモーション
  if (runStats.lastFallDistance > 130 && runStats.currentFallDistance === 0) {
    runStats.nearMissActive = true;
    const pxDiff = 20 + Math.random() * 40;
    showNearMiss(pxDiff);
    setTimeout(() => {
      runStats.nearMissActive = false;
    }, 600);
  }

  updateNarrationAI(player, runStats, dt, narrationState);
  camera.update(dt, player, runStats);
  updateParticles(dt);

  heightDisplay.textContent = (height / 10).toFixed(1);
  bestHeightDisplay.textContent = (runStats.bestHeight / 10).toFixed(1);
  const t = (performance.now() - runStats.startTime) / 1000;
  timeDisplay.textContent = t.toFixed(1);

  // 進捗バー
  const progress = clamp(
    (level.startY - player.y) / (level.startY - level.goalHeight),
    0,
    1
  );
  progressBarFill.style.width = (progress * 100).toFixed(1) + "%";

  // 区間表示・ムード
  const segName = getCurrentSegmentName(progress, level.segmentTypes);
  segmentDisplay.textContent = segName;
  moodDisplay.textContent = getMoodLabel(player, runStats);

  // デスゾーン
  if (player.y - camera.y > canvas.height / 2 + 220) {
    playerHistory.recentFalls++;
    player.consecutiveFails++;
    setNarration("その落下にも情報がある。何がずれた？", 1700);
    restartWithSameSeed();
  }
}

function render(dt) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  camera.applyTransform(ctx, canvas);

  const grad = ctx.createLinearGradient(
    -canvas.width,
    level.goalHeight - 400,
    canvas.width,
    level.startY + 300
  );
  grad.addColorStop(0, "#151d30");
  grad.addColorStop(0.5, "#0a0e18");
  grad.addColorStop(1, "#05060a");
  ctx.fillStyle = grad;
  ctx.fillRect(
    camera.x - canvas.width,
    level.goalHeight - 600,
    canvas.width * 2,
    level.startY - level.goalHeight + 1200
  );

  const debugCollision = debugCollisionInput.checked;
  level.draw(ctx, camera, debugCollision);
  player.draw(ctx, camera, debugCollision);
  drawParticles(ctx, camera);
}

// 区間名・ムード表示
function getCurrentSegmentName(progress, segments) {
  if (!segments || segments.length === 0) return "-";
  const idx = clamp(Math.floor(progress * segments.length), 0, segments.length - 1);
  const type = segments[idx];
  switch (type) {
    case "recovery":
      return "回復区間";
    case "precision":
      return "精密ジャンプ";
    case "rhythm":
      return "リズムジャンプ";
    case "feint":
      return "フェイント";
    case "brutal":
      return "極悪ゾーン";
    default:
      return "-";
  }
}

function getMoodLabel(player, stats) {
  if (stats.currentFallDistance > 180) return "転落モード";
  if (player.consecutiveFails >= 4) return "心折りにくる";
  if (stats.bestHeight > -level.goalHeight * 0.7) return "山頂の気配";
  if (stats.bestHeight > -level.goalHeight * 0.3) return "慣れてきた";
  return "ウォームアップ";
}

// スキル評価＆学習(PDCAのC/A)
function evaluateSkill() {
  const climbs = runStats.bestHeight / 10;
  const totalFalls = player.largeFallCount + player.missCount;
  const accuracy = clamp(climbs / (player.totalJumps + 1), 0, 1);
  const stability = clamp(1 - totalFalls / (player.totalJumps + 4), 0, 1);
  const risk = clamp(player.largeFallCount / (player.totalJumps + 1), 0, 1);

  function grade(v) {
    if (v > 0.8) return "S";
    if (v > 0.6) return "A";
    if (v > 0.4) return "B";
    if (v > 0.25) return "C";
    return "D";
  }

  accuracyDisplay.textContent = `${grade(accuracy)} (${(accuracy * 100).toFixed(0)}%)`;
  stabilityDisplay.textContent = `${grade(stability)} (${(stability * 100).toFixed(0)}%)`;
  riskDisplay.textContent = `${grade(risk)} (${(risk * 100).toFixed(0)}%)`;

  // プレイヤー履歴更新（次シード用）
  playerHistory.successRate = accuracy;
  playerHistory.avgMissHeight = clamp(runStats.lastFallDistance, 90, 220);
  playerHistory.rightWeak = false;
}

// ====================== バグチェック ======================

// 1. 生成されたレベルに足場が存在するか
console.assert(level.platforms.length > 0, "No platforms generated");

// 2. RNG の決定性
(function rngTest() {
  const s = 123456;
  const a = new RNG(s);
  const b = new RNG(s);
  for (let i = 0; i < 10; i++) {
    console.assert(
      Math.abs(a.next() - b.next()) < 1e-9,
      "RNG not deterministic"
    );
  }
})();

// 3. プレイヤー簡易更新テスト
(function quickPlayerTest() {
  const testPlayer = new Player(level, new Input(), JSON.parse(JSON.stringify(physicsConfig)));
  testPlayer.resetAt(level.startX, level.startY - 18);
  for (let i = 0; i < 5; i++) {
    testPlayer.update(16);
    console.assert(
      !isNaN(testPlayer.x) && !isNaN(testPlayer.y),
      "Player position became NaN"
    );
  }
})();
