const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

let client = null;

function getClient() {
  if (!client) {
    client = new GoogleGenerativeAI(config.gemini.apiKey);
  }
  return client;
}

/**
 * Send a message to Gemini and get a text response.
 */
async function ask(systemPrompt, userMessage) {
  const model = getClient().getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  });
  const result = await model.generateContent(userMessage);
  return result.response.text();
}

/**
 * Send a message to Gemini and get a JSON response.
 */
async function askJson(systemPrompt, userMessage) {
  const model = getClient().getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });
  const result = await model.generateContent(userMessage);
  const text = result.response.text();
  return JSON.parse(text);
}

/**
 * Chat with history — for conversational interactions.
 * @param {string} systemPrompt - System prompt
 * @param {Array<{role: string, parts: [{text: string}]}>} history - Chat history
 * @param {string} userMessage - New user message
 * @returns {Promise<string>} Response text
 */
async function chat(systemPrompt, history, userMessage) {
  const model = getClient().getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  });
  const chatSession = model.startChat({ history });
  const result = await chatSession.sendMessage(userMessage);
  return result.response.text();
}

module.exports = { ask, askJson, chat };
