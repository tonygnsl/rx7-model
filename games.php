<?php
require 'init.php';
require 'config.php';
require_login();

$g = $_GET['g'] ?? '';
$current = (is_string($g) && isset(GAMES[$g])) ? $g : null;
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf" content="<?= e(csrf_token()) ?>">
    <title>Jeux</title>
    <link rel="stylesheet" href="style.css?v=3">
</head>
<body>
<?php include 'nav.php'; ?>
<main class="wrap<?= $current === 'drift' ? ' wide' : '' ?>">
<?php if ($current === null): ?>
    <h1>🎮 Mini-jeux</h1>
    <div class="grid">
        <?php foreach (GAMES as $key => $info): ?>
            <a class="tile" href="games.php?g=<?= e($key) ?>">
                <span class="icon"><?= e($info['icon']) ?></span>
                <strong><?= e($info['name']) ?></strong>
                <small><?= e($info['desc']) ?></small>
            </a>
        <?php endforeach; ?>
    </div>
<?php else: $info = GAMES[$current]; ?>
    <a class="back" href="games.php">← Tous les jeux</a>
    <h1><?= e($info['icon'] . ' ' . $info['name']) ?></h1>
    <p class="muted"><?= e($info['desc']) ?></p>

    <div class="game-layout">
        <section id="game" class="panel" data-game="<?= e($current) ?>">
            <div class="hud"><span id="timer"></span></div>

            <?php if ($current === 'drift'): ?>
                <canvas id="canvas" width="900" height="560" tabindex="0"></canvas>
                <div class="dpad">
                    <button type="button" data-key="left">◀</button>
                    <button type="button" data-key="up">▲</button>
                    <button type="button" data-key="down">▼</button>
                    <button type="button" data-key="right">▶</button>
                    <button type="button" data-key="hb" class="dpad-wide">DRIFT</button>
                </div>
            <?php elseif ($current === 'click'): ?>
                <button type="button" id="clickzone" class="clickzone" disabled>Prêt ?</button>
            <?php else: ?>
                <div id="grid" class="mem-grid"></div>
            <?php endif; ?>

            <p id="status" class="status">Clique sur « Démarrer » pour jouer.</p>
            <button type="button" id="startBtn" class="btn">▶ Démarrer</button>
        </section>

        <aside class="panel">
            <h3>🏆 Top 10</h3>
            <ol id="top" class="top"></ol>
        </aside>
    </div>
<?php endif; ?>
</main>
<script src="app.js"></script>
<?php if ($current === 'drift'): ?>
<script src="drift.js"></script>
<?php endif; ?>
<?php if ($current !== 'drift') include 'bg.php'; ?>
</body>
</html>
