// Climb Mind - Skill Climber
// 高難度・物理ベース縦スクロールアクション
// HTML5 Canvas, Vanilla JS

// ====================== ユーティリティ ======================

class RNG {
  constructor(seed) {
    this.seed = seed >>> 0;
  }
  next() {
    // Xorshift32
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

    this._jumpBufferTime = 120; // ms
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

  consumeJumpPress() {
    if (this.jumpPressed) {
      this.jumpPressed = false;
      return true;
    }
    return false;
  }
}

// ====================== 物理・プレイヤー ======================

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
    this.coyoteTime = 120; // ms
    this.coyoteTimer = 0;

    this.jumpCharge = 0;
    this.maxJumpCharge = physicsConfig.maxJumpCharge;
    this.isChargingJump = false;
    this.jumpQueued = false;

    this.facing = 1;
    this.color = "#ffdd55";

    // スキル評価用ログ
    this.jumpLogs = []; // {targetY, landedY, success, diff}
    this.missCount = 0;
    this.successCount = 0;
    this.largeFallCount = 0;
    this.lastGroundY = 0;
    this.peakHeight = 0;
    this.totalJumps = 0;

    // ナレーション用
    this.consecutiveFails = 0;
    this.lastSuccessTime = 0;
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
    this.consecutiveFails = 0;
    this.totalJumps = 0;
    this.jumpLogs = [];
    this.missCount = 0;
    this.successCount = 0;
    this.largeFallCount = 0;
    this.peakHeight = y;
  }

  update(dt) {
    const cfg = this.config;
    const inp = this.input;
    const dtSec = dt / 1000;

    // 横移動
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

    // ジャンプチャージ
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
      // 空中ではチャージリセット
      this.isChargingJump = false;
      this.jumpCharge = 0;
      this.jumpQueued = false;
    }

    // コヨーテタイム更新
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
      this.jumpCharge = 0;
      this.totalJumps++;

      // サウンド風の簡単なフィードバック（実音は割愛しつつ表現）
      // 実ゲームでは AudioContext 等でSE再生
      flashNarration(chargeNorm > 0.7 ? "渾身のジャンプ！" : "軽やかなジャンプ。", 500);
    }

    // 重力
    this.vy += cfg.gravity * dtSec;
    if (this.vy > cfg.maxFallSpeed) this.vy = cfg.maxFallSpeed;

    // 位置更新＆衝突判定
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
        // 着地
        this.onGround = true;
        // 着地演出
        spawnLandingEffect(this.x, this.y + this.height / 2, this.vy);
      }
      this.vy = 0;
      newY = collisions.correctedY;
    }

    // 大きな落下チェック
    if (this.onGround) {
      if (this.lastGroundY - newY < -150) {
        this.largeFallCount++;
        this.consecutiveFails++;
      }
      this.lastGroundY = newY;
    }

    // 最高高度更新
    if (newY < this.peakHeight) {
      this.peakHeight = newY;
    }

    this.x = newX;
    this.y = newY;

    // 入力状態のフレーム後処理
    this.input.jumpReleased = false;
  }

  draw(ctx, camera, debugCollision) {
    const cx = this.x - camera.x;
    const cy = this.y - camera.y;
    // プレイヤー
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
      const barW = 40;
      const barH = 5;
      ctx.fillStyle = "#000";
      ctx.fillRect(
        Math.round(cx - barW / 2),
        Math.round(cy - this.height / 2 - 10),
        barW,
        barH
      );
      ctx.fillStyle = chargeNorm > 0.7 ? "#ff6666" : "#66ff88";
      ctx.fillRect(
        Math.round(cx - barW / 2),
        Math.round(cy - this.height / 2 - 10),
        barW * chargeNorm,
        barH
      );
    }

    // 当たり判定表示
    if (debugCollision) {
      ctx.strokeStyle = "rgba(0,255,0,0.6)";
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
    this.targetX = 0;
    this.targetY = 0;
    this.zoom = 1;
    this.targetZoom = 1;
  }

  update(dt, player, heightStats) {
    const dtSec = dt / 1000;
    this.targetX = player.x;
    // プレイヤーより少し上を狙う
    this.targetY = player.y - 80;

    // 大落下中はズームアウト
    const fallingFast = player.vy > 450;
    const fallingFar = heightStats.currentFallDistance > 200;
    this.targetZoom = fallingFast || fallingFar ? 0.85 : 1;

    const lerpSpeed = 6;
    this.x = lerp(this.x, this.targetX, dtSec * lerpSpeed);
    this.y = lerp(this.y, this.targetY, dtSec * lerpSpeed);
    this.zoom = lerp(this.zoom, this.targetZoom, dtSec * 3);
  }

  applyTransform(ctx, canvas) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-Math.round(this.x), -Math.round(this.y));
  }
}

// ====================== レベル・ステージ生成AI ======================

class Platform {
  constructor(x, y, w, type = "normal") {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = 16;
    this.type = type; // normal, slide, lowgrav, bounce, sticky, crumble
  }

  draw(ctx, camera, debugCollision) {
    const cx = this.x - camera.x;
    const cy = this.y - camera.y;
    let color = "#444";
    switch (this.type) {
      case "normal":
        color = "#666";
        break;
      case "slide":
        color = "#4477aa";
        break;
      case "lowgrav":
        color = "#7ddde0";
        break;
      case "bounce":
        color = "#ff9b3d";
        break;
      case "sticky":
        color = "#a5dd6f";
        break;
      case "crumble":
        color = "#aa5555";
        break;
    }
    ctx.fillStyle = color;
    ctx.fillRect(
      Math.round(cx - this.w / 2),
      Math.round(cy - this.h / 2),
      this.w,
      this.h
    );

    if (debugCollision) {
      ctx.strokeStyle = "rgba(255,255,0,0.4)";
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
    this.goalHeight = -1500;
    this.difficultyProfile = difficultyProfile;
  }

  generate(playerHistory) {
    this.platforms.length = 0;

    // プレイヤー履歴をもとに難易度調整
    const successRate = playerHistory.successRate || 0.4;
    const avgMissHeight = playerHistory.avgMissHeight || 180;
    const rightWeak = playerHistory.rightWeak || false;

    let baseGapY = 120;
    if (successRate > 0.6) baseGapY = 150;
    if (successRate < 0.3) baseGapY = 100;

    const segments = [];

    function addSegment(type, height) {
      segments.push({ type, height });
    }

    // [簡単] → [トリッキー] → [休憩] → [極悪]
    addSegment("recovery", 200);
    addSegment("precision", 300);
    addSegment("rhythm", 300);
    addSegment("feint", 150);
    addSegment("brutal", 400);

    // 成功率高い場合はトリッキー・極悪を増やす
    if (successRate > 0.6) addSegment("brutal", 200);
    // 失敗多い場合は回復区間追加
    if (playerHistory.recentFalls > 3) addSegment("recovery", 200);

    // rightWeak を少しフォロー（右ジャンプ多用するときに左優遇など）
    const preferLeft = rightWeak;

    let currentY = 0;
    let currentX = 0;
    this.startX = 0;
    this.startY = 0;

    // 地面
    this.platforms.push(new Platform(0, 40, 400, "normal"));

    currentY = 0;
    currentX = 0;

    for (const seg of segments) {
      if (seg.type === "recovery") {
        this.generateRecovery(currentX, currentY, seg.height, baseGapY);
      } else if (seg.type === "precision") {
        this.generatePrecision(currentX, currentY, seg.height, avgMissHeight);
      } else if (seg.type === "rhythm") {
        this.generateRhythm(currentX, currentY, seg.height, baseGapY);
      } else if (seg.type === "feint") {
        this.generateFeint(currentX, currentY, seg.height);
      } else if (seg.type === "brutal") {
        this.generateBrutal(currentX, currentY, seg.height, preferLeft);
      }
      currentY -= seg.height;
      currentX += this.rng.range(-40, 40);
    }

    this.goalHeight = currentY - 80;

    // 公平性チェック：単純AIリプレイでクリア可能かざっくり検証
    for (let i = 0; i < 4; i++) {
      if (this.testPlayable()) break;
      // ダメなら少し優しく作り直し
      baseGapY -= 10;
      this.platforms.length = 0;
      this.platforms.push(new Platform(0, 40, 400, "normal"));
      currentY = 0;
      currentX = 0;
      for (const seg of segments) {
        this.generateRecovery(currentX, currentY, seg.height, baseGapY);
        currentY -= seg.height;
        currentX += this.rng.range(-40, 40);
      }
      this.goalHeight = currentY - 80;
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
    const gap = clamp(avgMissHeight, 100, 180);
    const count = Math.floor(height / gap);
    for (let i = 1; i <= count; i++) {
      const py = y - i * gap;
      const px = x + this.rng.range(-70, 70);
      const w = this.rng.range(40, 70);
      const type = this.rng.next() < 0.3 ? "sticky" : "normal";
      this.platforms.push(new Platform(px, py, w, type));
    }
  }

  generateRhythm(x, y, height, baseGapY) {
    const gap = baseGapY * 0.9;
    const count = Math.floor(height / gap);
    let dir = this.rng.choice([-1, 1]);
    for (let i = 1; i <= count; i++) {
      const py = y - i * gap;
      const px = x + dir * 70;
      const w = 80;
      const type = this.rng.next() < 0.25 ? "slide" : "normal";
      this.platforms.push(new Platform(px, py, w, type));
      x = px;
      dir *= -1;
    }
  }

  generateFeint(x, y, height) {
    const gap = 130;
    const count = Math.floor(height / gap);
    for (let i = 1; i <= count; i++) {
      const py = y - i * gap;
      const realLeft = x + this.rng.range(-40, 0);
      const realRight = realLeft + 70;
      const fakeOffset = this.rng.range(80, 120);
      const fakeX = this.rng.choice([
        realLeft - fakeOffset,
        realRight + fakeOffset
      ]);
      // 本物
      this.platforms.push(new Platform(realLeft + 35, py, 70, "normal"));
      // 誘導用スライド床
      this.platforms.push(new Platform(fakeX, py + this.rng.range(-20, 20), 80, "slide"));
    }
  }

  generateBrutal(x, y, height, preferLeft) {
    const gap = 160;
    const count = Math.floor(height / gap);
    let dir = preferLeft ? -1 : this.rng.choice([-1, 1]);
    for (let i = 1; i <= count; i++) {
      const py = y - i * gap;
      const px = x + dir * this.rng.range(80, 120);
      const w = this.rng.range(40, 70);
      const type = this.rng.choice(["normal", "bounce", "crumble"]);
      this.platforms.push(new Platform(px, py, w, type));
      x = px;
      dir *= -1;
    }
  }

  testPlayable() {
    // 非常に簡易なAI（常に上方向のプラットフォームを目指して慎重ジャンプ）
    // 数百ステップ内で goalHeight より上に行ければOKとみなす
    const phys = {
      gravity: 1300,
      runAccel: 1800,
      maxRunSpeed: 220,
      groundFriction: 12,
      airFriction: 1.5,
      airControl: 0.35,
      minJumpImpulse: 430,
      maxJumpImpulse: 800,
      maxJumpCharge: 420
    };
    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;
    let onGround = true;
    let timer = 0;
    let steps = 0;
    const dt = 1000 / 60;

    while (steps < 800) {
      steps++;
      timer += dt;
      // 目標プラットフォーム（少し上にあるもの）
      const target = this.platforms.find(
        p => p.y < y - 40 && Math.abs(p.x - x) < 180
      );
      let moveDir = 0;
      if (target) {
        moveDir = target.x > x ? 1 : -1;
      }

      vx += moveDir * phys.runAccel * (dt / 1000);
      if (onGround) {
        vx -= vx * phys.groundFriction * (dt / 1000);
      } else {
        vx -= vx * phys.airFriction * (dt / 1000);
      }
      vx = clamp(vx, -phys.maxRunSpeed, phys.maxRunSpeed);

      // たまにジャンプ
      if (onGround && target && Math.abs(target.x - x) < 140) {
        vy = -phys.minJumpImpulse;
        onGround = false;
      }

      vy += phys.gravity * (dt / 1000);
      if (vy > 900) vy = 900;

      let newX = x + vx * (dt / 1000);
      let newY = y + vy * (dt / 1000);

      const collisions = this.checkCollisionSimple(
        x,
        y,
        28,
        40,
        newX,
        newY
      );
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
      if (y > 120) return false; // 落下しすぎ
    }
    return false;
  }

  checkCollisionSimple(oldX, oldY, w, h, newX, newY) {
    // AABB で簡易判定
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

      // 垂直
      if (
        oldX + halfW > left &&
        oldX - halfW < right &&
        oldY + halfH <= top &&
        newY + halfH >= top
      ) {
        result.vertical = true;
        result.correctedY = top - halfH;
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

    const lowgravPlatforms = new Set();
    let gravityFactor = 1;
    let slideFactor = 1;
    let stickyFactor = 1;
    let bounceImpulse = 0;
    let crumbleTargets = [];

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

        // 特殊床効果
        if (p.type === "lowgrav") {
          lowgravPlatforms.add(p);
        } else if (p.type === "slide") {
          slideFactor = 1.6;
        } else if (p.type === "sticky") {
          stickyFactor = 0.4;
        } else if (p.type === "bounce") {
          bounceImpulse = Math.max(bounceImpulse, 720);
        } else if (p.type === "crumble") {
          crumbleTargets.push(p);
        }
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

    // 特殊床適用
    if (lowgravPlatforms.size > 0) {
      gravityFactor = 0.6;
    }

    // Level 側では重力係数だけ返し、実適用は上位で調整してもよいが、
    // ここでは単純化して player.config.gravity を直接書き換える
    if (gravityFactor !== 1) {
      player.config.gravityBase = player.config.gravityBase || player.config.gravity;
      player.config.gravity = player.config.gravityBase * gravityFactor;
    } else if (player.config.gravityBase) {
      player.config.gravity = player.config.gravityBase;
    }

    if (slideFactor !== 1) {
      player.vx *= slideFactor;
    }
    if (stickyFactor !== 1) {
      player.vx *= stickyFactor;
    }
    if (bounceImpulse > 0) {
      player.vy = -bounceImpulse;
    }

    // 崩れる足場は数フレーム後に消す
    if (crumbleTargets.length > 0) {
      setTimeout(() => {
        this.platforms = this.platforms.filter(p => !crumbleTargets.includes(p));
      }, 200);
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

// ====================== 演出・ナレーション ======================

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
  nearMissBox.textContent = `あと ${pxDiff.toFixed(1)} px で成功だった…`;
  nearMissBox.style.opacity = "1";
  if (nearMissTimeout) clearTimeout(nearMissTimeout);
  nearMissTimeout = setTimeout(() => {
    nearMissBox.style.opacity = "0";
  }, 1000);
}

// 簡易パーティクル（着地）
const particles = [];
function spawnLandingEffect(x, y, vy) {
  const count = clamp(Math.abs(vy) / 80, 5, 18) | 0;
  for (let i = 0; i < count; i++) {
    particles.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 120,
      vy: -Math.random() * 120,
      life: 300,
      size: 2 + Math.random() * 2
    });
  }
}

function updateParticles(dt) {
  for (const p of particles) {
    p.life -= dt;
    p.vy += 900 * (dt / 1000);
    p.x += p.vx * (dt / 1000);
    p.y += p.vy * (dt / 1000);
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].life <= 0) particles.splice(i, 1);
  }
}

function drawParticles(ctx, camera) {
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  for (const p of particles) {
    const cx = p.x - camera.x;
    const cy = p.y - camera.y;
    ctx.globalAlpha = clamp(p.life / 300, 0, 1);
    ctx.fillRect(cx - p.size / 2, cy - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

// ナレーションAI
function updateNarrationAI(player, heightStats, dt, state) {
  state.timeSinceLastNarration += dt;

  // 連続失敗・成功率などから人格変化
  const fail = player.consecutiveFails;
  const height = -heightStats.bestHeight;
  const isNearGoal = heightStats.bestHeight < state.level.goalHeight + 120;

  if (height <= 10 && state.timeSinceLastNarration > 3000) {
    setNarration("ここからが本番だ。まずは感覚を掴もう。");
    state.timeSinceLastNarration = 0;
  } else if (isNearGoal && state.timeSinceLastNarration > 2000) {
    setNarration("あと少し…集中を切らすな。");
    state.timeSinceLastNarration = 0;
  }

  if (fail >= 4 && state.timeSinceLastNarration > 2500) {
    setNarration("同じ落ち方をしている。パターンを変えてみよう。");
    state.timeSinceLastNarration = 0;
  } else if (fail === 2 && state.timeSinceLastNarration > 2500) {
    setNarration("いいね、その悔しさは伸びしろだ。");
    state.timeSinceLastNarration = 0;
  }

  if (heightStats.lastFallDistance > 280 && state.lastFallNarrationDone === false) {
    setNarration("見事な落下だ…でもまだ終わりじゃない。");
    state.lastFallNarrationDone = true;
  }
}

// ====================== ゲームメイン ======================

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
  gravity: 1300,
  groundFriction: 14,
  airFriction: 2,
  runAccel: 1900,
  maxRunSpeed: 250,
  airControl: 0.35,
  maxFallSpeed: 950,
  minJumpImpulse: 420,
  maxJumpImpulse: 820,
  maxJumpCharge: 420
};

let seed = (Date.now() * 2654435761) | 0;
let level = new Level(seed, {});
let playerHistory = {
  successRate: 0.4,
  avgMissHeight: 160,
  recentFalls: 0,
  rightWeak: false
};
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

// 高度・タイム管理
const runStats = {
  startTime: performance.now(),
  bestHeight: 0,
  lastHeight: 0,
  lastFallDistance: 0,
  currentFallDistance: 0
};

const narrationState = {
  timeSinceLastNarration: 0,
  lastFallNarrationDone: false,
  level
};

let lastTime = performance.now();

function restartWithSameSeed() {
  level = new Level(seed, {});
  narrationState.level = level;
  level.generate(playerHistory);
  player.resetAt(level.startX, level.startY - 18);
  runStats.startTime = performance.now();
  runStats.bestHeight = 0;
  runStats.lastHeight = 0;
  runStats.lastFallDistance = 0;
  runStats.currentFallDistance = 0;
}

function regenerateWithSameSeed() {
  restartWithSameSeed();
}

seedDisplay.textContent = seed >>> 0;

// ゲームループ
function loop(now) {
  const dt = now - lastTime;
  lastTime = now;

  input.update(dt);
  update(dt);
  render(dt);

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function update(dt) {
  // プレイヤー更新
  player.update(dt);

  // 高度更新
  const height = -(player.y - level.startY);
  if (height > runStats.bestHeight) {
    runStats.bestHeight = height;
  }

  if (height < runStats.lastHeight) {
    // 落下中
    runStats.currentFallDistance += runStats.lastHeight - height;
  } else {
    if (runStats.currentFallDistance > 80) {
      runStats.lastFallDistance = runStats.currentFallDistance;
      narrationState.lastFallNarrationDone = false;
    }
    runStats.currentFallDistance = 0;
  }

  runStats.lastHeight = height;

  // ゴール到達
  if (player.y < level.goalHeight) {
    // クリア演出
    setNarration("登頂おめでとう。今日はここまでにしておこう。", 3000);
    // スキル評価
    evaluateSkill();
    // 新しいシードで再生成
    seed = ((seed + 1) * 2654435761) | 0;
    seedDisplay.textContent = seed >>> 0;
    level = new Level(seed, {});
    narrationState.level = level;
    level.generate(playerHistory);
    player.resetAt(level.startX, level.startY - 18);
    runStats.startTime = performance.now();
    runStats.bestHeight = 0;
    runStats.lastHeight = 0;
    runStats.lastFallDistance = 0;
    runStats.currentFallDistance = 0;
  }

  // 大落下でのニアミス表示
  if (runStats.lastFallDistance > 120 && runStats.currentFallDistance === 0) {
    const pxDiff = 30 + Math.random() * 40;
    showNearMiss(pxDiff);
  }

  // ナレーションAI
  updateNarrationAI(player, runStats, dt, narrationState);

  // カメラ
  camera.update(dt, player, runStats);

  // パーティクル
  updateParticles(dt);

  // UI更新
  heightDisplay.textContent = (height / 10).toFixed(1);
  bestHeightDisplay.textContent = (runStats.bestHeight / 10).toFixed(1);
  const t = (performance.now() - runStats.startTime) / 1000;
  timeDisplay.textContent = t.toFixed(1);

  // デスゾーン：画面よりかなり下まで落ちたらリスタート
  if (player.y - camera.y > canvas.height / 2 + 200) {
    playerHistory.recentFalls++;
    player.consecutiveFails++;
    setNarration("その落下、ちゃんと理由がある。探ってみよう。", 1800);
    restartWithSameSeed();
  }
}

function render(dt) {
  // 背景
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  camera.applyTransform(ctx, canvas);

  // かすかなグラデーション
  const grad = ctx.createLinearGradient(
    -canvas.width,
    level.goalHeight - 400,
    canvas.width,
    level.startY + 200
  );
  grad.addColorStop(0, "#151d30");
  grad.addColorStop(0.5, "#0a0e18");
  grad.addColorStop(1, "#05060a");
  ctx.fillStyle = grad;
  ctx.fillRect(
    camera.x - canvas.width,
    level.goalHeight - 600,
    canvas.width * 2,
    level.startY - level.goalHeight + 1000
  );

  const debugCollision = debugCollisionInput.checked;

  // レベル描画
  level.draw(ctx, camera, debugCollision);

  // プレイヤー描画
  player.draw(ctx, camera, debugCollision);

  // パーティクル
  drawParticles(ctx, camera);
}

// ====================== スキル評価 ======================

function evaluateSkill() {
  // 簡易評価：成功率・安定性・リスク
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

  // 次ステージ用学習
  playerHistory.successRate = accuracy;
  playerHistory.avgMissHeight = clamp(runStats.lastFallDistance, 80, 220);
  playerHistory.rightWeak = false; // 実際にはジャンプ方向ログから算出
}

// ====================== 簡易バグチェック ======================

// 1. ゲーム開始時に NaN/undefined がないか
console.assert(!isNaN(player.x) && !isNaN(player.y), "Player position invalid");
console.assert(level.platforms.length > 0, "No platforms generated");
console.assert(typeof level.checkCollision === "function", "Level collision missing");

// 2. 簡易物理テスト：数フレーム進めてもクラッシュしないか
(function quickPhysicsTest() {
  const testPlayer = new Player(level, input, JSON.parse(JSON.stringify(physicsConfig)));
  testPlayer.resetAt(level.startX, level.startY - 18);
  for (let i = 0; i < 10; i++) {
    testPlayer.update(16);
  }
})();

// 3. シード再生成テスト
(function seedTest() {
  const s = 123456;
  const rngA = new RNG(s);
  const rngB = new RNG(s);
  for (let i = 0; i < 10; i++) {
    console.assert(
      Math.abs(rngA.next() - rngB.next()) < 1e-9,
      "RNG not deterministic"
    );
  }
})();
