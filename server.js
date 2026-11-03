const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Simulação de banco em memória para sessão do usuário
const sessions = {};

// Função auxiliar para simulação de Whisper / STT
function simulateWhisperSTT(audioInfo) {
  // Em produção, envia o arquivo para a API OpenAI / Whisper / Groq
  return audioInfo.mockTranscript || "Olá, meu nome é Arthur Fogolin, meu e-mail é arthur@exemplo.com e meu celular é 11988887777. Estou com problema para acessar o portal financeiro.";
}

// Endpoint do Webhook de WhatsApp (Evolution API / Z-API / WhatsApp Cloud)
app.post('/webhook/whatsapp', (req, res) => {
  const { sender, messageType, text, audio } = req.body;
  const userPhone = sender || '5511999999999';

  if (!sessions[userPhone]) {
    sessions[userPhone] = { step: 'AWAITING_DATA', data: {} };
  }

  const session = sessions[userPhone];
  let processedText = text || '';

  // Processamento de Áudio (STT)
  if (messageType === 'audio' || audio) {
    processedText = simulateWhisperSTT(audio || {});
  }

  let botReply = '';

  switch (session.step) {
    case 'START':
    case 'AWAITING_DATA':
      // Se for a primeira mensagem ou recepção
      if (!processedText || processedText.toLowerCase() === 'oi' || processedText.toLowerCase() === 'olá') {
        botReply = "👋 Olá! Seja bem-vindo ao suporte DIX BPO.\n\n" +
                   "Por favor, me informe (por texto ou por áudio) os seus dados:\n" +
                   "• *Nome Completo*\n" +
                   "• *E-mail*\n" +
                   "• *Celular*\n\n" +
                   "Você também pode enviar um áudio ou imagem explicando com detalhes a ocorrência!";
        session.step = 'COLLECTING_INFO';
      } else {
        // Já enviou dados no primeiro contato
        session.data.rawInput = processedText;
        session.data.extracted = parseUserData(processedText, userPhone);
        session.step = 'CONFIRMATION';

        botReply = `Perfeito! Transcrevemos e organizamos suas informações.\n\n` +
                   `Por favor, *confirme se os dados abaixo estão corretos*:\n\n` +
                   `👤 *Nome:* ${session.data.extracted.nome}\n` +
                   `📧 *E-mail:* ${session.data.extracted.email}\n` +
                   `📱 *Celular:* ${session.data.extracted.celular}\n` +
                   `📝 *Ocorrência:* ${session.data.extracted.ocorrencia}\n\n` +
                   `👉 Digite *SIM* para confirmar e abrir o chamado, ou *NÃO* para reenviar os dados.`;
      }
      break;

    case 'COLLECTING_INFO':
      session.data.rawInput = processedText;
      session.data.extracted = parseUserData(processedText, userPhone);
      session.step = 'CONFIRMATION';

      botReply = `Recebemos seus dados! Por favor, *confirme se as informações estão corretas*:\n\n` +
                 `👤 *Nome:* ${session.data.extracted.nome}\n` +
                 `📧 *E-mail:* ${session.data.extracted.email}\n` +
                 `📱 *Celular:* ${session.data.extracted.celular}\n` +
                 `📝 *Ocorrência:* ${session.data.extracted.ocorrencia}\n\n` +
                 `👉 Digite *SIM* para confirmar e abrir o chamado, ou *NÃO* para reenviar os dados.`;
      break;

    case 'CONFIRMATION':
      const cleanMsg = processedText.trim().toUpperCase();
      if (cleanMsg.includes('SIM') || cleanMsg.includes('CORRETO') || cleanMsg.includes('OK')) {
        const protocolo = 'DIX-' + Math.floor(100000 + Math.random() * 900000);
        botReply = `✅ *Chamado aberto com sucesso!*\n\n` +
                   `📋 *Protocolo:* ${protocolo}\n` +
                   `Agradecemos o contato. Por favor, aguarde que em instantes você será direcionado para o atendimento humanizado de nossa equipe.\n\n` +
                   `Tenha um excelente dia!`;
        // Reseta ou arquiva sessão
        delete sessions[userPhone];
      } else if (cleanMsg.includes('NÃO') || cleanMsg.includes('NAO')) {
        session.step = 'COLLECTING_INFO';
        botReply = `⚠️ Sem problemas! Vamos corrigir.\n\n` +
                   `Por favor, envie novamente (por texto ou áudio) o seu *Nome*, *E-mail*, *Celular* e a descrição da ocorrência:`;
      } else {
        botReply = `Não entendi. Por favor, responda apenas *SIM* para confirmar os dados ou *NÃO* para reenviá-los.`;
      }
      break;

    default:
      botReply = "Olá! Como podemos te ajudar hoje?";
      session.step = 'START';
  }

  return res.json({
    recipient: userPhone,
    reply: botReply,
    currentStep: session.step
  });
});

// Helper de extração com regex / fallback
function parseUserData(text, phone) {
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const phoneMatch = text.match(/\(?\d{2}\)?\s?\d{4,5}-?\d{4}/);
  
  return {
    nome: extractName(text) || "Cliente",
    email: emailMatch ? emailMatch[0] : "Não informado",
    celular: phoneMatch ? phoneMatch[0] : phone,
    ocorrencia: text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, '').trim() || "Suporte técnico geral"
  };
}

function extractName(text) {
  const nameMatch = text.match(/(?:meu nome é|sou o|sou a|chamo)\s+([A-ZÀ-Úa-zà-ú]+(?:\s+[A-ZÀ-Úa-zà-ú]+)?)/i);
  return nameMatch ? nameMatch[1] : null;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Agente WhatsApp DIX BPO rodando na porta ${PORT}`);
});
