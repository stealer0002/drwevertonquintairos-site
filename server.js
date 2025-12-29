require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const OpenAI = require('openai');

const app = express();
const port = process.env.PORT || 3000;
const aiConfig = {
  apiKey: process.env.GROQ_API_KEY || 'dummy-key',
      baseURL: 'https://api.groq.com/openai/v1'
};
const aiModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
const aiEnabled = Boolean(process.env.GROQ_API_KEY)
app.use(bodyParser.json());

// SEGURANÇA: Bloquear acesso direto a arquivos sensíveis do servidor
app.use((req, res, next) => {
    const forbiddenFiles = ['/server.js', '/.env', '/chat.db', '/package.json', '/package-lock.json'];
    if (forbiddenFiles.includes(req.path)) {
        return res.status(403).send('Acesso negado.');
    }
    next();
});

app.use(express.static(__dirname));

const db = new sqlite3.Database('./chat.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the chat database.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT,
        client_name TEXT,
        client_location TEXT,
        client_phone TEXT,
        message TEXT,
        is_client_message BOOLEAN,
        read BOOLEAN DEFAULT FALSE,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

const runAsync = (query, params = []) =>
    new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) {
                return reject(err);
            }
            resolve(this);
        });
    });

const allAsync = (query, params = []) =>
    new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) {
                return reject(err);
            }
            resolve(rows);
        });
    });

const conversationState = {};

const buildSystemPrompt = (state) => {
    const pending = [];
    if (!state.name) pending.push('nome completo');
    if (!state.location) pending.push('cidade/estado');
    if (!state.phone) pending.push('telefone com DDD');

    const knownParts = [];
    if (state.name) knownParts.push(`Nome: ${state.name}`);
    if (state.location) knownParts.push(`Cidade/Estado: ${state.location}`);
    if (state.phone) knownParts.push(`Telefone: ${state.phone}`);

    const pendingText = pending.length ? `Ainda falta confirmar: ${pending.join(', ')}.` : 'Dados principais coletados.';
    const knownText = knownParts.length ? `Dados já informados: ${knownParts.join(' | ')}.` : 'Nenhum dado confirmado ainda.';

    return [
'Você é a assistente virtual do escritório do Dr. Weverton Quintairos (direito penal e imobiliário). Sua missão: coletar informações do cliente de forma natural e amigável.\n\n' +
        '=== RECONHECIMENTO DE NOME ===\n' +
        'Se o cliente disser o nome (ex: "Olá, meu nome é João"), SEMPRE use nas respostas: "Prazer, João! Como posso ajudá-lo?" Memorize e use o nome durante toda a conversa.\n\n' +
        '=== COLETAR (nesta ordem) ===\n' +
        '1. Nome completo\n2. Cidade/estado\n3. Telefone com DDD\n4. Resumo do caso jurídico\n\n' +
        '=== REGRAS ===\n' +
        '- Responda em português do Brasil, máximo 80 palavras\n' +
        '- Seja cordial, empolgada e profissional\n' +
        '- NÃO faça promessas ou dê parecer jurídico\n' +
        '- NUNCA dê respostas vagas como "Posso ajudar em algo mais?"\n' +
        '- Quando coletar TUDO, diga: "Perfeito! Suas informações foram registradas. O Dr. Weverton entrará em contato em breve!"\n' +
        '- Se faltar dado, peça de forma direta e educada\n\n' +
        knownText,
        pendingText,
        'Se faltar algum dado, peça de forma direta e educada. Se já tiver tudo, confirme recebimento e peça detalhes do caso se necessário.'
    ].join(' ');
};

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/get-initial-message', async (req, res) => {
    const welcomeMessage =
        'Olá! Sou a assistente virtual do Dr. Weverton Quintairos. Para agilizar seu atendimento, por favor, me diga seu nome completo.';
    const clientId = Math.random().toString(36).substring(7);

    conversationState[clientId] = {
        step: 'get_name',
        name: '',
        location: '',
        phone: ''
    };

    try {
        await runAsync(`INSERT INTO messages (message, is_client_message, client_id) VALUES (?, ?, ?)`, [
            welcomeMessage,
            false,
            clientId
        ]);
        res.json({ message: welcomeMessage, clientId: clientId });
    } catch (error) {
        console.error('Error saving initial message:', error);
        res.status(500).json({ error: 'Could not start conversation' });
    }
});

app.post('/send-message', async (req, res) => {
    const { message, clientId } = req.body;

    if (!message || !clientId) {
        return res.status(400).json({ error: 'Message and clientId are required' });
    }

    const userState = conversationState[clientId] || {
        step: 'get_issue',
        name: '',
        location: '',
        phone: ''
    };
    conversationState[clientId] = userState;

    let fallbackResponse = 'Estou aqui para ajudar. Poderia compartilhar seu nome, cidade/estado e telefone com DDD?';

    try {
        await runAsync(`INSERT INTO messages (message, is_client_message, client_id) VALUES (?, ?, ?)`, [
            message,
            true,
            clientId
        ]);

        switch (userState.step) {
            case 'get_name':
                userState.name = message;
                userState.step = 'get_location';
                fallbackResponse = `Obrigado, ${userState.name}. Qual sua cidade e estado?`;
                break;
            case 'get_location':
                userState.location = message;
                userState.step = 'get_phone';
                fallbackResponse = 'Entendido. Qual é o seu número de telefone com DDD?';
                break;
            case 'get_phone':
                userState.phone = message;
                userState.step = 'get_issue';
                fallbackResponse = 'Perfeito. Pode descrever brevemente o seu caso?';
                break;
            case 'get_issue':
                fallbackResponse =
                    'Obrigado pelas informações. Quer acrescentar algo mais? O Dr. Weverton ou a equipe retornará em breve.';
                userState.step = 'chatting';
                await runAsync(
                    `UPDATE messages SET client_name = ?, client_location = ?, client_phone = ? WHERE client_id = ?`,
                    [userState.name, userState.location, userState.phone, clientId]
                );
                break;
            default:
                fallbackResponse = 'Estou aqui para ajudar com mais detalhes do caso ou dúvidas adicionais.';
        }

        const history = await allAsync(
            `SELECT message, is_client_message FROM messages WHERE client_id = ? ORDER BY timestamp ASC`,
            [clientId]
        );
        const promptMessages = [
            { role: 'system', content: buildSystemPrompt(userState) },
            ...history.map((row) => ({
                role: row.is_client_message ? 'user' : 'assistant',
                content: row.message
            }))
        ];

        let botResponse = fallbackResponse;

        if (aiEnabled) {
            try {
                const completion = await openai.chat.completions.create({
                    model: aiModel,
                    messages: promptMessages,
                    temperature: 0.6,
                    max_tokens: 300
                });

                botResponse = completion.choices[0].message.content.trim() || fallbackResponse;
            } catch (error) {
                console.error('Error calling AI provider:', error);
            }
        } else {
            console.warn('AI provider is not configured. Falling back to scripted response.');
        }

        await runAsync(`INSERT INTO messages (message, is_client_message, client_id) VALUES (?, ?, ?)`, [
            botResponse,
            false,
            clientId
        ]);
        res.json({ message: botResponse });
    } catch (error) {
        console.error('Error processing message:', error);
        res.status(500).json({ error: 'Could not process the message' });
    }
});

app.get('/get-messages', (req, res) => {
    db.all(
        `
        SELECT * FROM messages WHERE id IN (
            SELECT MAX(id) FROM messages WHERE client_name IS NOT NULL GROUP BY client_id
        ) ORDER BY timestamp DESC
    `,
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        }
    );
});

app.post('/send-lawyer-message', (req, res) => {
    const { message, clientId } = req.body;

    if (!message || !clientId) {
        return res.status(400).json({ error: 'Message and clientId are required' });
    }

    db.run(
        `INSERT INTO messages (message, is_client_message, client_id, read) VALUES (?, ?, ?, ?)`,
        [message, false, clientId, true],
        function (err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: 'Message sent successfully' });
        }
    );
});

app.post('/mark-as-read', (req, res) => {
    const { messageId } = req.body;

    if (!messageId) {
        return res.status(400).json({ error: 'Message ID is required' });
    }

    db.run(`UPDATE messages SET read = TRUE WHERE id = ?`, [messageId], function (err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'Message marked as read' });
    });
});

app.get('/get-client-messages/:clientId', (req, res) => {
    const { clientId } = req.params;

    db.all(`SELECT * FROM messages WHERE client_id = ? ORDER BY timestamp ASC`, [clientId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});
