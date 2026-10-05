<?php
require 'init.php';
require 'config.php';
require 'ratelimit.php';

const SCORE_MIN_DELAY    = 3;
const SCORE_MAX_PER_HOUR = 60;
const MEMORY_MIN_SECONDS = 12;
const DRIFT_MAX_PER_SEC  = 600;   // points max par seconde de jeu (survie + drift)
const DRIFT_MAX_SECONDS  = 3600;  // une partie ne peut pas durer plus d'une heure

header('Content-Type: application/json; charset=utf-8');

function out(int $code, array $data): void {
    http_response_code($code);
    echo json_encode($data);
    exit;
}

function too_fast(): bool {
    $now = microtime(true);
    if ($now - ($_SESSION['last_submit'] ?? 0) < 2) {
        return true;
    }
    $_SESSION['last_submit'] = $now;
    return false;
}

function save_score(mysqli $conn, int $uid, string $game, int $score): void {
    $stmt = $conn->prepare("INSERT INTO scores (user_id, game, score) VALUES (?, ?, ?)");
    $stmt->bind_param('isi', $uid, $game, $score);
    $stmt->execute();
    $stmt->close();
}

if (!isset($_SESSION['user_id'])) {
    out(401, ['error' => 'Non connecté']);
}
$uid = (int) $_SESSION['user_id'];

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $game = $_GET['game'] ?? '';
    if (!is_string($game) || !isset(GAMES[$game])) {
        out(400, ['error' => 'Jeu inconnu']);
    }
    $stmt = $conn->prepare(
        "SELECT u.username, MAX(s.score) AS best FROM scores s
         JOIN users u ON u.id = s.user_id
         WHERE s.game = ? GROUP BY u.id, u.username ORDER BY best DESC LIMIT 10"
    );
    $stmt->bind_param('s', $game);
    $stmt->execute();
    $res = $stmt->get_result();
    $top = [];
    while ($row = $res->fetch_assoc()) {
        $top[] = ['username' => $row['username'], 'score' => (int) $row['best']];
    }
    $stmt->close();
    out(200, ['top' => $top]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    out(405, ['error' => 'Méthode non autorisée']);
}
if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
    out(415, ['error' => 'Type de contenu invalide']);
}
if (!csrf_valid($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null)) {
    out(403, ['error' => 'Jeton CSRF invalide']);
}

$in = json_decode(file_get_contents('php://input', false, null, 0, 2048), true);
if (!is_array($in)) {
    out(400, ['error' => 'Requête invalide']);
}
$action = $in['action'] ?? '';
$game   = $in['game'] ?? '';
if (!is_string($action) || !is_string($game) || !isset(GAMES[$game])) {
    out(400, ['error' => 'Requête invalide']);
}

if ($action === 'start') {
    $state = ['name' => $game, 'start' => microtime(true)];
    if ($game === 'memory') {
        $cards = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7];
        for ($i = 15; $i > 0; $i--) {
            $j = random_int(0, $i);
            [$cards[$i], $cards[$j]] = [$cards[$j], $cards[$i]];
        }
        $state += ['board' => $cards, 'matched' => [], 'open' => null, 'moves' => 0];
    }
    $_SESSION['game'] = $state;
    out(200, ['ok' => true]);
}

if ($action === 'flip' && $game === 'memory') {
    $st = $_SESSION['game'] ?? null;
    if (!is_array($st) || $st['name'] !== 'memory') {
        out(400, ['error' => 'Aucune partie en cours']);
    }
    $i = filter_var($in['index'] ?? null, FILTER_VALIDATE_INT);
    if ($i === false || $i < 0 || $i > 15) {
        out(400, ['error' => 'Carte invalide']);
    }
    if (in_array($i, $st['matched'], true) || $st['open'] === $i) {
        out(400, ['error' => 'Carte déjà retournée']);
    }
    $value = $st['board'][$i];

    if ($st['open'] === null) {
        $st['open'] = $i;
        $_SESSION['game'] = $st;
        out(200, ['value' => $value]);
    }

    $first = $st['open'];
    $st['open'] = null;
    $st['moves']++;

    if ($st['board'][$first] === $value) {
        $st['matched'][] = $first;
        $st['matched'][] = $i;
        if (count($st['matched']) === 16) {
            $seconds = (int) round(microtime(true) - $st['start']);
            $moves = $st['moves'];
            unset($_SESSION['game']);

            $score = 0;
            if ($seconds >= MEMORY_MIN_SECONDS
                && rate_take($conn, $uid, 'score', SCORE_MIN_DELAY, SCORE_MAX_PER_HOUR) === null) {
                $score = max(0, 1000 - $seconds * 5 - $moves * 12);
                save_score($conn, $uid, 'memory', $score);
            }
            out(200, ['value' => $value, 'match' => true, 'done' => true,
                      'score' => $score, 'moves' => $moves, 'seconds' => $seconds]);
        }
        $_SESSION['game'] = $st;
        out(200, ['value' => $value, 'match' => true, 'done' => false]);
    }

    $_SESSION['game'] = $st;
    out(200, ['value' => $value, 'match' => false]);
}

if ($action === 'submit' && $game !== 'memory') {
    $st = $_SESSION['game'] ?? null;
    unset($_SESSION['game']);   // une partie = un seul envoi
    if (!is_array($st) || $st['name'] !== $game) {
        out(400, ['error' => 'Aucune partie en cours']);
    }
    $duration = microtime(true) - $st['start'];
    $score = filter_var($in['score'] ?? null, FILTER_VALIDATE_INT);
    if ($score === false || $score < 0) {
        out(400, ['error' => 'Score invalide']);
    }

    if ($game === 'drift') {
        // le score ne peut pas depasser ce qu'il est possible de marquer pendant la duree reelle de la partie
        if ($duration < 2 || $duration > DRIFT_MAX_SECONDS) {
            out(400, ['error' => 'Durée incohérente']);
        }
        $max = (int) floor($duration * DRIFT_MAX_PER_SEC) + 200;
    } else {
        if ($duration < 9.5 || $duration > 30) {
            out(400, ['error' => 'Durée incohérente']);
        }
        $max = min(150, (int) floor($duration * 15));
    }
    if ($score > $max) {
        out(400, ['error' => 'Score incohérent, refusé']);
    }
    if (too_fast()) {
        out(429, ['error' => 'Trop rapide, réessaie dans un instant']);
    }
    $verdict = rate_take($conn, $uid, 'score', SCORE_MIN_DELAY, SCORE_MAX_PER_HOUR);
    if ($verdict === 'hour') {
        out(429, ['error' => 'Limite de ' . SCORE_MAX_PER_HOUR . ' scores par heure atteinte']);
    }
    if ($verdict === 'delay') {
        out(429, ['error' => 'Trop rapide, réessaie dans un instant']);
    }
    save_score($conn, $uid, $game, $score);
    out(200, ['ok' => true, 'score' => $score]);
}

out(400, ['error' => 'Action inconnue']);
