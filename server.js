require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { transcribeAudioBase64, processAgentConversation } = require('./src/services/ai-service');
const { 
  ensureInstance, 
  getQrCode, 
  sendTextMessage, 
  sendPresence,
  markMessageAsRead,
  getBase64FromMediaMessage,
  setWebhook,
  INSTANCE_NAME 
} = require('./src/services/evolution-service');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Estado em memória das sessões (por telefone)
const sessions = {};

// Status em tempo real das configurações de segurança
let agentSettings = {
  enabled: process.env.AGENT_ENABLED !== 'false',
  whitelistOnly: process.env.WHITELIST_ONLY === 'true',
  whitelistNumbers: (process.env.WHITELIST_NUMBERS || '').split(',').map(s => s.trim()).filter(Boolean),
  triggerKeyword: (process.env.TRIGGER_KEYWORD || '').trim().toLowerCase()
};

console.log('🛡️ Configurações de Segurança Carregadas:');
console.log(`- Agente Ativo: ${agentSettings.enabled ? '✅ SIM' : '❌ NÃO'}`);
console.log(`- Modo Whitelist: ${agentSettings.whitelistOnly ? '🔒 ATIVO' : '🌐 ABERTO'}`);
if (agentSettings.whitelistNumbers.length > 0) {
  console.log(`- Números na Whitelist: ${agentSettings.whitelistNumbers.join(', ')}`);
}

// ==========================================
// ENDPOINTS DO PAINEL WEB DE CONTROLE
// ==========================================

// Retorna status atual, QR Code e configurações
app.get('/api/status', async (req, res) => {
  const qr = await getQrCode();
  res.json({
    settings: agentSettings,
    instanceName: INSTANCE_NAME,
    qrCode: qr?.base64 || qr?.code || null,
    connected: qr?.count === 0 || qr?.status === 'open'
  });
});

// Liga / Desliga o agente
app.post('/api/toggle', (req, res) => {
  const { enabled } = req.body;
  agentSettings.enabled = !!enabled;
  console.log(`🔄 Agente ${agentSettings.enabled ? 'ATIVADO' : 'DESATIVADO'} pelo painel.`);
  res.json({ success: true, settings: agentSettings });
});

// Atualiza Whitelist de números
app.post('/api/whitelist', (req, res) => {
  const { whitelistOnly, numbers } = req.body;
  agentSettings.whitelistOnly = !!whitelistOnly;
  if (Array.isArray(numbers)) {
    agentSettings.whitelistNumbers = numbers.map(n => n.replace(/\D/g, '')).filter(Boolean);
  }
  console.log(`🔒 Whitelist atualizada:`, agentSettings.whitelistNumbers);
  res.json({ success: true, settings: agentSettings });
});

// ==========================================
// WEBHOOK PRINCIPAL DA EVOLUTION API
// ==========================================
app.post('/webhook/whatsapp', async (req, res) => {
  // Responde imediatamente 200 OK para o WhatsApp/Evolution não reenviar
  res.status(200).json({ status: 'received' });

  try {
    const body = req.body;
    const data = body.data || body;

    // 1. Ignora mensagens enviadas pelo próprio bot (fromMe)
    if (data?.key?.fromMe) {
      return;
    }

    const remoteJid = data?.key?.remoteJid || '';
    if (!remoteJid || remoteJid.includes('@g.us')) {
      // Ignora grupos do WhatsApp
      return;
    }

    const cleanNumber = remoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');

    // 2. CHECAGEM DE SEGURANÇA 1: O Agente está ativado?
    if (!agentSettings.enabled) {
      console.log(`⏸️ [Ignorado] Mensagem de ${cleanNumber}: Agente está DESLIGADO.`);
      return;
    }

    // 3. CHECAGEM DE SEGURANÇA 2: Whitelist ativada?
    if (agentSettings.whitelistOnly) {
      const isAllowed = agentSettings.whitelistNumbers.some(num => cleanNumber.includes(num) || num.includes(cleanNumber));
      if (!isAllowed) {
        console.log(`🛡️ [Proteção] Mensagem de ${cleanNumber} IGNORADA: Número não está na Whitelist.`);
        return;
      }
    }

    // 4. Extração do conteúdo da mensagem (Texto ou Áudio)
    let msg = data.message;
    // Desembrulha mensagens aninhadas do WhatsApp
    while (
      msg?.ephemeralMessage?.message ||
      msg?.viewOnceMessage?.message ||
      msg?.viewOnceMessageV2?.message
    ) {
      msg = msg.ephemeralMessage?.message || msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message;
    }

    let userText = msg?.conversation || msg?.extendedTextMessage?.text || '';
    const isAudio = !!msg?.audioMessage;

    // Se for áudio, transcreve com Whisper
    if (isAudio) {
      console.log(`🎙️ [Áudio Detectado] Recebido de ${cleanNumber}. Buscando mídia na Evolution API...`);
      
      let base64Audio = data.base64 || msg?.base64;
      if (!base64Audio) {
        base64Audio = await getBase64FromMediaMessage(data.key);
      }

      if (base64Audio) {
        console.log(`⚡ [Groq Whisper] Transcrevendo áudio em alta velocidade...`);
        const transcription = await transcribeAudioBase64(base64Audio, msg.audioMessage?.mimetype || 'audio/ogg');
        console.log(`📝 [Áudio Transcrito]: "${transcription}"`);
        userText = transcription;
      } else {
        console.warn(`⚠️ Não foi possível obter o base64 do áudio de ${cleanNumber}.`);
      }
    }

    if (!userText || !userText.trim()) {
      return;
    }

    // 5. CHECAGEM DE SEGURANÇA 3: Palavra-chave (se configurada)
    if (agentSettings.triggerKeyword && !sessions[cleanNumber]) {
      if (!userText.toLowerCase().includes(agentSettings.triggerKeyword)) {
        console.log(`🔍 [Gatilho] Mensagem ignorada: não contém a palavra-chave "${agentSettings.triggerKeyword}".`);
        return;
      }
    }

    // 6. Gerenciamento de Histórico e Conversação com a LLM
    if (!sessions[cleanNumber]) {
      sessions[cleanNumber] = {
        history: [],
        state: 'START'
      };
    }

    const session = sessions[cleanNumber];
    console.log(`💬 [Processando IA] Para ${cleanNumber}: "${userText}"`);

    // --- COMPORTAMENTO HUMANO NO WHATSAPP ---
    // 1. Marca como lida a mensagem do cliente (2 tracinhos azuis)
    await markMessageAsRead(remoteJid);

    // 2. Simula o "Digitando..." no WhatsApp
    await sendPresence(remoteJid, 'composing');

    // 3. Processa a resposta com a LLM
    const result = await processAgentConversation(session.history, userText, session.state);

    // 4. Delay proporcional ao tamanho da resposta para parecer digitação real (mínimo 1.5s, máx 3.5s)
    const typingTimeMs = Math.min(3500, Math.max(1500, result.replyText.length * 25));
    await new Promise(resolve => setTimeout(resolve, typingTimeMs));

    // Atualiza histórico (mantém últimas 8 mensagens para contexto)
    session.history.push({ role: 'user', content: userText });
    session.history.push({ role: 'assistant', content: result.replyText });
    if (session.history.length > 8) {
      session.history = session.history.slice(-8);
    }

    console.log(`🤖 [Resposta Gerada]:\n${result.replyText}\n`);

    // 5. Despacha mensagem real de volta no WhatsApp do usuário
    await sendTextMessage(remoteJid, result.replyText);
    console.log(`🚀 Mensagem enviada com sucesso para ${cleanNumber} no WhatsApp!\n`);

  } catch (err) {
    console.error('❌ Erro no webhook do WhatsApp:', err);
  }
});

// Endpoint de Teste Direto pelo Painel Web
app.post('/api/test-chat', async (req, res) => {
  const { message, audioBase64, mimeType, sessionId } = req.body;
  // Cria sessão única por aba/navegador para nunca misturar testes anteriores
  const testPhone = sessionId || 'TESTE_LOCAL_' + Date.now();

  if (!sessions[testPhone]) {
    sessions[testPhone] = { history: [], state: 'START' };
  }

  const session = sessions[testPhone];
  let processedText = message || '';

  // Se veio áudio real gravado do microfone do navegador!
  if (audioBase64) {
    console.log(`🎙️ [Teste Local] Áudio recebido do microfone! Transcrevendo com Groq Whisper...`);
    processedText = await transcribeAudioBase64(audioBase64, mimeType || 'audio/webm');
    console.log(`📝 [Transcrito com Sucesso]: "${processedText}"`);
  }

  if (!processedText || !processedText.trim()) {
    return res.json({
      reply: "Não consegui ouvir nada no áudio gravado. Pode tentar falar mais perto do microfone?",
      transcription: ""
    });
  }

  const result = await processAgentConversation(session.history, processedText, session.state);

  session.history.push({ role: 'user', content: processedText });
  session.history.push({ role: 'assistant', content: result.replyText });
  if (session.history.length > 8) {
    session.history = session.history.slice(-8);
  }

  res.json({
    reply: result.replyText,
    transcription: audioBase64 ? processedText : null,
    ticketOpened: result.ticketOpened,
    protocol: result.protocol,
    sessionId: testPhone
  });
});

// Endpoint para resetar conversa no painel
app.post('/api/reset-chat', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && sessions[sessionId]) {
    delete sessions[sessionId];
  }
  res.json({ success: true });
});

// Inicialização do Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(`🚀 AGENTE DE SUPORTE DIX BPO RODANDO NA PORTA ${PORT}`);
  console.log(`📱 Painel de Controle: http://localhost:${PORT}`);
  console.log(`======================================================\n`);

  // Garante que a instância existe na Evolution API
  await ensureInstance();
  
  // Aponta o Webhook da Evolution para o nosso servidor local
  await setWebhook(`http://host.docker.internal:${PORT}/webhook/whatsapp`);
});
