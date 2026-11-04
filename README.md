# DIX BPO — Mini Agente de Atendimento WhatsApp (AI & Automação)

Este repositório contém a solução técnica para o **Desafio Prático de Avaliação Técnica da DIX BPO (Pré-atendimento de Suporte via WhatsApp)**.

---

## 🎯 Objetivo da Solução
Automatizar a recepção de suporte de primeiro nível via WhatsApp:
1. **Recepção:** Solicitar dados cadastrais (*Nome, E-mail, Celular*) e ocorrência (suportando texto, áudio e imagem).
2. **Processamento & Validação (STT & IA):** Transcrever mensagens de áudio para texto, extrair as entidades estruturadas e devolver ao usuário para validação e confirmação.
3. **Desfecho com Máquina de Estados:**
   - **Confirmado (SIM):** Geração de protocolo de chamado e encaminhamento para a fila de atendimento humanizado.
   - **Recusado (NÃO):** Loop de correção dos dados para reprocessamento.

---

## 🏗️ Arquitetura e Tecnologias

A solução foi estruturada em duas abordagens complementares e de padrão corporativo:

### 1. Workflow n8n (`dix-support-agent-n8n.json`)
* **Webhook WhatsApp:** Ponto de entrada compatível com Evolution API, Z-API ou Meta Cloud API.
* **Normalizador de Payload:** Identificação do canal e tipo de mídia (texto ou áudio).
* **OpenAI Whisper (Speech-to-Text):** Transcrição de áudios em alta fidelidade.
* **Agente IA (GPT-4o-mini / LLM Node):** Extração de campos (*nome, email, celular, ocorrencia*) e classificação de intenção (*SIM / NÃO / ENVIO DE DADOS*).
* **State Machine & Router:** Lógica de transição de status para confirmação ou abertura de chamado.
* **WhatsApp Dispatcher:** Resposta automática ao cliente com mensagem formatada.

### 2. Microserviço em Node.js (`server.js`)
* Servidor Express com gerenciamento de sessões em memória.
* Simulação de pipeline completo para testes locais rápidos ou integração com containers Docker.

---

## 🚀 Como Executar

### Opção A: Importar no n8n
1. Abra o seu ambiente **n8n**.
2. Vá em **Workflows** > **Import from File...**
3. Selecione o arquivo [`dix-support-agent-n8n.json`](./dix-support-agent-n8n.json).
4. Configure suas credenciais da OpenAI (para Whisper e LLM) e ative o workflow.

### Opção B: Executar Localmente via Node.js
```bash
cd dix-whatsapp-agent
npm install
npm start
```
O servidor iniciará em `http://localhost:3000`.

---

## 🧪 Testando o Fluxo via Webhook

Você pode testar a máquina de estados enviando requisições `POST` para `http://localhost:3000/webhook/whatsapp`:

#### 1. Início do contato:
```bash
curl -X POST http://localhost:3000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"sender": "5511999998888", "text": "Olá, preciso de suporte"}'
```

#### 2. Envio de dados (simulando transcrição de áudio):
```bash
curl -X POST http://localhost:3000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "5511999998888",
    "messageType": "audio",
    "audio": {
      "mockTranscript": "Meu nome é Arthur Fogolin, e-mail arthurfogolinrocha01@gmail.com, celular 11988887777. Estou com erro de faturamento no sistema."
    }
  }'
```

#### 3. Confirmação do Usuário:
```bash
curl -X POST http://localhost:3000/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"sender": "5511999998888", "text": "SIM, está tudo correto"}'
```

---

## 👤 Autor
* **Arthur Fogolin**
* Estudante de Inteligência Artificial — Universidade Católica
* E-mail: `arthurfogolinrocha01@gmail.com`

