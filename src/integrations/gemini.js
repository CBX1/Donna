const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');

let client = null;

function getClient() {
  if (!client) {
    client = new GoogleGenerativeAI(config.gemini.apiKey);
  }
  return client;
}

async function ask(systemPrompt, userMessage) {
  const model = getClient().getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  });
  const result = await model.generateContent(userMessage);
  return result.response.text();
}

async function askJson(systemPrompt, userMessage) {
  const model = getClient().getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
    generationConfig: { responseMimeType: 'application/json' },
  });
  const result = await model.generateContent(userMessage);
  return JSON.parse(result.response.text());
}

async function chat(systemPrompt, history, userMessage) {
  const model = getClient().getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  });
  const chatSession = model.startChat({ history });
  const result = await chatSession.sendMessage(userMessage);
  return result.response.text();
}

/**
 * Chat with function calling (tool use).
 * Returns { text, functionCalls } where functionCalls is an array of { name, args }.
 */
async function chatWithTools(systemPrompt, history, userMessage, functionDeclarations) {
  const model = getClient().getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations }],
  });

  const chatSession = model.startChat({ history });
  const result = await chatSession.sendMessage(userMessage);
  const response = result.response;

  const text = response.text?.() || '';
  const functionCalls = [];

  // Extract function calls from response parts
  for (const candidate of response.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.functionCall) {
        functionCalls.push({
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        });
      }
    }
  }

  return { text, functionCalls, chatSession };
}

/**
 * Send function results back to an ongoing chat session.
 * Returns the model's final text response.
 */
async function sendToolResults(chatSession, toolResults) {
  const parts = toolResults.map(r => ({
    functionResponse: {
      name: r.name,
      response: { result: r.result },
    },
  }));

  const result = await chatSession.sendMessage(parts);
  const response = result.response;

  const text = response.text?.() || '';
  const functionCalls = [];

  for (const candidate of response.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (part.functionCall) {
        functionCalls.push({
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        });
      }
    }
  }

  return { text, functionCalls, chatSession };
}

module.exports = { ask, askJson, chat, chatWithTools, sendToolResults };
