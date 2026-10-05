<?php
// ratelimit.php : limites par utilisateur enregistrées en base
// (elles résistent à la suppression des cookies, des messages ou des scores)

// Retourne null si l'action est autorisée, 'delay' si elle est trop rapprochée
// de la précédente, 'hour' si le quota horaire est dépassé.
// Une action refusée n'est pas comptée.
function rate_take(mysqli $conn, int $uid, string $action, int $minDelay, int $maxPerHour): ?string {
    $stmt = $conn->prepare("DELETE FROM rate_log WHERE user_id = ? AND created_at < (NOW() - INTERVAL 1 DAY)");
    $stmt->bind_param('i', $uid);
    $stmt->execute();
    $stmt->close();

    // On enregistre d'abord l'action, puis on vérifie : deux requêtes simultanées se voient
    // l'une l'autre et sont toutes les deux refusées.
    $stmt = $conn->prepare("INSERT INTO rate_log (user_id, action) VALUES (?, ?)");
    $stmt->bind_param('is', $uid, $action);
    $stmt->execute();
    $mine = $conn->insert_id;
    $stmt->close();

    $stmt = $conn->prepare(
        "SELECT COUNT(*), COALESCE(MIN(TIMESTAMPDIFF(SECOND, created_at, NOW())), 999999)
         FROM rate_log
         WHERE user_id = ? AND action = ? AND id <> ? AND created_at > (NOW() - INTERVAL 1 HOUR)"
    );
    $stmt->bind_param('isi', $uid, $action, $mine);
    $stmt->execute();
    $stmt->bind_result($others, $since);
    $stmt->fetch();
    $stmt->close();

    $verdict = null;
    if ((int) $others >= $maxPerHour) {
        $verdict = 'hour';
    } elseif ((int) $since < $minDelay) {
        $verdict = 'delay';
    }

    if ($verdict !== null) {
        $stmt = $conn->prepare("DELETE FROM rate_log WHERE id = ?");
        $stmt->bind_param('i', $mine);
        $stmt->execute();
        $stmt->close();
    }
    return $verdict;
}
