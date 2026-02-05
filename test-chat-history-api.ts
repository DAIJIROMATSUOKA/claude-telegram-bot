#!/usr/bin/env bun

const API_URL = 'https://jarvis-memory-gateway.jarvis-matsuoka.workers.dev/v1/db/query';
const API_KEY = 'placeholder_key_auth_disabled';

async function testAPI() {
  console.log('=== Testing Memory Gateway API ===\n');

  // 1. テーブル一覧取得
  console.log('1. Fetching table list...');
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        sql: 'SELECT name FROM sqlite_master WHERE type="table"',
        params: []
      })
    });
    const data = await response.json();
    console.log('Tables:', JSON.stringify(data, null, 2));
    console.log();
  } catch (error) {
    console.error('Error fetching tables:', error);
  }

  // 2. jarvis_chat_historyのレコード数確認
  console.log('2. Fetching record count from jarvis_chat_history...');
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        sql: 'SELECT COUNT(*) as count FROM jarvis_chat_history',
        params: []
      })
    });
    const data = await response.json();
    console.log('Count:', JSON.stringify(data, null, 2));
    console.log();
  } catch (error) {
    console.error('Error fetching count:', error);
  }

  // 3. 最新3件取得
  console.log('3. Fetching latest 3 records...');
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        sql: 'SELECT * FROM jarvis_chat_history ORDER BY timestamp DESC LIMIT 3',
        params: []
      })
    });
    const data = await response.json();
    console.log('Latest records:', JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error fetching latest records:', error);
  }
}

testAPI();
