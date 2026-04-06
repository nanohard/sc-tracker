const { ipcMain, crypto } = require('electron');
const hyperswarm = require('hyperswarm');
const crypto_node = require('crypto'); // For randomUUID and hash
const { db } = require('./database');

let swarm;
const peers = new Set();
let localSyncUuid;
let mainWindow;

function setMainWindow(win) {
  mainWindow = win;
}

async function initSync() {
  return new Promise((resolve) => {
    db.serialize(() => {
      db.get("SELECT value FROM sync_settings WHERE key = 'local_sync_uuid'", (err, row) => {
        if (row) {
          localSyncUuid = row.value;
          startSwarm();
          resolve();
        } else {
          const newUuid = crypto_node.randomUUID();
          db.run("INSERT OR IGNORE INTO sync_settings (key, value) VALUES ('local_sync_uuid', ?)", [newUuid], () => {
            localSyncUuid = newUuid;
            startSwarm();
            resolve();
          });
        }
      });
    });
  });
}

async function getPeerUuids() {
  return new Promise(resolve => {
    db.get("SELECT value FROM sync_settings WHERE key = 'peer_uuids'", (err, row) => {
      if (row) {
        try {
          const peerUuids = JSON.parse(row.value);
          resolve(peerUuids.map(p => typeof p === 'string' ? p : p.uuid));
        } catch (e) {
          resolve([]);
        }
      } else {
        resolve([]);
      }
    });
  });
}

function startSwarm() {
  if (swarm) return;
  
  swarm = new hyperswarm();
  
  db.get("SELECT value FROM sync_settings WHERE key = 'peer_uuids'", (err, row) => {
    if (row) {
      const peerUuids = JSON.parse(row.value);
      const uuids = peerUuids.map(p => typeof p === 'string' ? p : p.uuid);
      [localSyncUuid, ...uuids].forEach(uuid => {
        const topic = crypto_node.createHash('sha256').update(uuid).digest();
        swarm.join(topic, { lookup: true, announce: true });
      });
    }
  });

  swarm.on('connection', async (conn, info) => {
    console.log('New connection from peer');
    peers.add(conn);
    
    conn.on('data', data => handleSyncData(conn, data));
    conn.on('close', () => peers.delete(conn));
    conn.on('error', () => peers.delete(conn));

    // Send initial handshake
    const myPeerUuids = await getPeerUuids();
    conn.write(JSON.stringify({
      type: 'handshake',
      uuid: localSyncUuid,
      remoteKeys: myPeerUuids
    }));
  });

  // Periodic sync every 10 seconds
  setInterval(() => {
    for (const conn of peers) {
      if (conn.peerRemoteKeys && conn.peerRemoteKeys.includes(localSyncUuid)) {
        initiateSyncWithPeer(conn);
      }
    }
  }, 10000);
}

function broadcastSync() {
  if (peers.size === 0) return;
  const notification = JSON.stringify({ type: 'sync-notification' });
  for (const conn of peers) {
    if (conn.peerUuid) {
      getPeerUuids().then(myPeerUuids => {
        if (myPeerUuids.includes(conn.peerUuid)) {
          try {
            conn.write(notification);
          } catch (err) {
            console.error('Failed to send sync notification:', err);
          }
        }
      });
    }
  }
}

async function initiateSyncWithPeer(conn) {
  if (!conn.peerRemoteKeys || !conn.peerRemoteKeys.includes(localSyncUuid)) {
    return;
  }
  
  const lastSyncTime = await new Promise(resolve => {
    db.get("SELECT value FROM sync_settings WHERE key = 'last_sync_time'", (err, row) => {
      resolve(row ? parseInt(row.value) : 0);
    });
  });

  conn.write(JSON.stringify({
    type: 'sync-request',
    lastSyncTime: lastSyncTime
  }));
}

async function handleSyncData(conn, data) {
  try {
    const message = JSON.parse(data.toString());
    
    if (message.type === 'handshake') {
      conn.peerUuid = message.uuid;
      conn.peerRemoteKeys = message.remoteKeys || [];
      console.log(`Received handshake from ${conn.peerUuid}. They have keys: ${JSON.stringify(conn.peerRemoteKeys)}`);
      
      if (conn.peerRemoteKeys.includes(localSyncUuid)) {
        initiateSyncWithPeer(conn);
      }
      return;
    }

    if (message.type === 'sync-request') {
      const myPeerUuids = await getPeerUuids();
      if (!conn.peerUuid || !myPeerUuids.includes(conn.peerUuid)) {
        console.warn(`Sync request denied for peer ${conn.peerUuid || 'unknown'}.`);
        return;
      }

      const peerLastSyncTime = message.lastSyncTime;
      const updates = await getDatabaseUpdates(peerLastSyncTime);
      conn.write(JSON.stringify({
        type: 'sync-response',
        updates: updates,
        timestamp: Date.now()
      }));
    } else if (message.type === 'sync-response') {
      if (!conn.peerRemoteKeys || !conn.peerRemoteKeys.includes(localSyncUuid)) {
        console.warn(`Sync response ignored from peer ${conn.peerUuid || 'unknown'}: They don't have my key.`);
        return;
      }

      await applyDatabaseUpdates(message.updates);
      db.run("UPDATE sync_settings SET value = ? WHERE key = 'last_sync_time'", [message.timestamp.toString()]);
      if (mainWindow) mainWindow.webContents.send('sync-complete');
    } else if (message.type === 'sync-notification') {
      if (conn.peerRemoteKeys && conn.peerRemoteKeys.includes(localSyncUuid)) {
        await initiateSyncWithPeer(conn);
      }
    }
  } catch (err) {
    console.error('Failed to handle sync data:', err);
  }
}

async function getDatabaseUpdates(sinceTimestamp) {
  const sinceStr = new Date(sinceTimestamp).toISOString();
  
  const yields = await new Promise(resolve => {
    db.all("SELECT * FROM yields WHERE updated_at > ?", [sinceStr], (err, rows) => resolve(rows || []));
  });
  
  const miners = await new Promise(resolve => {
    db.all("SELECT * FROM miners WHERE updated_at > ?", [sinceStr], (err, rows) => resolve(rows || []));
  });

  const orders = await new Promise(resolve => {
    db.all("SELECT * FROM orders WHERE updated_at > ?", [sinceStr], (err, rows) => resolve(rows || []));
  });

  const order_contributions = await new Promise(resolve => {
    db.all("SELECT * FROM order_contributions WHERE updated_at > ?", [sinceStr], (err, rows) => resolve(rows || []));
  });

  const inventory = await new Promise(resolve => {
    db.all("SELECT * FROM inventory WHERE updated_at > ?", [sinceStr], (err, rows) => resolve(rows || []));
  });

  return { yields, miners, orders, order_contributions, inventory };
}

async function applyDatabaseUpdates(updates) {
  const { yields, miners, orders, order_contributions, inventory } = updates;

  for (const miner of miners) {
    await new Promise(resolve => {
      db.get("SELECT updated_at, is_deleted FROM miners WHERE uuid = ?", [miner.uuid], (err, row) => {
        if (!row || new Date(miner.updated_at) > new Date(row.updated_at)) {
          db.run(`
            INSERT OR REPLACE INTO miners (uuid, name, total_yield, total_quality_sum, record_count, updated_at, is_deleted)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `, [miner.uuid, miner.name, miner.total_yield, miner.total_quality_sum, miner.record_count, miner.updated_at, miner.is_deleted], () => resolve());
        } else {
          resolve();
        }
      });
    });
  }

  for (const y of yields) {
    await new Promise(resolve => {
      db.get("SELECT updated_at, is_deleted FROM yields WHERE uuid = ?", [y.uuid], (err, row) => {
        if (!row || new Date(y.updated_at) > new Date(row.updated_at)) {
          db.run(`
            INSERT OR REPLACE INTO yields (uuid, material, quality, yield_cscu, miner_name, location, timestamp, updated_at, is_deleted)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [y.uuid, y.material, y.quality, y.yield_cscu, y.miner_name, y.location, y.timestamp, y.updated_at, y.is_deleted], () => resolve());
        } else {
          resolve();
        }
      });
    });
  }

  if (orders) {
    for (const order of orders) {
      await new Promise(resolve => {
        db.get("SELECT updated_at, is_deleted FROM orders WHERE uuid = ?", [order.uuid], (err, row) => {
          if (!row || new Date(order.updated_at) > new Date(row.updated_at)) {
            db.run(`
              INSERT OR REPLACE INTO orders (uuid, material, quantity, quantity_mined, min_quality, status, created_at, updated_at, is_deleted)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [order.uuid, order.material, order.quantity, order.quantity_mined, order.min_quality, order.status, order.created_at, order.updated_at, order.is_deleted], () => resolve());
          } else {
            resolve();
          }
        });
      });
    }
  }

  if (order_contributions) {
    for (const contrib of order_contributions) {
      await new Promise(resolve => {
        db.get("SELECT updated_at, is_deleted FROM order_contributions WHERE uuid = ?", [contrib.uuid], (err, row) => {
          if (!row || new Date(contrib.updated_at) > new Date(row.updated_at)) {
            db.run(`
              INSERT OR REPLACE INTO order_contributions (uuid, order_uuid, miner_name, material, quantity, quality, timestamp, updated_at, is_deleted)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [contrib.uuid, contrib.order_uuid, contrib.miner_name, contrib.material, contrib.quantity, contrib.quality, contrib.timestamp, contrib.updated_at, contrib.is_deleted], () => resolve());
          } else {
            resolve();
          }
        });
      });
    }
  }

  if (inventory) {
    for (const item of inventory) {
      await new Promise(resolve => {
        db.get("SELECT updated_at, is_deleted FROM inventory WHERE uuid = ?", [item.uuid], (err, row) => {
          if (!row || new Date(item.updated_at) > new Date(row.updated_at)) {
            db.run(`
              INSERT OR REPLACE INTO inventory (uuid, material, quality, quantity, location, updated_at, is_deleted)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [item.uuid, item.material, item.quality, item.quantity, item.location, item.updated_at, item.is_deleted], () => resolve());
          } else {
            resolve();
          }
        });
      });
    }
  }
}

async function broadcastHandshake() {
  const myPeerUuids = await getPeerUuids();
  const handshake = JSON.stringify({
    type: 'handshake',
    uuid: localSyncUuid,
    remoteKeys: myPeerUuids
  });
  for (const conn of peers) {
    try {
      conn.write(handshake);
    } catch (err) {
      console.error('Failed to broadcast handshake:', err);
    }
  }
}

ipcMain.handle('get-sync-settings', async () => {
  const settings = {};
  return new Promise(resolve => {
    db.all("SELECT key, value FROM sync_settings", (err, rows) => {
      if (err) {
        console.error('Error fetching sync settings:', err);
        resolve(settings);
        return;
      }
      if (rows) {
        rows.forEach(row => settings[row.key] = row.value);
      }
      if (!settings.local_sync_uuid && localSyncUuid) {
        settings.local_sync_uuid = localSyncUuid;
      }
      resolve(settings);
    });
  });
});

ipcMain.handle('add-peer-uuid', async (event, peerUuid, nickname) => {
  return new Promise(resolve => {
    db.get("SELECT value FROM sync_settings WHERE key = 'peer_uuids'", (err, row) => {
      const peerUuids = JSON.parse(row.value);
      const existingPeer = peerUuids.find(p => {
        if (typeof p === 'string') return p === peerUuid;
        return p.uuid === peerUuid;
      });

      if (!existingPeer) {
        peerUuids.push({ uuid: peerUuid, nickname: nickname });
        db.run("UPDATE sync_settings SET value = ? WHERE key = 'peer_uuids'", [JSON.stringify(peerUuids)], () => {
          const topic = crypto_node.createHash('sha256').update(peerUuid).digest();
          if (swarm) swarm.join(topic, { lookup: true, announce: true });
          broadcastHandshake();
          resolve(true);
        });
      } else {
        resolve(false);
      }
    });
  });
});

ipcMain.handle('remove-peer-uuid', async (event, peerUuid) => {
  return new Promise(resolve => {
    db.get("SELECT value FROM sync_settings WHERE key = 'peer_uuids'", (err, row) => {
      let peerUuids = JSON.parse(row.value);
      peerUuids = peerUuids.filter(p => {
        if (typeof p === 'string') return p !== peerUuid;
        return p.uuid !== peerUuid;
      });
      db.run("UPDATE sync_settings SET value = ? WHERE key = 'peer_uuids'", [JSON.stringify(peerUuids)], () => {
        const topic = crypto_node.createHash('sha256').update(peerUuid).digest();
        if (swarm) swarm.leave(topic);
        broadcastHandshake();
        resolve(true);
      });
    });
  });
});

module.exports = {
  initSync,
  broadcastSync,
  setMainWindow
};
