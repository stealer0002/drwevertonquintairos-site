# Site de Advocacia com Chat de IA

Site dinamico que usa um chat com IA para fazer a triagem inicial de clientes do Dr. Weverton Quintairos.

## Funcionalidades
- Chat em tempo real para coletar nome, localizacao, telefone e resumo do caso.
- Respostas geradas por IA (OpenAI/Groq ou compativel) com armazenamento das conversas em SQLite.
- Painel para o advogado visualizar e responder aos clientes.
- Login simples para proteger o painel do advogado.

## Pre-requisitos
- PHP 7.4+ com extensao SQLite3 habilitada.
- Variaveis de ambiente (ou edite `app-config.php`):
  - `GROQ_API_KEY` (ou `OPENAI_API_KEY`) com sua chave.
  - Opcional: `GROQ_BASE_URL`/`OPENAI_BASE_URL` e `GROQ_MODEL`/`OPENAI_MODEL`.
  - `LAWYER_USER` e `LAWYER_PASS` para o login do painel.
  - Recomendado: `LAWYER_PASS_HASH` (hash do password) e `LAWYER_SESSION_NAME`.
    - Formato aceito: `pbkdf2_sha256$ITERACOES$SALTO$HASH_BASE64` ou `password_hash()` do PHP.
    - Se `LAWYER_PASS_HASH` estiver definido, `LAWYER_PASS` pode ser removido.

## Como executar o projeto
1. Configure a chave em `.env` ou direto no `app-config.php`.
2. Suba os arquivos no hosting (garanta permissao de escrita para `chat.db`).
3. Localmente, se quiser testar, rode:
   ```bash
   php -S localhost:8000
   ```
4. Acesse o site em `http://localhost:8000/index.html` e o painel em `http://localhost:8000/login.php`.

## Estrutura do projeto
- `index.html`: Pagina principal do site com o chat.
- `style.css`: Folha de estilo para o site.
- `script.js`: Logica do chat do lado do cliente.
- `api.php`: Backend PHP com SQLite e integracao com IA.
- `app-config.php`: Configuracao da API e do banco (arquivo usado pela API).
- `config.php`: Configuracao alternativa, caso `app-config.php` nao esteja disponivel.
- `lawyer.html`: Painel do advogado.
- `lawyer.js`: Logica do painel do advogado.
- `chat.db`: Banco de dados SQLite.
- `login.php`: Tela de login do painel.
- `logout.php`: Encerra a sessao do painel.

