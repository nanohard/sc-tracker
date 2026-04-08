const { ipcMain, crypto } = require('electron');
const hyperswarm = require('hyperswarm');
const crypto_node = require('crypto'); // For randomUUID and hash
const { db } = require('./database');

let swarm;
const peers = new Set();
let localSyncUuid;
let orgUuid;
let userName;
let userRole;
let setupCompleted = false;
let memberAccepted = false; // true once we are Accepted into the org (or are CEO/Director)
let mainWindow;

function setMainWindow(win) {
  mainWindow = win;
}

async function initSync() {
  return new Promise((resolve) => {
    db.serialize(() => {
      // Get all sync settings
      db.all("SELECT key, value FROM sync_settings", (err, rows) => {
        const settings = {};
        if (rows) {
          rows.forEach(row => settings[row.key] = row.value);
        }

        localSyncUuid = settings['local_sync_uuid'];
        orgUuid = settings['org_uuid'];
        userName = settings['user_name'];
        userRole = settings['user_role'] || 'Member';
        setupCompleted = settings['setup_completed'] === 'true';
        // CEO/Director/Admin are always accepted; others read their own org_members status
        const isCEOorDir = userRole === 'CEO' || userRole === 'Admin' || userRole === 'Director';
        if (isCEOorDir) {
          memberAccepted = true;
          if (localSyncUuid) startSwarm();
          resolve();
        } else if (localSyncUuid) {
          db.get("SELECT status FROM org_members WHERE uuid = ?", [localSyncUuid], (err, row) => {
            memberAccepted = row && row.status === 'Accepted';
            startSwarm();
            resolve();
          });
        } else {
          resolve();
        }
      });
    });
  });
}

ipcMain.handle('reset-setup', async () => {
  console.log('Resetting all data and organization setup...');
  
  // 1. Stop swarm
  if (swarm) {
    try {
      await swarm.destroy();
    } catch (e) {
      console.error('Error destroying swarm:', e);
    }
    swarm = null;
    peers.clear();
  }

  // 2. Clear data from all tables and reset sync_settings
  const newLocalUuid = crypto_node.randomUUID();
  
  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("DELETE FROM yields");
      db.run("DELETE FROM miners WHERE name != 'None'");
      db.run("DELETE FROM orders");
      db.run("DELETE FROM order_contributions");
      db.run("DELETE FROM org_members");
      db.run("DELETE FROM inventory");
      
      db.run("UPDATE sync_settings SET value = ? WHERE key = 'local_sync_uuid'", [newLocalUuid]);
      db.run("UPDATE sync_settings SET value = NULL WHERE key = 'org_uuid'");
      db.run("UPDATE sync_settings SET value = NULL WHERE key = 'user_name'");
      db.run("UPDATE sync_settings SET value = 'Member' WHERE key = 'user_role'");
      db.run("UPDATE sync_settings SET value = 'false' WHERE key = 'setup_completed'");
      db.run("UPDATE sync_settings SET value = '[]' WHERE key = 'peer_uuids'");
      db.run("UPDATE sync_settings SET value = '0' WHERE key = 'last_sync_time'", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  // 3. Reset local variables
  localSyncUuid = newLocalUuid;
  orgUuid = null;
  userName = null;
  userRole = 'Member';
  setupCompleted = false;
  memberAccepted = false;

  console.log('Reset complete. New user UUID:', localSyncUuid);
  return true;
});

// IPC Handlers for Setup
ipcMain.handle('get-setup-status', async () => {
  return { setupCompleted, orgUuid, userRole, userName, localSyncUuid };
});

ipcMain.handle('create-org', async (event, name) => {
  const newOrgUuid = crypto_node.randomUUID();
  await new Promise(resolve => {
    db.serialize(() => {
      db.run("UPDATE sync_settings SET value = ? WHERE key = 'org_uuid'", [newOrgUuid]);
      db.run("UPDATE sync_settings SET value = ? WHERE key = 'user_name'", [name]);
      db.run("UPDATE sync_settings SET value = ? WHERE key = 'user_role'", ['CEO']);
      db.run("UPDATE sync_settings SET value = 'true' WHERE key = 'setup_completed'");
      db.run("INSERT OR REPLACE INTO org_members (uuid, name, role, status) VALUES (?, ?, 'CEO', 'Accepted')", [localSyncUuid, name], () => resolve());
    });
  });
  orgUuid = newOrgUuid;
  userName = name;
  userRole = 'CEO';
  setupCompleted = true;
  memberAccepted = true;
  if (!swarm) startSwarm();
  else broadcastHandshake();
  return { orgUuid, userRole };
});

ipcMain.handle('join-org', async (event, { uuid, name }) => {
  await new Promise(resolve => {
    db.serialize(() => {
      db.run("UPDATE sync_settings SET value = ? WHERE key = 'org_uuid'", [uuid]);
      db.run("UPDATE sync_settings SET value = ? WHERE key = 'user_name'", [name]);
      db.run("UPDATE sync_settings SET value = ? WHERE key = 'user_role'", ['Member']);
      db.run("UPDATE sync_settings SET value = 'true' WHERE key = 'setup_completed'");
      db.run("INSERT OR REPLACE INTO org_members (uuid, name, role, status) VALUES (?, ?, 'Member', 'Pending')", [localSyncUuid, name], () => resolve());
    });
  });
  orgUuid = uuid;
  userName = name;
  userRole = 'Member';
  setupCompleted = true;
  if (!swarm) startSwarm();
  else broadcastHandshake();
  return { orgUuid, userRole };
});

ipcMain.handle('get-org-members', async () => {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM org_members ORDER BY name ASC", (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
});

ipcMain.handle('update-member-role', async (event, { uuid, role }) => {
  const isCEO = userRole === 'CEO' || userRole === 'Admin';
  if (!isCEO && userRole !== 'Director') {
    throw new Error('Unauthorized');
  }

  // Only CEO can assign Directors or transfer CEO status
  if (!isCEO && (role === 'Director' || role === 'CEO')) {
    throw new Error('Only the CEO can assign Directors or transfer ownership');
  }

  if (role === 'CEO') {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // 1. Update target member to CEO
        db.run("UPDATE org_members SET role = 'CEO', updated_at = CURRENT_TIMESTAMP WHERE uuid = ?", [uuid]);
        // 2. Update current user to Member in members table
        db.run("UPDATE org_members SET role = 'Member', updated_at = CURRENT_TIMESTAMP WHERE uuid = ?", [localSyncUuid]);
        // 3. Update current user's local role
        db.run("UPDATE sync_settings SET value = 'Member' WHERE key = 'user_role'", [], (err) => {
          if (err) {
            reject(err);
          } else {
            userRole = 'Member';
            broadcastSync('members');
            // Notify current user's renderer that their role changed
            // This is handled by renderer calling get-setup-status after invoke
            resolve(true);
          }
        });
      });
    });
  }

  return new Promise((resolve, reject) => {
    db.run("UPDATE org_members SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE uuid = ?", [role, uuid], (err) => {
      if (err) reject(err);
      else {
        broadcastSync('members');
        resolve(true);
      }
    });
  });
});

ipcMain.handle('accept-member', async (event, uuid) => {
  const isCEO = userRole === 'CEO' || userRole === 'Admin';
  if (!isCEO && userRole !== 'Director') {
    throw new Error('Unauthorized');
  }
  return new Promise((resolve, reject) => {
    db.run("UPDATE org_members SET status = 'Accepted', updated_at = CURRENT_TIMESTAMP WHERE uuid = ?", [uuid], (err) => {
      if (err) reject(err);
      else {
        broadcastSync('members');
        resolve(true);
      }
    });
  });
});

ipcMain.handle('delete-member', async (event, uuid) => {
  const isCEO = userRole === 'CEO' || userRole === 'Admin';
  if (!isCEO && userRole !== 'Director') {
    throw new Error('Unauthorized');
  }
  return new Promise((resolve, reject) => {
    db.run("DELETE FROM org_members WHERE uuid = ?", [uuid], (err) => {
      if (err) reject(err);
      else {
        broadcastSync('members');
        resolve(true);
      }
    });
  });
});

function startSwarm() {
  if (swarm) return;
  if (!orgUuid) return; // Wait for org setup
  
  swarm = new hyperswarm();
  
  // Join org-specific topic and local-uuid topic
  const orgTopic = crypto_node.createHash('sha256').update(orgUuid).digest();
  swarm.join(orgTopic, { lookup: true, announce: true });
  
  const myTopic = crypto_node.createHash('sha256').update(localSyncUuid).digest();
  swarm.join(myTopic, { lookup: true, announce: true });

  swarm.on('connection', async (conn, info) => {
    console.log('New connection from peer');
    peers.add(conn);
    
    conn.on('data', data => handleSyncData(conn, data));
    conn.on('close', () => peers.delete(conn));
    conn.on('error', () => peers.delete(conn));

    // Send initial handshake with Org info
    sendHandshake(conn);
  });

  // Periodic sync every 10 seconds
  setInterval(async () => {
    for (const conn of peers) {
      if (conn.peerUuid && conn.orgUuid === orgUuid) {
        // If I am CEO/Director, I can sync everything.
        // If I am Member, I only pull from CEO/Directors.
        // Miners can push their yields.
        
        const isCEO = userRole === 'CEO' || userRole === 'Admin';
        
        // Check if peer is accepted in my list, or if I am joining and they are CEO
        const peerInfo = await getMemberByUuid(conn.peerUuid);
        if (peerInfo && peerInfo.status === 'Accepted') {
           // Standard sync logic
           initiateSyncWithPeer(conn, 'mining');
           initiateSyncWithPeer(conn, 'inventory');
           initiateSyncWithPeer(conn, 'members');
        } else if (isCEO || userRole === 'Director') {
            // Even if not accepted, maybe sync member list to see pending?
            // No, handshake handles pending requests.
        }
      }
    }
  }, 10000);
}

async function getMemberByUuid(uuid) {
    return new Promise(resolve => {
        db.get("SELECT * FROM org_members WHERE uuid = ?", [uuid], (err, row) => resolve(row));
    });
}

function sendHandshake(conn) {
    console.log(`Sending handshake to peer: ${conn.remoteAddress}`);
    conn.write(JSON.stringify({
      type: 'handshake',
      uuid: localSyncUuid,
      orgUuid: orgUuid,
      name: userName,
      role: userRole
    }));
}

function broadcastHandshake() {
    for (const conn of peers) {
        sendHandshake(conn);
    }
}

function broadcastSync(category) {
  if (peers.size === 0) return;
  const notification = JSON.stringify({ type: 'sync-notification', category });
  for (const conn of peers) {
    if (conn.peerUuid && conn.orgUuid === orgUuid) {
        // Permission check: standard members only get notifications from higher ups?
        // For now, let notifications pass, initiateSyncWithPeer will do strict checks.
        try {
          conn.write(notification);
        } catch (err) {
          console.error(`Failed to send ${category} sync notification:`, err);
        }
    }
  }
}

async function initiateSyncWithPeer(conn, category, overrideLastSyncTime) {
  if (!conn.peerUuid || conn.orgUuid !== orgUuid) return;

  const peerInfo = await getMemberByUuid(conn.peerUuid);

  // RBAC Pull Logic:
  // Any accepted member can pull from any other accepted peer (P2P model).
  // Pending members may only pull 'members' from CEO/Director to detect acceptance.

  const isPeerCEO = conn.peerRole === 'CEO' || conn.peerRole === 'Admin';
  const peerIsAccepted = peerInfo && peerInfo.status === 'Accepted';

  let canPull = false;
  if (memberAccepted && peerIsAccepted) {
      canPull = true; // Both sides accepted: full P2P sync allowed
  } else if (category === 'members' && (isPeerCEO || conn.peerRole === 'Director')) {
      canPull = true; // Pending members can always pull member list from CEO/Director
  }

  if (!canPull) return;

  const lastSyncTime = overrideLastSyncTime !== undefined ? overrideLastSyncTime : await new Promise(resolve => {
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
      conn.orgUuid = message.orgUuid;
      conn.peerName = message.name;
      conn.peerRole = message.role;
      
      console.log(`Handshake received from ${conn.peerName} (${conn.peerRole}) in org ${conn.orgUuid}`);

      const isCEO = userRole === 'CEO' || userRole === 'Admin';
      const isPeerCEO = conn.peerRole === 'CEO' || conn.peerRole === 'Admin';

      if (conn.orgUuid === orgUuid) {
          // Check if this member exists in our list
          const existing = await getMemberByUuid(conn.peerUuid);
          if (!existing) {
              if (isCEO || userRole === 'Director') {
                  // CEO/Director automatically adds new joiners as pending
                  db.run("INSERT INTO org_members (uuid, name, role, status) VALUES (?, ?, ?, 'Pending')", [conn.peerUuid, conn.peerName, conn.peerRole], (err) => {
                      if (err) console.error("Error adding member:", err);
                      else if (mainWindow) mainWindow.webContents.send('members-updated');
                  });
              } else if (isPeerCEO || conn.peerRole === 'Director') {
                  // If I'm a regular member/joiner, and I see a CEO/Director, add them as Accepted
                  // and immediately pull the members list to detect when I've been accepted.
                  // Mining/inventory are pulled only after acceptance to avoid leaking data to pending members.
                  db.run("INSERT INTO org_members (uuid, name, role, status) VALUES (?, ?, ?, 'Accepted')", [conn.peerUuid, conn.peerName, conn.peerRole], (err) => {
                      if (err) console.error("Error adding staff member:", err);
                      else if (mainWindow) mainWindow.webContents.send('members-updated');
                  });
                  initiateSyncWithPeer(conn, 'members');
              }
          } else {
              // Update name/role from CEO/Director (trusted authority for role changes)
              if (!isCEO && (isPeerCEO || conn.peerRole === 'Director')) {
                  db.run("UPDATE org_members SET role = ?, status = 'Accepted', name = ? WHERE uuid = ?", [conn.peerRole, conn.peerName, conn.peerUuid], (err) => {
                      if (!err && mainWindow) mainWindow.webContents.send('members-updated');
                  });
              }
              // Any accepted member reconnecting to an accepted peer should re-sync all
              // categories to catch missed updates. initiateSyncWithPeer enforces RBAC.
              if (memberAccepted) {
                  initiateSyncWithPeer(conn, 'members');
                  initiateSyncWithPeer(conn, 'mining');
                  initiateSyncWithPeer(conn, 'inventory');
              }
          }
      }
      return;
    }

    if (message.type === 'sync-request') {
      if (conn.orgUuid !== orgUuid) return;
      
      const category = message.category;
      
      // RBAC Push Logic (Response to request):
      // Serve any peer that is Accepted in our local DB (P2P model).
      // Also serve 'members' to anyone connecting from a CEO/Director (for pending-member acceptance checks).

      const isPeerCEO = conn.peerRole === 'CEO' || conn.peerRole === 'Admin';
      const peerRecord = await getMemberByUuid(conn.peerUuid);
      const peerIsAccepted = peerRecord && peerRecord.status === 'Accepted';

      let canServe = false;
      if (memberAccepted && peerIsAccepted) {
          canServe = true; // Both accepted: serve freely
      } else if (category === 'members' && (isPeerCEO || conn.peerRole === 'Director')) {
          canServe = true; // Always serve member list to CEO/Director (helps pending members check status)
      }

      if (!canServe) return;

      const peerLastSyncTime = message.lastSyncTime;
      const updates = await getDatabaseUpdates(peerLastSyncTime, category);
      conn.write(JSON.stringify({
        type: 'sync-response',
        category: category,
        updates: updates,
        timestamp: Date.now()
      }));
    } else if (message.type === 'sync-response') {
      if (conn.orgUuid !== orgUuid) return;
      console.log(`Sync response received for ${message.category} from ${conn.peerName}`);
      
      await applyDatabaseUpdates(message.updates);
      
      // Special check: if my own role was updated in the members sync
      if (message.updates.members) {
          const myNewInfo = message.updates.members.find(m => m.uuid === localSyncUuid);
          if (myNewInfo && myNewInfo.role !== userRole) {
              userRole = myNewInfo.role;
              db.run("UPDATE sync_settings SET value = ? WHERE key = 'user_role'", [userRole]);
              if (mainWindow) mainWindow.webContents.send('role-updated', userRole);
              broadcastHandshake(); // Tell everyone about our new role
          }
          if (myNewInfo && myNewInfo.status === 'Accepted' && setupCompleted) {
              console.log("I HAVE BEEN ACCEPTED INTO THE ORG!");
              memberAccepted = true;
              if (mainWindow) mainWindow.webContents.send('setup-accepted');
              broadcastHandshake(); // Inform peers we are now accepted
              // Pull ALL historical data immediately using timestamp 0, so the user sees
              // existing org data right away regardless of any prior members-only syncs.
              for (const peer of peers) {
                  if (peer.peerUuid && peer.orgUuid === orgUuid) {
                      initiateSyncWithPeer(peer, 'mining', 0);
                      initiateSyncWithPeer(peer, 'inventory', 0);
                  }
              }
          }
      }

      db.run("UPDATE sync_settings SET value = ? WHERE key = 'last_sync_time'", [message.timestamp.toString()]);
      if (mainWindow) mainWindow.webContents.send('sync-complete');
    } else if (message.type === 'sync-notification') {
      if (conn.orgUuid !== orgUuid) return;
      console.log(`Sync notification received for ${message.category} from ${conn.peerName}`);
      await initiateSyncWithPeer(conn, message.category);
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
      db.all("SELECT * FROM yields WHERE datetime(updated_at) > datetime(?)", [sinceStr], (err, rows) => resolve(rows || []));
    });
    updates.miners = await new Promise(resolve => {
      db.all("SELECT * FROM miners WHERE datetime(updated_at) > datetime(?)", [sinceStr], (err, rows) => resolve(rows || []));
    });
    updates.orders = await new Promise(resolve => {
      db.all("SELECT * FROM orders WHERE datetime(updated_at) > datetime(?)", [sinceStr], (err, rows) => resolve(rows || []));
    });
    updates.order_contributions = await new Promise(resolve => {
      db.all("SELECT * FROM order_contributions WHERE datetime(updated_at) > datetime(?)", [sinceStr], (err, rows) => resolve(rows || []));
    });
  } else if (category === 'inventory') {
    updates.inventory = await new Promise(resolve => {
      db.all("SELECT * FROM inventory WHERE datetime(updated_at) > datetime(?)", [sinceStr], (err, rows) => resolve(rows || []));
    });
  } else if (category === 'members') {
    updates.members = await new Promise(resolve => {
      db.all("SELECT * FROM org_members WHERE datetime(updated_at) > datetime(?)", [sinceStr], (err, rows) => resolve(rows || []));
    });
  }

  return updates;
}

async function applyDatabaseUpdates(updates) {
  const { yields, miners, orders, order_contributions, inventory, members } = updates;
  let membersUpdated = false;

  if (members) {
      for (const m of members) {
          await new Promise(resolve => {
              db.get("SELECT updated_at FROM org_members WHERE uuid = ?", [m.uuid], (err, row) => {
                  if (!row || new Date(m.updated_at) > new Date(row.updated_at)) {
                      db.run("INSERT OR REPLACE INTO org_members (uuid, name, role, status, updated_at) VALUES (?, ?, ?, ?, ?)",
                          [m.uuid, m.name, m.role, m.status, m.updated_at], () => {
                              membersUpdated = true;
                              resolve();
                          });
                  } else resolve();
              });
          });
      }
      if (membersUpdated && mainWindow) {
          mainWindow.webContents.send('members-updated');
      }
  }

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
  
  return settings;
});

async function getUserRole() {
    if (userRole) return userRole;
    return new Promise(resolve => {
        db.get("SELECT value FROM sync_settings WHERE key = 'user_role'", (err, row) => {
            resolve(row ? row.value : 'Member');
        });
    });
}

module.exports = {
  initSync,
  broadcastSync,
  setMainWindow,
  getUserRole
};
