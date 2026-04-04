const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Tesseract = require('tesseract.js');
const { Jimp } = require('jimp');
const hyperswarm = require('hyperswarm');
const crypto = require('crypto');
const { db, initPromise } = require('./database');

let mainWindow;
let swarm;
const peers = new Set();
let localSyncUuid;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false, // Required for nodeIntegration in modern Electron
    },
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(async () => {
  await initPromise;
  await initSync();
  createWindow();
});

async function initSync() {
  return new Promise((resolve) => {
    db.serialize(() => {
      db.get("SELECT value FROM sync_settings WHERE key = 'local_sync_uuid'", (err, row) => {
        if (row) {
          localSyncUuid = row.value;
          startSwarm();
          resolve();
        } else {
          // If missing, generate it (redundancy with database.js)
          const newUuid = crypto.randomUUID();
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

function startSwarm() {
  if (swarm) return;
  
  swarm = new hyperswarm();
  
  db.get("SELECT value FROM sync_settings WHERE key = 'peer_uuids'", (err, row) => {
    if (row) {
      const peerUuids = JSON.parse(row.value);
      [localSyncUuid, ...peerUuids].forEach(uuid => {
        const topic = crypto.createHash('sha256').update(uuid).digest();
        swarm.join(topic, { lookup: true, announce: true });
      });
    }
  });

  swarm.on('connection', (conn, info) => {
    console.log('New connection from peer');
    peers.add(conn);
    
    conn.on('data', data => handleSyncData(conn, data));
    conn.on('close', () => peers.delete(conn));
    conn.on('error', () => peers.delete(conn));

    // Start sync process
    initiateSyncWithPeer(conn);
  });

  // Periodic sync every 10 seconds
  setInterval(() => {
    for (const conn of peers) {
      initiateSyncWithPeer(conn);
    }
  }, 10000);
}

function broadcastSync() {
  if (peers.size === 0) return;
  const notification = JSON.stringify({ type: 'sync-notification' });
  for (const conn of peers) {
    try {
      conn.write(notification);
    } catch (err) {
      console.error('Failed to send sync notification:', err);
    }
  }
}

async function initiateSyncWithPeer(conn) {
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
    
    if (message.type === 'sync-request') {
      const peerLastSyncTime = message.lastSyncTime;
      const updates = await getDatabaseUpdates(peerLastSyncTime);
      conn.write(JSON.stringify({
        type: 'sync-response',
        updates: updates,
        timestamp: Date.now()
      }));
    } else if (message.type === 'sync-response') {
      await applyDatabaseUpdates(message.updates);
      db.run("UPDATE sync_settings SET value = ? WHERE key = 'last_sync_time'", [message.timestamp.toString()]);
      if (mainWindow) mainWindow.webContents.send('sync-complete');
    } else if (message.type === 'sync-notification') {
      await initiateSyncWithPeer(conn);
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

  return { yields, miners };
}

async function applyDatabaseUpdates(updates) {
  const { yields, miners } = updates;

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
      // If still missing local UUID, and initSync was supposed to handle it
      if (!settings.local_sync_uuid && localSyncUuid) {
        settings.local_sync_uuid = localSyncUuid;
      }
      resolve(settings);
    });
  });
});

ipcMain.handle('add-peer-uuid', async (event, peerUuid) => {
  return new Promise(resolve => {
    db.get("SELECT value FROM sync_settings WHERE key = 'peer_uuids'", (err, row) => {
      const peerUuids = JSON.parse(row.value);
      if (!peerUuids.includes(peerUuid)) {
        peerUuids.push(peerUuid);
        db.run("UPDATE sync_settings SET value = ? WHERE key = 'peer_uuids'", [JSON.stringify(peerUuids)], () => {
          const topic = crypto.createHash('sha256').update(peerUuid).digest();
          if (swarm) swarm.join(topic, { lookup: true, announce: true });
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
      peerUuids = peerUuids.filter(id => id !== peerUuid);
      db.run("UPDATE sync_settings SET value = ? WHERE key = 'peer_uuids'", [JSON.stringify(peerUuids)], () => {
        const topic = crypto.createHash('sha256').update(peerUuid).digest();
        if (swarm) swarm.leave(topic);
        resolve(true);
      });
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// OCR Processing
ipcMain.handle('process-image', async (event, imagePath) => {
  if (!imagePath) {
    throw new Error('No image path provided to OCR processor.');
  }

  // Pre-process image with Jimp: upscale 5x and high contrast
  const tempPath = path.join(app.getPath('temp'), `processed_${Date.now()}.png`);
  
  try {
    console.log('Pre-processing image...');
    const image = await Jimp.read(imagePath);
    
    // Resize to 6x original size for better OCR
    const newWidth = image.bitmap.width * 6;
    image.resize({ w: newWidth }); 
    
    // Convert to grayscale
    image.greyscale();
    
    // Normalize and set contrast
    image.normalize();
    image.contrast(0.3); 
    
    // Thresholding strategy: pure black and white
    image.threshold({ max: 255, replace: 255, auto: true });
    
    // Invert to get black text on white background
    image.invert();
    
    await image.write(tempPath);
    console.log('Pre-processing complete. Saved to:', tempPath);

    // Use Tesseract.js
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: m => console.log(m)
    });

    await worker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,\n',
      tessedit_pageseg_mode: '6', // PSM 6 for a single uniform block of text
      preserve_interword_spaces: '1', // Help maintain columnar alignment
    });

    const { data: { text } } = await worker.recognize(tempPath);
    await worker.terminate();

    // Clean up temporary file
    try {
      fs.unlinkSync(tempPath);
    } catch (err) {
      console.warn('Failed to delete temp file:', err);
    }

    return text;
  } catch (error) {
    console.error('OCR or Pre-processing Error:', error);
    // Cleanup on error
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch(e) {}
    }
    throw error;
  }
});

// Database Operations
ipcMain.handle('get-locations', async () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT location, COUNT(DISTINCT material || "_" || quality) as count FROM yields WHERE yield_cscu > 0 AND is_deleted = 0 GROUP BY location ORDER BY location ASC', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
});

ipcMain.handle('get-yields-by-location', async (event, { location, sortBy = 'quality', sortOrder = 'DESC' }) => {
  return new Promise((resolve, reject) => {
    // Whitelist columns and orders to prevent SQL injection
    const allowedColumns = ['quality', 'yield_cscu', 'material'];
    const allowedOrders = ['ASC', 'DESC'];
    
    const actualSortBy = allowedColumns.includes(sortBy) ? sortBy : 'quality';
    const actualSortOrder = allowedOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';

    db.all(
      `SELECT MIN(id) as id, material, quality, SUM(yield_cscu) as yield_cscu, 'Aggregated' as miner_name 
       FROM yields 
       WHERE location = ? AND is_deleted = 0 
       GROUP BY material, quality 
       ORDER BY material, ${actualSortBy} ${actualSortOrder}`,
      [location],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
});

ipcMain.handle('save-yield', async (event, yieldData) => {
  const result = await new Promise((resolve, reject) => {
    const { material, quality, yield_cscu, miner_name, location } = yieldData;
    if (!miner_name || miner_name === 'Unknown') {
      return reject(new Error('Miner name is required.'));
    }
    const actualMinerName = miner_name;
    const actualLocation = location || 'Unknown';
    const uuid = crypto.randomUUID();
    const now = new Date().toISOString();
    
    db.serialize(() => {
      // Ensure miner exists in miners table
      db.get('SELECT uuid FROM miners WHERE name = ?', [actualMinerName], (err, row) => {
        if (!row) {
          db.run('INSERT INTO miners (name, uuid, updated_at) VALUES (?, ?, ?)', [actualMinerName, crypto.randomUUID(), now]);
        } else {
          db.run('UPDATE miners SET updated_at = ? WHERE name = ?', [now, actualMinerName]);
        }
      });
      
      // Update miner stats (cumulative, never subtracted)
      db.run(`
        UPDATE miners SET 
          total_yield = total_yield + ?, 
          total_quality_sum = total_quality_sum + ?, 
          record_count = record_count + ?,
          updated_at = ?
        WHERE name = ?
      `, [yield_cscu, quality, 1, now, actualMinerName]);

      // Check if an entry with the same material, quality, miner_name and location exists (excluding deleted ones)
      db.get('SELECT id, yield_cscu, uuid FROM yields WHERE material = ? AND quality = ? AND miner_name = ? AND location = ? AND is_deleted = 0', [material, quality, actualMinerName, actualLocation], (err, row) => {
        if (err) return reject(err);
        if (row) {
          // Update existing entry
          const newYield = row.yield_cscu + yield_cscu;
          db.run('UPDATE yields SET yield_cscu = ?, updated_at = ? WHERE id = ?', [newYield, now, row.id], (err) => {
            if (err) reject(err);
            else resolve({ id: row.id, uuid: row.uuid, updated: true });
          });
        } else {
          // Insert new entry
          db.run(
            'INSERT INTO yields (uuid, material, quality, yield_cscu, miner_name, location, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [uuid, material, quality, yield_cscu, actualMinerName, actualLocation, now],
            function (err) {
              if (err) reject(err);
              else resolve({ id: this.lastID, uuid: uuid, updated: false });
            }
          );
        }
      });
    });
  });
  broadcastSync();
  return result;
});

ipcMain.handle('update-yield', async (event, yieldData) => {
  const result = await new Promise((resolve, reject) => {
    const { id, material, quality, yield_cscu, miner_name, location } = yieldData;
    const actualLocation = location || 'Unknown';
    const now = new Date().toISOString();

    if (miner_name === 'Aggregated') {
      db.get('SELECT material, quality, location, uuid FROM yields WHERE id = ?', [id], (err, row) => {
        if (err) return reject(err);
        if (row) {
          db.serialize(() => {
            // Soft delete old ones
            db.run('UPDATE yields SET is_deleted = 1, updated_at = ? WHERE material = ? AND quality = ? AND location = ? AND is_deleted = 0', [now, row.material, row.quality, row.location]);
            // Insert new aggregated record
            db.run(
              'INSERT INTO yields (uuid, material, quality, yield_cscu, miner_name, location, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [crypto.randomUUID(), material, quality, yield_cscu, 'Aggregated', actualLocation, now],
              (err) => {
                if (err) reject(err);
                else resolve(true);
              }
            );
          });
        } else {
          resolve(false);
        }
      });
      return;
    }

    const actualMinerName = miner_name;
    // Check if updating to a material/quality/miner/location that already exists (for merging, excluding deleted)
    db.get('SELECT id, yield_cscu, uuid FROM yields WHERE material = ? AND quality = ? AND miner_name = ? AND location = ? AND id != ? AND is_deleted = 0', [material, quality, actualMinerName, actualLocation, id], (err, row) => {
      if (err) return reject(err);
      if (row) {
        // Merge into the existing record and soft delete this one
        const newTotalYield = row.yield_cscu + yield_cscu;
        db.serialize(() => {
          db.run('UPDATE yields SET yield_cscu = ?, updated_at = ? WHERE id = ?', [newTotalYield, now, row.id]);
          db.run('UPDATE yields SET is_deleted = 1, updated_at = ? WHERE id = ?', [now, id], (err) => {
            if (err) reject(err);
            else resolve(true);
          });
        });
      } else {
        // Normal update
        db.run(
          'UPDATE yields SET material = ?, quality = ?, yield_cscu = ?, miner_name = ?, location = ?, updated_at = ? WHERE id = ?',
          [material, quality, yield_cscu, actualMinerName, actualLocation, now, id],
          function (err) {
            if (err) reject(err);
            else resolve(true);
          }
        );
      }
    });
  });
  broadcastSync();
  return result;
});

ipcMain.handle('delete-yield', async (event, id) => {
  const result = await new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    db.run('UPDATE yields SET is_deleted = 1, updated_at = ? WHERE id = ?', [now, id], (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
  broadcastSync();
  return result;
});

// Miner Management Operations
ipcMain.handle('get-miners', async () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM miners WHERE is_deleted = 0 ORDER BY name ASC', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
});

ipcMain.handle('add-miner', async (event, name) => {
  const result = await new Promise((resolve, reject) => {
    const uuid = crypto.randomUUID();
    const now = new Date().toISOString();
    db.run('INSERT INTO miners (name, uuid, updated_at) VALUES (?, ?, ?)', [name, uuid, now], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          reject(new Error('Miner already exists.'));
        } else {
          reject(err);
        }
      } else {
        resolve({ id: this.lastID, uuid, name });
      }
    });
  });
  broadcastSync();
  return result;
});

ipcMain.handle('update-miner', async (event, { id, name }) => {
  const result = await new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    db.run('UPDATE miners SET name = ?, updated_at = ? WHERE id = ?', [name, now, id], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          reject(new Error('Miner name already exists.'));
        } else {
          reject(err);
        }
      } else {
        resolve(true);
      }
    });
  });
  broadcastSync();
  return result;
});

ipcMain.handle('delete-miner', async (event, id) => {
  const result = await new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    db.run('UPDATE miners SET is_deleted = 1, updated_at = ? WHERE id = ?', [now, id], (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
  broadcastSync();
  return result;
});

ipcMain.handle('import-csv', async (event) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });

  if (canceled || filePaths.length === 0) return false;

  const filePath = filePaths[0];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  if (lines.length < 2) throw new Error('CSV file is empty or missing data.');

  // Header: location, ore, quality, quantity
  const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const colIndex = {
    location: header.indexOf('location'),
    ore: header.indexOf('ore'),
    quality: header.indexOf('quality'),
    quantity: header.indexOf('quantity')
  };

  if (colIndex.location === -1 || colIndex.ore === -1 || colIndex.quality === -1 || colIndex.quantity === -1) {
    throw new Error('CSV must have location, ore, quality, and quantity columns.');
  }

  const minerName = 'None';
  
  const result = await new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    db.serialize(() => {
      const stmt = db.prepare('INSERT OR IGNORE INTO yields (uuid, location, material, quality, yield_cscu, miner_name, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      let errorOccurred = false;

      for (let i = 1; i < lines.length; i++) {
        // Simple CSV parser that handles quotes
        const parts = [];
        let current = '';
        let inQuotes = false;
        for (let j = 0; j < lines[i].length; j++) {
            const char = lines[i][j];
            if (char === '"') inQuotes = !inQuotes;
            else if (char === ',' && !inQuotes) {
                parts.push(current.trim());
                current = '';
            } else current += char;
        }
        parts.push(current.trim());

        if (parts.length < 4) continue;

        const location = parts[colIndex.location];
        const ore = parts[colIndex.ore];
        const quality = parseFloat(parts[colIndex.quality]);
        const quantity = parseFloat(parts[colIndex.quantity]);

        if (location && ore && !isNaN(quality) && !isNaN(quantity)) {
          const uuid = crypto.randomUUID();
          stmt.run(uuid, location, ore, quality, quantity, minerName, now, (err) => {
            if (err) {
              console.error('Import row error:', err);
              errorOccurred = true;
            }
          });
        }
      }

      stmt.finalize((err) => {
        if (err || errorOccurred) reject(err || new Error('Some rows failed to import. Check console for details.'));
        else resolve(true);
      });
    });
  });
  broadcastSync();
  return result;
});

ipcMain.handle('get-miner-stats', async (event, { sortBy = 'name', sortOrder = 'ASC' } = {}) => {
  return new Promise((resolve, reject) => {
    const allowedSortBy = ['name', 'avg_quality', 'total_yield'];
    const allowedOrders = ['ASC', 'DESC'];
    
    const actualSortByMapping = {
      'name': 'name',
      'avg_quality': 'avg_quality',
      'total_yield': 'total_yield'
    };
    
    const actualSortByCol = allowedSortBy.includes(sortBy) ? actualSortByMapping[sortBy] : 'name';
    const actualSortOrder = allowedOrders.includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'ASC';

    const query = `
      SELECT name, 
             CASE WHEN record_count > 0 THEN total_quality_sum / record_count ELSE 0 END as avg_quality, 
             total_yield, 
             record_count as count
      FROM miners
      ORDER BY ${actualSortByCol} ${actualSortOrder}
    `;
    db.all(query, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
});

ipcMain.handle('get-yields-by-miner', async (event, minerName) => {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT id, material, quality, yield_cscu, location, timestamp FROM yields WHERE miner_name = ? ORDER BY timestamp ASC',
      [minerName],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
});


ipcMain.handle('clear-database', async () => {
  return new Promise((resolve, reject) => {
    db.run('DELETE FROM yields', (err) => {
      if (err) reject(err);
      else resolve(true);
    });
  });
});

ipcMain.handle('show-confirm-dialog', async (event, message) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Yes', 'No'],
    defaultId: 1,
    title: 'Confirm',
    message: message,
  });
  return result.response === 0;
});

ipcMain.handle('show-alert-dialog', async (event, message) => {
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    buttons: ['OK'],
    title: 'Alert',
    message: message,
  });
});

ipcMain.handle('get-all-yields', async () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT location, material, quality, SUM(yield_cscu) as yield_cscu FROM yields GROUP BY location, material, quality ORDER BY location ASC, material ASC, quality DESC', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
});

ipcMain.handle('save-csv', async (event, csvContent) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export to CSV',
    defaultPath: path.join(app.getPath('documents'), 'ore_yields.csv'),
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });

  if (filePath) {
    fs.writeFileSync(filePath, csvContent);
    return true;
  }
  return false;
});
