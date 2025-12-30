<?php
declare(strict_types=1);

$configFile = __DIR__ . '/app-config.php';
if (!is_readable($configFile)) {
    $configFile = __DIR__ . '/config.php';
}
$config = require $configFile;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function get_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function open_db(string $path): SQLite3
{
    if (!class_exists('SQLite3')) {
        json_response(['error' => 'SQLite3 extension not available.'], 500);
    }
    $db = new SQLite3($path);
    $db->busyTimeout(5000);
    return $db;
}

function init_db(SQLite3 $db): void
{
    $db->exec(
        'CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id TEXT,
            client_name TEXT,
            client_location TEXT,
            client_phone TEXT,
            message TEXT,
            is_client_message BOOLEAN,
            read BOOLEAN DEFAULT FALSE,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )'
    );
    $db->exec(
        'CREATE TABLE IF NOT EXISTS clients (
            client_id TEXT PRIMARY KEY,
            name TEXT,
            location TEXT,
            phone TEXT,
            step TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )'
    );
}

function bind_value(SQLite3Stmt $stmt, int $index, $value): void
{
    if (is_int($value)) {
        $stmt->bindValue($index, $value, SQLITE3_INTEGER);
        return;
    }
    if (is_bool($value)) {
        $stmt->bindValue($index, $value ? 1 : 0, SQLITE3_INTEGER);
        return;
    }
    if ($value === null) {
        $stmt->bindValue($index, null, SQLITE3_NULL);
        return;
    }
    $stmt->bindValue($index, (string)$value, SQLITE3_TEXT);
}

function db_exec(SQLite3 $db, string $sql, array $params = [])
{
    $stmt = $db->prepare($sql);
    if ($stmt === false) {
        throw new RuntimeException($db->lastErrorMsg());
    }
    foreach (array_values($params) as $index => $value) {
        bind_value($stmt, $index + 1, $value);
    }
    $result = $stmt->execute();
    if ($result === false) {
        throw new RuntimeException($db->lastErrorMsg());
    }
    return $result;
}

function db_all(SQLite3 $db, string $sql, array $params = []): array
{
    $result = db_exec($db, $sql, $params);
    if (!($result instanceof SQLite3Result)) {
        return [];
    }
    $rows = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $rows[] = $row;
    }
    return $rows;
}

function db_get(SQLite3 $db, string $sql, array $params = []): ?array
{
    $result = db_exec($db, $sql, $params);
    if (!($result instanceof SQLite3Result)) {
        return null;
    }
    $row = $result->fetchArray(SQLITE3_ASSOC);
    return $row ?: null;
}

function normalize_message_row(array $row): array
{
    if (array_key_exists('id', $row)) {
        $row['id'] = (int)$row['id'];
    }
    if (array_key_exists('is_client_message', $row)) {
        $row['is_client_message'] = (int)$row['is_client_message'];
    }
    if (array_key_exists('read', $row)) {
        $row['read'] = (int)$row['read'];
    }
    return $row;
}

function build_system_prompt(array $state): string
{
    $pending = [];
    if (empty($state['name'])) {
        $pending[] = 'nome completo';
    }
    if (empty($state['location'])) {
        $pending[] = 'cidade/estado';
    }
    if (empty($state['phone'])) {
        $pending[] = 'telefone com DDD';
    }

    $knownParts = [];
    if (!empty($state['name'])) {
        $knownParts[] = 'Nome: ' . $state['name'];
    }
    if (!empty($state['location'])) {
        $knownParts[] = 'Cidade/Estado: ' . $state['location'];
    }
    if (!empty($state['phone'])) {
        $knownParts[] = 'Telefone: ' . $state['phone'];
    }

    $pendingText = $pending
        ? 'Ainda falta confirmar: ' . implode(', ', $pending) . '.'
        : 'Dados principais coletados.';
    $knownText = $knownParts
        ? 'Dados ja informados: ' . implode(' | ', $knownParts) . '.'
        : 'Nenhum dado confirmado ainda.';

    return implode(' ', [
        'Voce e a assistente virtual do escritorio do Dr. Weverton Quintairos (direito penal e imobiliario).',
        'Sua missao: coletar informacoes do cliente de forma natural e amigavel.',
        '=== RECONHECIMENTO DE NOME ===',
        'Se o cliente disser o nome (ex: "Ola, meu nome e Joao"), sempre use nas respostas:',
        '"Prazer, Joao! Como posso ajuda-lo?" Memorize e use o nome durante toda a conversa.',
        '=== COLETAR (nesta ordem) ===',
        '1. Nome completo 2. Cidade/estado 3. Telefone com DDD 4. Resumo do caso juridico.',
        '=== REGRAS ===',
        '- Responda em portugues do Brasil, maximo 80 palavras.',
        '- Seja cordial, empolgada e profissional.',
        '- NAO faca promessas ou parecer juridico.',
        '- NUNCA de respostas vagas como "Posso ajudar em algo mais?".',
        '- Quando coletar TUDO, diga:',
        '"Perfeito! Suas informacoes foram registradas. O Dr. Weverton entrara em contato em breve!"',
        '- Se faltar dado, peca de forma direta e educada.',
        $knownText,
        $pendingText,
        'Se faltar algum dado, peca de forma direta e educada. Se ja tiver tudo, confirme recebimento.',
    ]);
}

function call_ai(array $config, array $messages, string $fallback): string
{
    if (empty($config['ai_api_key'])) {
        return $fallback;
    }
    if (!function_exists('curl_init')) {
        error_log('AI request failed: cURL extension not available.');
        return $fallback;
    }

    $baseUrl = rtrim($config['ai_base_url'], '/');
    $url = $baseUrl . '/chat/completions';
    $payload = [
        'model' => $config['ai_model'],
        'messages' => $messages,
        'temperature' => 0.6,
        'max_tokens' => 300,
    ];

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $config['ai_api_key'],
    ]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);

    $result = curl_exec($ch);
    if ($result === false) {
        error_log('AI request failed: ' . curl_error($ch));
        curl_close($ch);
        return $fallback;
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($status < 200 || $status >= 300) {
        error_log('AI request failed with status ' . $status . ': ' . $result);
        return $fallback;
    }

    $data = json_decode($result, true);
    if (!is_array($data)) {
        return $fallback;
    }
    $content = $data['choices'][0]['message']['content'] ?? '';
    $content = is_string($content) ? trim($content) : '';
    return $content !== '' ? $content : $fallback;
}

function get_client_state(SQLite3 $db, string $clientId): array
{
    $state = db_get(
        $db,
        'SELECT client_id, name, location, phone, step FROM clients WHERE client_id = ?',
        [$clientId]
    );
    if ($state !== null) {
        return $state;
    }

    $details = db_get(
        $db,
        'SELECT client_name, client_location, client_phone FROM messages WHERE client_id = ? AND client_name IS NOT NULL ORDER BY id DESC LIMIT 1',
        [$clientId]
    );
    $name = $details['client_name'] ?? '';
    $location = $details['client_location'] ?? '';
    $phone = $details['client_phone'] ?? '';
    $step = ($name && $location && $phone) ? 'chatting' : 'get_issue';

    db_exec(
        $db,
        'INSERT INTO clients (client_id, name, location, phone, step) VALUES (?, ?, ?, ?, ?)',
        [$clientId, $name, $location, $phone, $step]
    );

    return [
        'client_id' => $clientId,
        'name' => $name,
        'location' => $location,
        'phone' => $phone,
        'step' => $step,
    ];
}

function update_client_state(SQLite3 $db, array $state): void
{
    db_exec(
        $db,
        'UPDATE clients SET name = ?, location = ?, phone = ?, step = ?, updated_at = CURRENT_TIMESTAMP WHERE client_id = ?',
        [$state['name'], $state['location'], $state['phone'], $state['step'], $state['client_id']]
    );
}

function sync_message_details(SQLite3 $db, string $clientId, array $state): void
{
    if ($state['name'] !== '') {
        db_exec(
            $db,
            "UPDATE messages SET client_name = ? WHERE client_id = ? AND (client_name IS NULL OR client_name = '')",
            [$state['name'], $clientId]
        );
    }
    if ($state['location'] !== '') {
        db_exec(
            $db,
            "UPDATE messages SET client_location = ? WHERE client_id = ? AND (client_location IS NULL OR client_location = '')",
            [$state['location'], $clientId]
        );
    }
    if ($state['phone'] !== '') {
        db_exec(
            $db,
            "UPDATE messages SET client_phone = ? WHERE client_id = ? AND (client_phone IS NULL OR client_phone = '')",
            [$state['phone'], $clientId]
        );
    }
}

try {
    $db = open_db($config['db_path']);
    init_db($db);

    $action = $_GET['action'] ?? '';
    if ($action === '') {
        json_response(['error' => 'Action is required.'], 400);
    }

    switch ($action) {
        case 'get-initial-message': {
            $welcomeMessage = 'Ola! Sou a assistente virtual do Dr. Weverton Quintairos. Para agilizar seu atendimento, por favor, me diga seu nome completo.';
            $clientId = bin2hex(random_bytes(8));

            db_exec(
                $db,
                'INSERT INTO messages (message, is_client_message, client_id) VALUES (?, ?, ?)',
                [$welcomeMessage, 0, $clientId]
            );
            db_exec(
                $db,
                'INSERT INTO clients (client_id, name, location, phone, step) VALUES (?, ?, ?, ?, ?)',
                [$clientId, '', '', '', 'get_name']
            );

            json_response(['message' => $welcomeMessage, 'clientId' => $clientId]);
        }
        case 'send-message': {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                json_response(['error' => 'Invalid method.'], 405);
            }

            $data = get_json_body();
            $message = trim((string)($data['message'] ?? ''));
            $clientId = trim((string)($data['clientId'] ?? ''));

            if ($message === '' || $clientId === '') {
                json_response(['error' => 'Message and clientId are required.'], 400);
            }

            $state = get_client_state($db, $clientId);

            db_exec(
                $db,
                'INSERT INTO messages (message, is_client_message, client_id) VALUES (?, ?, ?)',
                [$message, 1, $clientId]
            );

            $fallbackResponse = 'Estou aqui para ajudar. Poderia compartilhar seu nome, cidade/estado e telefone com DDD?';

            switch ($state['step']) {
                case 'get_name':
                    $state['name'] = $message;
                    $state['step'] = 'get_location';
                    $fallbackResponse = 'Obrigado, ' . $state['name'] . '. Qual sua cidade e estado?';
                    break;
                case 'get_location':
                    $state['location'] = $message;
                    $state['step'] = 'get_phone';
                    $fallbackResponse = 'Entendido. Qual e o seu numero de telefone com DDD?';
                    break;
                case 'get_phone':
                    $state['phone'] = $message;
                    $state['step'] = 'get_issue';
                    $fallbackResponse = 'Perfeito. Pode descrever brevemente o seu caso?';
                    break;
                case 'get_issue':
                    $state['step'] = 'chatting';
                    $fallbackResponse = 'Obrigado pelas informacoes. Quer acrescentar algo mais? O Dr. Weverton ou a equipe retornara em breve.';
                    break;
                default:
                    $fallbackResponse = 'Estou aqui para ajudar com mais detalhes do caso ou duvidas adicionais.';
                    break;
            }

            update_client_state($db, $state);
            sync_message_details($db, $clientId, $state);

            $history = db_all(
                $db,
                'SELECT message, is_client_message FROM messages WHERE client_id = ? ORDER BY timestamp ASC',
                [$clientId]
            );

            $promptMessages = [
                ['role' => 'system', 'content' => build_system_prompt($state)],
            ];
            foreach ($history as $row) {
                $promptMessages[] = [
                    'role' => ((int)$row['is_client_message'] === 1) ? 'user' : 'assistant',
                    'content' => $row['message'],
                ];
            }

            $botResponse = call_ai($config, $promptMessages, $fallbackResponse);

            db_exec(
                $db,
                'INSERT INTO messages (message, is_client_message, client_id) VALUES (?, ?, ?)',
                [$botResponse, 0, $clientId]
            );
            sync_message_details($db, $clientId, $state);

            json_response(['message' => $botResponse]);
        }
        case 'get-client-messages': {
            $clientId = trim((string)($_GET['clientId'] ?? ''));
            if ($clientId === '') {
                json_response(['error' => 'clientId is required.'], 400);
            }
            $messages = db_all(
                $db,
                'SELECT * FROM messages WHERE client_id = ? ORDER BY timestamp ASC',
                [$clientId]
            );
            foreach ($messages as $index => $row) {
                $messages[$index] = normalize_message_row($row);
            }
            json_response($messages);
        }
        case 'get-messages': {
            $messages = db_all(
                $db,
                "SELECT m.*,
                        COALESCE(NULLIF(m.client_name, ''), NULLIF(c.name, '')) AS client_name,
                        COALESCE(NULLIF(m.client_location, ''), NULLIF(c.location, '')) AS client_location,
                        COALESCE(NULLIF(m.client_phone, ''), NULLIF(c.phone, '')) AS client_phone
                 FROM messages m
                 JOIN (
                    SELECT client_id, MAX(id) AS max_id
                    FROM messages
                    WHERE is_client_message = 1
                    GROUP BY client_id
                 ) last ON last.max_id = m.id
                 LEFT JOIN clients c ON c.client_id = m.client_id
                 ORDER BY m.timestamp DESC"
            );
            foreach ($messages as $index => $row) {
                $messages[$index] = normalize_message_row($row);
            }
            json_response($messages);
        }
        case 'send-lawyer-message': {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                json_response(['error' => 'Invalid method.'], 405);
            }
            $data = get_json_body();
            $message = trim((string)($data['message'] ?? ''));
            $clientId = trim((string)($data['clientId'] ?? ''));

            if ($message === '' || $clientId === '') {
                json_response(['error' => 'Message and clientId are required.'], 400);
            }

            db_exec(
                $db,
                'INSERT INTO messages (message, is_client_message, client_id, read) VALUES (?, ?, ?, ?)',
                [$message, 0, $clientId, 1]
            );
            json_response(['message' => 'Message sent successfully']);
        }
        case 'mark-as-read': {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                json_response(['error' => 'Invalid method.'], 405);
            }
            $data = get_json_body();
            $messageId = (int)($data['messageId'] ?? 0);
            if ($messageId <= 0) {
                json_response(['error' => 'Message ID is required.'], 400);
            }
            db_exec($db, 'UPDATE messages SET read = 1 WHERE id = ?', [$messageId]);
            json_response(['message' => 'Message marked as read']);
        }
        case 'delete-message': {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                json_response(['error' => 'Invalid method.'], 405);
            }
            $data = get_json_body();
            $messageId = (int)($data['messageId'] ?? 0);
            if ($messageId <= 0) {
                json_response(['error' => 'Message ID is required.'], 400);
            }
            db_exec($db, 'DELETE FROM messages WHERE id = ?', [$messageId]);
            json_response(['message' => 'Message deleted']);
        }
        case 'delete-client-messages': {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                json_response(['error' => 'Invalid method.'], 405);
            }
            $data = get_json_body();
            $clientId = trim((string)($data['clientId'] ?? ''));
            if ($clientId === '') {
                json_response(['error' => 'clientId is required.'], 400);
            }
            db_exec($db, 'DELETE FROM messages WHERE client_id = ?', [$clientId]);
            db_exec($db, 'DELETE FROM clients WHERE client_id = ?', [$clientId]);
            json_response(['message' => 'Client messages deleted']);
        }
        case 'delete-all-messages': {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                json_response(['error' => 'Invalid method.'], 405);
            }
            db_exec($db, 'DELETE FROM messages');
            db_exec($db, 'DELETE FROM clients');
            json_response(['message' => 'All messages deleted']);
        }
        default:
            json_response(['error' => 'Unknown action.'], 404);
    }
} catch (Throwable $e) {
    error_log('API error: ' . $e->getMessage());
    json_response(['error' => 'Internal server error.'], 500);
}
