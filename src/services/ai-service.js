const path = require('path');
const fs = require('fs');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const Groq = require('groq-sdk');

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.warn('⚠️ GROQ_API_KEY não configurada no .env!');
}
const groq = new Groq({
  apiKey: apiKey || 'dummy-key'
});

/**
 * Transcreve áudio base64 usando o modelo Whisper-large-v3 via Groq (tempo médio: ~300ms)
 * @param {string} base64Audio 
 * @param {string} mimeType 
 * @returns {Promise<string>}
 */
async function transcribeAudioBase64(base64Audio, mimeType = 'audio/ogg') {
  if (!base64Audio) return '';

  const cleanBase64 = base64Audio.replace(/^data:audio\/\w+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');
  
  // Determina extensão
  let ext = 'ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) ext = 'm4a';
  else if (mimeType.includes('mp3')) ext = 'mp3';
  else if (mimeType.includes('wav')) ext = 'wav';

  const tempFilePath = path.join(os.tmpdir(), `audio_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`);
  
  try {
    fs.writeFileSync(tempFilePath, buffer);

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-large-v3',
      language: 'pt',
      response_format: 'verbose_json'
    });

    return transcription.text ? transcription.text.trim() : '';
  } catch (error) {
    console.error('❌ Erro no Groq Whisper STT:', error);
    return '';
  } finally {
    if (fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath); } catch (e) {}
    }
  }
}

/**
 * Processamento conversacional e extração de intenções via Groq LLM (llama-3.3-70b-versatile)
 * @param {Array} conversationHistory 
 * @param {string} userMessage 
 * @param {object} sessionState 
 * @returns {Promise<{replyText: string, updatedState: object, ticketOpened: boolean, protocol: string|null}>}
 */
async function processAgentConversation(conversationHistory, userMessage, sessionState) {
  const systemPrompt = `Você é a Bia, assistente humana de suporte e atendimento da DIX BPO no WhatsApp.
Seu objetivo é fazer a triagem da ocorrência, coletar dados com precisão cirúrgica e abrir o chamado.

REGRA DE SEGURANÇA MÁXIMA (ZERO ALUCINAÇÃO):
- NUNCA invente, presuma ou deduza o nome ou e-mail do cliente se ele NÃO tiver falado explicitamente na conversa.
- Se o cliente não disse o nome dele, pergunte o nome.
- Se o cliente não disse o e-mail dele, pergunte o e-mail.
- NUNCA coloque e-mails fictícios como "arthur@gmail.com", "cliente@exemplo.com". Se não foi informado, coloque explicitamente "Pendente de confirmação" e peça para ele informar.

COMO VOCÊ FALA (MUITO IMPORTANTE):
- Fale como uma atendente humana real no WhatsApp, com gentileza, simpatia e agilidade.
- NÃO use frases clichês de robô como "Eu sou uma inteligência artificial", "Sou um modelo de linguagem".
- Nunca mande textões gigantes. Seja direta e use quebras de parágrafo naturais.

ETAPAS DO ATENDIMENTO:
1. Triagem e Detalhamento da Ocorrência:
   - Se o usuário falar apenas algo genérico (ex: "tá dando bug", "não funciona"), peça com gentileza para ele detalhar o que acontece (ex: onde acontece, se dá mensagem de erro, etc.).
   
2. Coleta de Dados Obrigatórios:
   - Para abrir qualquer chamado, você PRECISA de:
     1. Nome da pessoa
     2. E-mail para acompanhamento
     3. Descrição clara do problema
   - Se faltar o Nome ou o E-mail, peça com simpatia antes de confirmar a abertura.

3. Confirmação dos Dados Finais:
   - SOMENTE quando você tiver os dados reais fornecidos pelo usuário, peça a confirmação:
     "Perfeito! Só pra eu não errar nada aqui, confirma pra mim se tá certinho:
     • Nome: [Nome real falado pelo usuário]
     • E-mail: [E-mail real falado pelo usuário]
     • Ocorrência: [Resumo claro do problema]
     Posso abrir o chamado com esses dados?"

4. Após a confirmação:
   - Se o cliente confirmar (sim, pode, etc):
     Emita o protocolo no formato [PROTOCOLO: DIX-XXXXXX] e avise que o chamado foi direcionado para a equipe técnica responsável.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ];

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages,
      model: 'openai/gpt-oss-120b',
      temperature: 0.5,
      max_tokens: 600
    });

    const replyText = chatCompletion.choices[0]?.message?.content || "Desculpe, tive uma instabilidade momentânea. Pode repetir por favor?";

    let ticketOpened = false;
    let protocol = null;

    // Detecta se abriu chamado
    if (replyText.includes('DIX-') || replyText.toLowerCase().includes('protocolo')) {
      const match = replyText.match(/DIX-\d+/);
      if (match) {
        protocol = match[0];
        ticketOpened = true;
      } else {
        protocol = 'DIX-' + Math.floor(100000 + Math.random() * 900000);
        ticketOpened = true;
      }
    }

    return {
      replyText,
      ticketOpened,
      protocol
    };
  } catch (error) {
    console.error('❌ Erro na LLM Groq:', error);
    return {
      replyText: "Olá! Recebi sua mensagem, mas nosso sistema de processamento teve um breve delay. Pode confirmar novamente o seu nome e ocorrência?",
      ticketOpened: false,
      protocol: null
    };
  }
}

module.exports = {
  transcribeAudioBase64,
  processAgentConversation
};
