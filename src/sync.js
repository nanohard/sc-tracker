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

async function getPeerSettings() {
  return new Promise(resolve => {
    db.get("SELECT value FROM sync_settings WHERE key = 'peer_uuids'", (err, row) => {
      if (row) {
        try {
          let peerSettings = JSON.parse(row.value);
          // Migration: Convert strings to objects or add missing permissions
          let migrated = false;
          peerSettings = peerSettings.map(p => {
            if (typeof p === 'string') {
              migrated = true;
              return { 
                uuid: p, 
                nickname: '', 
                mining: { allowPull: true, requestPull: true },
                inventory: { allowPull: true, requestPull: true }
              };
            }
            if (p.allowPull !== undefined || p.requestPull !== undefined) {
              migrated = true;
              p.mining = { 
                allowPull: p.allowPull ?? true, 
                requestPull: p.requestPull ?? true 
              };
              p.inventory = { 
                allowPull: p.allowPull ?? true, 
                requestPull: p.requestPull ?? true 
              };
              delete p.allowPull;
              delete p.requestPull;
            }
            if (!p.mining || !p.inventory) {
              migrated = true;
              p.mining = p.mining ?? { allowPull: true, requestPull: true };
              p.inventory = p.inventory ?? { allowPull: true, requestPull: true };
            }
            return p;
          });
          if (migrated) {
            db.run("UPDATE sync_settings SET value = ? WHERE key = 'peer_uuids'", [JSON.stringify(peerSettings)]);
          }
          resolve(peerSettings);
        } catch (e) {
          resolve([]);
        }
      } else {
        resolve([]);
      }
    });
  });
}

async function getPeerUuids() {
  const settings = await getPeerSettings();
  return settings.map(p => p.uuid);
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
    const myPeerSettings = await getPeerSettings();
    const peerUuid = info.publicKey ? info.publicKey.toString('hex') : null; // Hyperswarm uses public keys
    
    // We don't necessarily know the peer's UUID yet until handshake
    // but we send our intent based on what we have stored.
    // We'll send our full settings list and let them find us, 
    // or just wait until we know who they are.
    // Actually, it's better to just send our UUID and our intent for EVERYONE we know.
    // Or better: handshake just sends our UUID. Then after we know who they are, 
    // we send another handshake with the specific intent for them.
    
    conn.write(JSON.stringify({
      type: 'handshake',
      uuid: localSyncUuid
    }));
  });

  // Periodic sync every 10 seconds
  setInterval(async () => {
    const mySettings = await getPeerSettings();
    for (const conn of peers) {
      if (conn.peerUuid) {
        const setting = mySettings.find(p => p.uuid === conn.peerUuid);
        if (setting) {
          if (setting.mining.requestPull && conn.peerPermissions?.mining?.allowPull) {
            initiateSyncWithPeer(conn, 'mining');
          }
          if (setting.inventory.requestPull && conn.peerPermissions?.inventory?.allowPull) {
            initiateSyncWithPeer(conn, 'inventory');
          }
        }
      }
    }
  }, 10000);
}

function broadcastSync(category) {
  if (peers.size === 0) return;
  const notification = JSON.stringify({ type: 'sync-notification', category });
  for (const conn of peers) {
    if (conn.peerUuid) {
      getPeerSettings().then(mySettings => {
        const setting = mySettings.find(p => p.uuid === conn.peerUuid);
        // Only notify if we allow this peer for the specific category
        if (setting && setting[category] && setting[category].allowPull) {
          try {
            conn.write(notification);
          } catch (err) {
            console.error(`Failed to send ${category} sync notification:`, err);
          }
        }
      });
    }
  }
}

async function initiateSyncWithPeer(conn, category) {
  const mySettings = await getPeerSettings();
  const setting = mySettings.find(p => p.uuid === conn.peerUuid);
  
  if (!setting || !setting[category] || !setting[category].requestPull || !conn.peerPermissions?.[category]?.allowPull) {
    return;
  }
  
  const lastSyncTime = await new Promise(resolve => {
    db.get("SELECT value FROM sync_settings WHERE key = 'last_sync_time'", (err, row) => {
      resolve(row ? parseInt(row.value) : 0);
    });
  });

  conn.write(JSON.stringify({
    type: 'sync-request',
    category: category,
    lastSyncTime: lastSyncTime
  }));
}

async function handleSyncData(conn, data) {
  try {
    const message = JSON.parse(data.toString());
    
    if (message.type === 'handshake') {
      conn.peerUuid = message.uuid;
      
      // If the peer sent their intent, store it on the connection
      if (message.intent) {
        if (message.intent.mining && message.intent.inventory) {
          conn.peerPermissions = message.intent;
          console.log(`Received handshake from ${conn.peerUuid} with granular permissions.`);
        } else {
          // Legacy handshake with single-category intent
          conn.peerPermissions = {
            mining: { allowPull: message.intent.allowPull ?? true, requestPull: message.intent.requestPull ?? true },
            inventory: { allowPull: message.intent.allowPull ?? true, requestPull: message.intent.requestPull ?? true }
          };
          console.log(`Received legacy handshake (v1 intent) from ${conn.peerUuid}.`);
        }
      } else {
        // Old version or initial handshake, we need to send our intent back
        console.log(`Received initial handshake from ${conn.peerUuid}.`);
        broadcastHandshake();
      }
      
      const mySettings = await getPeerSettings();
      const setting = mySettings.find(p => p.uuid === conn.peerUuid);
      if (setting) {
        if (setting.mining.requestPull && conn.peerPermissions?.mining?.allowPull) {
          initiateSyncWithPeer(conn, 'mining');
        }
        if (setting.inventory.requestPull && conn.peerPermissions?.inventory?.allowPull) {
          initiateSyncWithPeer(conn, 'inventory');
        }
      }
      return;
    }

    if (message.type === 'sync-request') {
      const category = message.category || 'mining'; // Default to mining for legacy compatibility
      const mySettings = await getPeerSettings();
      const setting = mySettings.find(p => p.uuid === conn.peerUuid);
      
      if (!setting || !setting[category] || !setting[category].allowPull) {
        console.warn(`Sync request denied for peer ${conn.peerUuid || 'unknown'}. Permission '${category}.allowPull' not set.`);
        return;
      }

      const peerLastSyncTime = message.lastSyncTime;
      const updates = await getDatabaseUpdates(peerLastSyncTime, category);
      conn.write(JSON.stringify({
        type: 'sync-response',
        category: category,
        updates: updates,
        timestamp: Date.now()
      }));
    } else if (message.type === 'sync-response') {
      const category = message.category || 'mining';
      const mySettings = await getPeerSettings();
      const setting = mySettings.find(p => p.uuid === conn.peerUuid);

      if (!setting || !setting[category] || !setting[category].requestPull || !conn.peerPermissions?.[category]?.allowPull) {
        console.warn(`Sync response ignored from peer ${conn.peerUuid || 'unknown'}: Permission check failed for ${category}.`);
        return;
      }

      await applyDatabaseUpdates(message.updates);
      db.run("UPDATE sync_settings SET value = ? WHERE key = 'last_sync_time'", [message.timestamp.toString()]);
      if (mainWindow) mainWindow.webContents.send('sync-complete');
    } else if (message.type === 'sync-notification') {
      const category = message.category || 'mining';
      const mySettings = await getPeerSettings();
      const setting = mySettings.find(p => p.uuid === conn.peerUuid);
      if (setting && setting[category] && setting[category].requestPull && conn.peerPermissions?.[category]?.allowPull) {
        await initiateSyncWithPeer(conn, category);
      }
    }
  } catch (err) {
    console.error('Failed to handle sync data:', err);
  }
}

async function getDatabaseUpdates(sinceTimestamp, category) {
  const sinceStr = new Date(sinceTimestamp).toISOString();
  let updates = {};

  if (category === 'mining') {
    updates.yields = await new Promise(resolve => {
      db.all("SELECT * FROM yields WHERE updated_at > ?", [sinceStr], (err, rows) => resolve(rows || []));
    });
    updates.miners = await new Promise(resolve => {
      db.all("SELECT * FROM miners WHERE updated_at > ?", [sinceStr], (err, rows) => resolve(rows || []));
    });
    updates.orders = await new Promise(resolve => {
      db.all("SELECT * FROM orders WHERE updated_at > ?", [sinceStr], (err, rows) => resolve(rows || []));
    });
    updates.order_contributions = await new Promise(resolve => {
      db.all("SELECT * FROM order_contributions WHERE updated_at > ?", [sinceStr], (err, rows) => resolve(rows || []));
    });
  } else if (category === 'inventory') {
    updates.inventory = await new Promise(resolve => {
      db.all("SELECT * FROM inventory WHERE updated_at > ?", [sinceStr], (err, rows) => resolve(rows || []));
    });
  }

  return updates;
}

async function applyDatabaseUpdates(updates) {
  const { yields, miners, orders, order_contributions, inventory } = updates;

  if (miners) {
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
  }

  if (yields) {
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
  const myPeerSettings = await getPeerSettings();
  for (const conn of peers) {
    const setting = myPeerSettings.find(p => p.uuid === conn.peerUuid);
    const handshake = {
      type: 'handshake',
      uuid: localSyncUuid
    };
    
    if (setting) {
      handshake.intent = {
        mining: setting.mining,
        inventory: setting.inventory
      };
    }
    
    try {
      conn.write(JSON.stringify(handshake));
    } catch (err) {
      console.error('Failed to broadcast handshake:', err);
    }
  }
}

ipcMain.handle('get-sync-settings', async () => {
  const settings = await new Promise(resolve => {
    const s = {};
    db.all("SELECT key, value FROM sync_settings", (err, rows) => {
      if (err) {
        console.error('Error fetching sync settings:', err);
        resolve(s);
        return;
      }
      if (rows) {
        rows.forEach(row => s[row.key] = row.value);
      }
      resolve(s);
    });
  });

  // Ensure peer_uuids are migrated and returned
  const peerSettings = await getPeerSettings();
  settings.peer_uuids = JSON.stringify(peerSettings);
  
  if (!settings.local_sync_uuid && localSyncUuid) {
    settings.local_sync_uuid = localSyncUuid;
  }
  
  return settings;
});

ipcMain.handle('add-peer-uuid', async (event, peerUuid, nickname) => {
  return new Promise(resolve => {
    db.get("SELECT value FROM sync_settings WHERE key = 'peer_uuids'", (err, row) => {
      const peerSettings = JSON.parse(row.value);
      const existingPeer = peerSettings.find(p => {
        if (typeof p === 'string') return p === peerUuid;
        return p.uuid === peerUuid;
      });

      if (!existingPeer) {
        peerSettings.push({ 
          uuid: peerUuid, 
          nickname: nickname,
          mining: { allowPull: true, requestPull: true },
          inventory: { allowPull: true, requestPull: true }
        });
        db.run("UPDATE sync_settings SET value = ? WHERE key = 'peer_uuids'", [JSON.stringify(peerSettings)], () => {
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

ipcMain.handle('update-peer-permission', async (event, peerUuid, category, permission, value) => {
  return new Promise(resolve => {
    db.get("SELECT value FROM sync_settings WHERE key = 'peer_uuids'", (err, row) => {
      if (!row) return resolve(false);
      let peerSettings = JSON.parse(row.value);
      const peer = peerSettings.find(p => (typeof p === 'string' ? p : p.uuid) === peerUuid);
      
      if (peer && typeof peer === 'object') {
        if (!peer[category]) peer[category] = { allowPull: true, requestPull: true };
        peer[category][permission] = value;
        db.run("UPDATE sync_settings SET value = ? WHERE key = 'peer_uuids'", [JSON.stringify(peerSettings)], () => {
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
