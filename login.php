<?php
declare(strict_types=1);

$configFile = __DIR__ . '/app-config.php';
if (!is_readable($configFile)) {
    $configFile = __DIR__ . '/config.php';
}
$config = require $configFile;

$sessionName = $config['session_name'] ?? 'lawyer_session';
$secureCookie = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
if (session_status() === PHP_SESSION_NONE) {
    session_name($sessionName);
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $secureCookie,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

if (!empty($_SESSION['lawyer_auth'])) {
    header('Location: lawyer.html');
    exit;
}

$loginConfigured = !empty($config['lawyer_user'])
    && (!empty($config['lawyer_pass']) || !empty($config['lawyer_pass_hash']));
$error = '';
$username = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = trim((string)($_POST['username'] ?? ''));
    $password = (string)($_POST['password'] ?? '');

    if (!$loginConfigured) {
        $error = 'Login nao configurado. Configure LAWYER_USER e LAWYER_PASS ou LAWYER_PASS_HASH no .env.';
    } else {
        $userOk = hash_equals((string)$config['lawyer_user'], $username);
        $passOk = false;
        if (!empty($config['lawyer_pass_hash'])) {
            $hash = (string)$config['lawyer_pass_hash'];
            if (strpos($hash, 'pbkdf2_sha256$') === 0) {
                $parts = explode('$', $hash, 4);
                if (count($parts) === 4) {
                    $iterations = (int)$parts[1];
                    $salt = $parts[2];
                    $expected = $parts[3];
                    if ($iterations > 0 && $salt !== '' && $expected !== '') {
                        $derived = hash_pbkdf2('sha256', $password, $salt, $iterations, 32, true);
                        $candidate = base64_encode($derived);
                        $passOk = hash_equals($expected, $candidate);
                    }
                }
            } else {
                $passOk = password_verify($password, $hash);
            }
        } elseif (!empty($config['lawyer_pass'])) {
            $passOk = hash_equals((string)$config['lawyer_pass'], $password);
        }

        if ($userOk && $passOk) {
            session_regenerate_id(true);
            $_SESSION['lawyer_auth'] = true;
            $_SESSION['lawyer_user'] = $username;
            header('Location: lawyer.html');
            exit;
        }

        $error = 'Usuario ou senha invalidos.';
    }
}
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login do Advogado</title>
    <link rel="stylesheet" href="style.css?v=black-gold-2">
</head>
<body class="login-page">
    <main class="login-main">
        <div class="login-card">
            <h1>Area do Advogado</h1>
            <p class="login-subtitle">Entre para acessar o painel.</p>
            <?php if ($error !== ''): ?>
                <div class="login-error"><?php echo htmlspecialchars($error, ENT_QUOTES, 'UTF-8'); ?></div>
            <?php endif; ?>
            <form method="post" action="login.php" autocomplete="on">
                <label for="username">Usuario</label>
                <input
                    id="username"
                    name="username"
                    type="text"
                    autocomplete="username"
                    required
                    value="<?php echo htmlspecialchars($username, ENT_QUOTES, 'UTF-8'); ?>"
                >
                <label for="password">Senha</label>
                <input
                    id="password"
                    name="password"
                    type="password"
                    autocomplete="current-password"
                    required
                >
                <button type="submit">Entrar</button>
            </form>
        </div>
    </main>
</body>
</html>
