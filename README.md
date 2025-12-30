# Site de Advocacia com Chat de IA

Site dinamico que usa um chat com IA para fazer a triagem inicial de clientes do Dr. Weverton Quintairos.

## Funcionalidades
- Chat em tempo real para coletar nome, localizacao, telefone e resumo do caso.
- Respostas geradas por IA (OpenAI/Groq ou compativel) com armazenamento das conversas em SQLite.
- Painel para o advogado visualizar e responder aos clientes.

## Pre-requisitos
- PHP 7.4+ com extensao SQLite3 habilitada.
- Variaveis de ambiente (ou edite `config.php`):
  - `GROQ_API_KEY` (ou `OPENAI_API_KEY`) com sua chave.
  - Opcional: `GROQ_BASE_URL`/`OPENAI_BASE_URL` e `GROQ_MODEL`/`OPENAI_MODEL`.

## Como executar o projeto
1. Configure a chave em `.env` ou direto no `config.php`.
2. Suba os arquivos no hosting (garanta permissao de escrita para `chat.db`).
3. Localmente, se quiser testar, rode:
   ```bash
   php -S localhost:8000
   ```
4. Acesse o site em `http://localhost:8000/index.html` e o painel em `http://localhost:8000/lawyer.html`.

## Estrutura do projeto
- `index.html`: Pagina principal do site com o chat.
- `style.css`: Folha de estilo para o site.
- `script.js`: Logica do chat do lado do cliente.
- `api.php`: Backend PHP com SQLite e integracao com IA.
- `config.php`: Configuracao da API e do banco.
- `lawyer.html`: Painel do advogado.
- `lawyer.js`: Logica do painel do advogado.
- `chat.db`: Banco de dados SQLite.
