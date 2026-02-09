#!/usr/bin/env bun

// APIレスポンスのフォーマット確認
const API_URL = 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev/v1/db/query';
const API_KEY = 'placeholder_key_auth_disabled';

async function testResponseFormat() {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      sql: 'SELECT role, content, timestamp FROM jarvis_chat_history ORDER BY timestamp DESC LIMIT 3',
      params: []
    })
  });

  const data = await response.json() as any;
  console.log('Response structure:');
  console.log('- data.error:', data.error);
  console.log('- data.data:', data.data);
  console.log('- data.results:', data.results);
  console.log('- data.ok:', data.ok);
  console.log('- data.success:', data.success);
  console.log('\nFull response:');
  console.log(JSON.stringify(data, null, 2));
}

testResponseFormat();
