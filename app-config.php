<?php
declare(strict_types=1);

$envPath = __DIR__ . '/.env';
if (is_readable($envPath)) {
    $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '' || strpos($trimmed, '#') === 0) {
            continue;
        }
        $parts = explode('=', $trimmed, 2);
        if (count($parts) !== 2) {
            continue;
        }
        $key = trim($parts[0]);
        $value = trim($parts[1]);
        if ($key === '') {
            continue;
        }
        if (getenv($key) === false) {
            putenv($key . '=' . $value);
        }
        $_ENV[$key] = $value;
    }
}

$apiKey = getenv('GROQ_API_KEY') ?: getenv('OPENAI_API_KEY') ?: '';
$baseUrl = getenv('GROQ_BASE_URL') ?: getenv('OPENAI_BASE_URL') ?: 'https://api.groq.com/openai/v1';
$model = getenv('GROQ_MODEL') ?: getenv('OPENAI_MODEL') ?: 'llama-3.3-70b-versatile';

return [
    'db_path' => __DIR__ . '/chat.db',
    'ai_api_key' => $apiKey,
    'ai_base_url' => $baseUrl,
    'ai_model' => $model,
];
